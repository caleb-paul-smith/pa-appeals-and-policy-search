// Deterministic query parser for the internal research language.
//
// Grammar (lowest to highest precedence):
//   orExpr   := andExpr (OR andExpr)*
//   andExpr  := nearExpr ((AND | <implicit>) nearExpr)*
//   nearExpr := unary ((NEAR(n) | ONEAR(n)) unary)*
//   unary    := NOT unary | ATLEASTn unary | atom
//   atom     := PHRASE | TERM | WILDCARD | '(' orExpr ')'
//
// Supported:
//   - plain terms (implicit AND on the same page):   procurement reasonable
//   - exact phrases:                                  "direct administrative costs"
//   - booleans:                                       AND OR NOT and parentheses
//   - proximity:                                      "force account" NEAR(12) reasonable
//   - ordered proximity (optional enhancement):       a ONEAR(5) b
//   - wildcard/truncation:                            administrat*
//   - frequency:                                      ATLEAST3(procurement)
//
// Raw user text is parsed/validated here. Only validated literal tokens ever
// reach the SQL layer, and only as bound parameters.

import { normalizePlain } from "./normalize";
import type { ParseResult, QueryNode } from "./types";

type TokKind =
  | "PHRASE"
  | "TERM"
  | "WILDCARD"
  | "AND"
  | "OR"
  | "NOT"
  | "ATLEAST"
  | "NEAR"
  | "ONEAR"
  | "LPAREN"
  | "RPAREN";

interface Tok {
  kind: TokKind;
  value: string; // normalized literal text for PHRASE/TERM/WILDCARD
  distance?: number; // for NEAR/ONEAR
  count?: number; // for ATLEAST
  raw: string; // original text for error messages
  pos: number;
}

const EXAMPLE =
  'Examples:  "direct administrative costs"  |  procurement AND reasonable  |  ' +
  '("first appeal" OR "second appeal") AND procurement NOT draft  |  ' +
  '"force account" NEAR(12) reasonable  |  administrat*  |  ATLEAST3(procurement)';

class QueryError extends Error {}

function lex(input: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(") {
      toks.push({ kind: "LPAREN", value: "(", raw: "(", pos: i });
      i++;
      continue;
    }
    if (ch === ")") {
      toks.push({ kind: "RPAREN", value: ")", raw: ")", pos: i });
      i++;
      continue;
    }
    if (ch === '"') {
      // Exact phrase up to the next double quote.
      const start = i;
      i++;
      let buf = "";
      while (i < n && input[i] !== '"') {
        buf += input[i];
        i++;
      }
      if (i >= n) {
        throw new QueryError("Unclosed quotation mark in phrase.");
      }
      i++; // consume closing quote
      const norm = normalizePlain(buf);
      if (!norm) {
        throw new QueryError("Empty phrase. Put search text inside the quotes.");
      }
      toks.push({ kind: "PHRASE", value: norm, raw: `"${buf}"`, pos: start });
      continue;
    }
    // A bare word: letters/digits and a few legal punctuation chars, stopping
    // at whitespace, parens, or quotes.
    const start = i;
    let buf = "";
    while (i < n && !/[\s()"]/.test(input[i])) {
      buf += input[i];
      i++;
    }
    // Proximity operators are written NEAR(n) / ONEAR(n). The word read above
    // stops at '(', so re-attach a following "(...)" when the word is a
    // proximity keyword.
    if (/^o?near$/i.test(buf) && input[i] === "(") {
      let j = i + 1;
      let inner = "";
      while (j < n && input[j] !== ")") {
        inner += input[j];
        j++;
      }
      if (input[j] === ")") {
        buf += `(${inner})`;
        i = j + 1;
      }
    }
    const upper = buf.toUpperCase();
    if (upper === "AND" || upper === "OR" || upper === "NOT") {
      toks.push({ kind: upper as TokKind, value: upper, raw: buf, pos: start });
      continue;
    }
    const atLeastMatch = /^ATLEAST(\d+)$/i.exec(buf);
    if (atLeastMatch) {
      const count = parseInt(atLeastMatch[1], 10);
      if (count < 1 || count > 1000) {
        throw new QueryError(`ATLEAST count must be between 1 and 1000. Got ${count}.`);
      }
      toks.push({ kind: "ATLEAST", value: "ATLEAST", count, raw: buf, pos: start });
      continue;
    }
    // NEAR(n) / ONEAR(n) — optionally followed immediately by (n).
    const proxMatch = /^(O?NEAR)\((\d+)\)$/i.exec(buf);
    if (proxMatch) {
      const kind = proxMatch[1].toUpperCase() === "ONEAR" ? "ONEAR" : "NEAR";
      const dist = parseInt(proxMatch[2], 10);
      if (dist < 1 || dist > 1000) {
        throw new QueryError(
          `${kind}(n) distance must be between 1 and 1000. Got ${dist}.`
        );
      }
      toks.push({ kind, value: kind, distance: dist, raw: buf, pos: start });
      continue;
    }
    if (/^o?near$/i.test(buf)) {
      throw new QueryError(
        `${buf.toUpperCase()} must be written with a token distance, e.g. ${buf.toUpperCase()}(12).`
      );
    }
    if (buf.endsWith("*")) {
      const normPrefix = normalizePlain(buf.slice(0, -1));
      if (!normPrefix) {
        throw new QueryError(`Wildcard "${buf}" needs at least one searchable character before *.`);
      }
      toks.push({ kind: "WILDCARD", value: normPrefix, raw: buf, pos: start });
      continue;
    }
    const norm = normalizePlain(buf);
    if (!norm) {
      throw new QueryError(`Unrecognized token near "${buf}".`);
    }
    toks.push({ kind: "TERM", value: norm, raw: buf, pos: start });
  }
  return toks;
}

class Parser {
  private pos = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }
  private next(): Tok | undefined {
    return this.toks[this.pos++];
  }

  private isOperandStart(t?: Tok): boolean {
    return (
      !!t &&
      (t.kind === "PHRASE" ||
        t.kind === "TERM" ||
        t.kind === "WILDCARD" ||
        t.kind === "LPAREN" ||
        t.kind === "NOT" ||
        t.kind === "ATLEAST")
    );
  }

  parse(): QueryNode {
    if (this.toks.length === 0) {
      throw new QueryError("Empty query. Enter one or more search terms.");
    }
    const node = this.parseOr();
    if (this.pos < this.toks.length) {
      const t = this.toks[this.pos];
      throw new QueryError(`Unexpected "${t.raw}" in query.`);
    }
    return node;
  }

  private parseOr(): QueryNode {
    let left = this.parseAnd();
    while (this.peek()?.kind === "OR") {
      this.next();
      const right = this.parseAnd();
      left = { type: "or", left, right };
    }
    return left;
  }

  private parseAnd(): QueryNode {
    let left = this.parseNear();
    for (;;) {
      const t = this.peek();
      if (t?.kind === "AND") {
        this.next();
        const right = this.parseNear();
        left = { type: "and", left, right };
      } else if (this.isOperandStart(t)) {
        // implicit AND between adjacent operands
        const right = this.parseNear();
        left = { type: "and", left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseNear(): QueryNode {
    let left = this.parseUnary();
    while (this.peek()?.kind === "NEAR" || this.peek()?.kind === "ONEAR") {
      const op = this.next()!;
      const right = this.parseUnary();
      left = {
        type: "near",
        left,
        right,
        distance: op.distance!,
        ordered: op.kind === "ONEAR",
      };
    }
    return left;
  }

  private parseUnary(): QueryNode {
    if (this.peek()?.kind === "NOT") {
      this.next();
      return { type: "not", operand: this.parseUnary() };
    }
    if (this.peek()?.kind === "ATLEAST") {
      const op = this.next()!;
      return { type: "atleast", count: op.count!, operand: this.parseUnary() };
    }
    return this.parseAtom();
  }

  private parseAtom(): QueryNode {
    const t = this.next();
    if (!t) {
      throw new QueryError("Unexpected end of query. A search term is missing.");
    }
    if (t.kind === "PHRASE") {
      const tokens = t.value.split(" ").filter(Boolean);
      return { type: "phrase", value: t.value, tokens };
    }
    if (t.kind === "TERM") {
      return { type: "term", value: t.value };
    }
    if (t.kind === "WILDCARD") {
      return { type: "wildcard", prefix: t.value };
    }
    if (t.kind === "LPAREN") {
      const inner = this.parseOr();
      const close = this.next();
      if (!close || close.kind !== "RPAREN") {
        throw new QueryError("Missing closing parenthesis ')'.");
      }
      return inner;
    }
    if (t.kind === "RPAREN") {
      throw new QueryError("Unexpected ')'. Check your parentheses.");
    }
    if (t.kind === "AND" || t.kind === "OR") {
      throw new QueryError(`"${t.raw}" must sit between two search terms.`);
    }
    if (t.kind === "ATLEAST") {
      throw new QueryError(`"${t.raw}" must be followed by a search term or parenthesized expression.`);
    }
    if (t.kind === "NEAR" || t.kind === "ONEAR") {
      throw new QueryError(`"${t.raw}" must sit between two search terms.`);
    }
    throw new QueryError(`Unexpected token "${t.raw}".`);
  }
}

/** Collect positive literal strings (terms + phrases not under NOT). */
function collectPositiveLiterals(node: QueryNode, negated: boolean, out: Set<string>): void {
  switch (node.type) {
    case "term":
    case "phrase":
      if (!negated) out.add(node.value);
      return;
    case "wildcard":
      if (!negated) out.add(node.prefix);
      return;
    case "not":
      collectPositiveLiterals(node.operand, !negated, out);
      return;
    case "atleast":
      collectPositiveLiterals(node.operand, negated, out);
      return;
    case "and":
    case "or":
    case "near":
      collectPositiveLiterals(node.left, negated, out);
      collectPositiveLiterals(node.right, negated, out);
      return;
  }
}

export function parseQuery(raw: string): ParseResult {
  const input = (raw ?? "").trim();
  if (!input) {
    return { ok: false, error: "Enter a search query.", example: EXAMPLE };
  }
  try {
    const toks = lex(input);
    const ast = new Parser(toks).parse();
    const lits = new Set<string>();
    collectPositiveLiterals(ast, false, lits);
    if (lits.size === 0) {
      return {
        ok: false,
        error: "Query has no positive terms to match. Add at least one term outside of NOT.",
        example: EXAMPLE,
      };
    }
    return { ok: true, ast, positiveLiterals: [...lits] };
  } catch (err) {
    const message = err instanceof QueryError ? err.message : "Could not parse query.";
    return { ok: false, error: message, example: EXAMPLE };
  }
}

export { EXAMPLE as QUERY_EXAMPLE };
