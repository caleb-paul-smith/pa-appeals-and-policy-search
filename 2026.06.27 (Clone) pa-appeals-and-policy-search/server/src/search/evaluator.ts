// Deterministic evaluation of a parsed query against a single page.
//
// Matching runs against the normalized token stream. Snippets are rebuilt from
// the ORIGINAL page text via the offset map so they read naturally and so
// highlight ranges are accurate. NOT operands never contribute highlights.

import { normalizeWithMap, tokenize, type Token } from "./normalize";
import type {
  EvalResult,
  MatchType,
  QueryNode,
  SnippetSegment,
  Span,
} from "./types";

const PHRASE_WEIGHT = 1000;
const PROXIMITY_WEIGHT = 120;
const TERM_WEIGHT = 12;

function emptyResult(): EvalResult {
  return {
    satisfied: false,
    phraseHits: 0,
    proximityHits: 0,
    termHits: 0,
    proximityTightness: 0,
    spans: [],
    literals: new Set(),
    usedPhrase: false,
    usedProximity: false,
    usedBoolean: false,
  };
}

function termSpans(value: string, tokens: Token[]): Span[] {
  const spans: Span[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].text === value) spans.push({ start: i, end: i });
  }
  return spans;
}

function wildcardSpans(prefix: string, tokens: Token[]): Span[] {
  const spans: Span[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].text.startsWith(prefix)) spans.push({ start: i, end: i });
  }
  return spans;
}

function phraseSpans(phraseTokens: string[], tokens: Token[]): Span[] {
  const spans: Span[] = [];
  const k = phraseTokens.length;
  if (k === 0) return spans;
  for (let i = 0; i + k <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < k; j++) {
      if (tokens[i + j].text !== phraseTokens[j]) {
        ok = false;
        break;
      }
    }
    if (ok) spans.push({ start: i, end: i + k - 1 });
  }
  return spans;
}

function mergeSpans(a: Span[], b: Span[]): Span[] {
  return [...a, ...b];
}

/** Evaluate a node against the page's tokens. */
export function evaluate(node: QueryNode, tokens: Token[]): EvalResult {
  switch (node.type) {
    case "term": {
      const spans = termSpans(node.value, tokens);
      const res = emptyResult();
      if (spans.length > 0) {
        res.satisfied = true;
        res.termHits = spans.length;
        res.spans = spans;
        res.literals.add(node.value);
      }
      return res;
    }
    case "wildcard": {
      const spans = wildcardSpans(node.prefix, tokens);
      const res = emptyResult();
      if (spans.length > 0) {
        res.satisfied = true;
        res.termHits = spans.length;
        res.spans = spans;
        for (const span of spans) {
          res.literals.add(tokens[span.start].text);
        }
      }
      return res;
    }
    case "phrase": {
      const spans = phraseSpans(node.tokens, tokens);
      const res = emptyResult();
      if (spans.length > 0) {
        res.satisfied = true;
        res.spans = spans;
        res.literals.add(node.value);
        if (node.tokens.length > 1) {
          res.phraseHits = spans.length;
          res.usedPhrase = true;
        } else {
          res.termHits = spans.length;
        }
      }
      return res;
    }
    case "not": {
      const inner = evaluate(node.operand, tokens);
      const res = emptyResult();
      res.satisfied = !inner.satisfied;
      res.usedBoolean = true;
      // NOT contributes no spans or literals (never highlighted).
      return res;
    }
    case "atleast": {
      const inner = evaluate(node.operand, tokens);
      const res = emptyResult();
      res.usedBoolean = true;
      if (inner.satisfied && matchCountOf(inner) >= node.count) {
        res.satisfied = true;
        accumulate(res, inner);
      }
      return res;
    }
    case "and": {
      const l = evaluate(node.left, tokens);
      const r = evaluate(node.right, tokens);
      const res = emptyResult();
      res.satisfied = l.satisfied && r.satisfied;
      res.usedBoolean = true;
      if (res.satisfied) {
        accumulate(res, l);
        accumulate(res, r);
      }
      return res;
    }
    case "or": {
      const l = evaluate(node.left, tokens);
      const r = evaluate(node.right, tokens);
      const res = emptyResult();
      res.satisfied = l.satisfied || r.satisfied;
      res.usedBoolean = true;
      // Only include literals/spans from branches that actually matched.
      if (l.satisfied) accumulate(res, l);
      if (r.satisfied) accumulate(res, r);
      return res;
    }
    case "near": {
      const l = evaluate(node.left, tokens);
      const r = evaluate(node.right, tokens);
      const res = emptyResult();
      res.usedProximity = true;
      if (!l.satisfied || !r.satisfied) {
        res.satisfied = false;
        return res;
      }
      let hits = 0;
      let tightness = 0;
      const matchedSpans: Span[] = [];
      for (const a of l.spans) {
        for (const b of r.spans) {
          const ok = withinDistance(a, b, node.distance, node.ordered);
          if (ok) {
            hits++;
            tightness += node.distance - gapBetween(a, b);
            matchedSpans.push(a, b);
          }
        }
      }
      if (hits > 0) {
        res.satisfied = true;
        res.proximityHits = hits;
        res.proximityTightness = tightness;
        res.spans = matchedSpans;
        for (const lit of l.literals) res.literals.add(lit);
        for (const lit of r.literals) res.literals.add(lit);
        // carry through any nested phrase usage for explanation purposes
        res.usedPhrase = l.usedPhrase || r.usedPhrase;
      }
      return res;
    }
  }
}

function accumulate(into: EvalResult, from: EvalResult): void {
  into.phraseHits += from.phraseHits;
  into.proximityHits += from.proximityHits;
  into.termHits += from.termHits;
  into.proximityTightness += from.proximityTightness;
  into.spans = mergeSpans(into.spans, from.spans);
  for (const lit of from.literals) into.literals.add(lit);
  into.usedPhrase = into.usedPhrase || from.usedPhrase;
  into.usedProximity = into.usedProximity || from.usedProximity;
  into.usedBoolean = into.usedBoolean || from.usedBoolean;
}

/** Number of tokens strictly between two non-overlapping spans (0 if adjacent). */
function gapBetween(a: Span, b: Span): number {
  if (a.end < b.start) return b.start - a.end - 1;
  if (b.end < a.start) return a.start - b.end - 1;
  return 0; // overlapping
}

function withinDistance(a: Span, b: Span, distance: number, ordered: boolean): boolean {
  if (ordered && !(a.end < b.start)) return false;
  return gapBetween(a, b) <= distance;
}

export function scoreOf(r: EvalResult): number {
  return (
    r.phraseHits * PHRASE_WEIGHT +
    r.proximityHits * PROXIMITY_WEIGHT +
    r.proximityTightness * 4 +
    r.termHits * TERM_WEIGHT
  );
}

export function matchTypeOf(r: EvalResult): MatchType {
  if (r.usedProximity) return "proximity";
  if (r.usedPhrase) return "phrase";
  if (r.usedBoolean) return "boolean";
  return "term";
}

export function matchCountOf(r: EvalResult): number {
  return r.phraseHits + r.proximityHits + r.termHits;
}

export function explain(r: EvalResult, matchType: MatchType): string {
  const parts: string[] = [];
  if (r.phraseHits) parts.push(`${r.phraseHits} exact phrase match${r.phraseHits > 1 ? "es" : ""}`);
  if (r.proximityHits)
    parts.push(`${r.proximityHits} proximity match${r.proximityHits > 1 ? "es" : ""}`);
  if (r.termHits) parts.push(`${r.termHits} term occurrence${r.termHits > 1 ? "s" : ""}`);
  const detail = parts.length ? parts.join(", ") : "matched";
  return `${matchType[0].toUpperCase()}${matchType.slice(1)} match — ${detail} on this page.`;
}

/**
 * Build a readable snippet (as safe segments) from ORIGINAL page text, centered
 * on the best matched span, highlighting all positive literal occurrences that
 * fall inside the window.
 */
export function buildSnippet(
  originalPageText: string,
  literals: Set<string>,
  bestSpan: Span | undefined,
  tokens: Token[],
  contextChars = 160
): SnippetSegment[] {
  if (!bestSpan || tokens.length === 0) {
    const plain = originalPageText.slice(0, contextChars).trim();
    return plain ? [{ text: plain, highlight: false }] : [];
  }
  const { map } = normalizeWithMap(originalPageText);
  // Normalized char range of the best span.
  const nStart = tokens[bestSpan.start].start;
  const nEnd = tokens[bestSpan.end].end;
  // Map to original char positions.
  const origStart = map[nStart] ?? 0;
  const origEnd = (map[nEnd - 1] ?? origStart) + 1;
  const winStart = Math.max(0, origStart - contextChars);
  const winEnd = Math.min(originalPageText.length, origEnd + contextChars);
  let windowText = originalPageText.slice(winStart, winEnd).replace(/\s+/g, " ").trim();

  // Highlight literal occurrences within the window (case-insensitive).
  const lits = [...literals].filter(Boolean).sort((a, b) => b.length - a.length);
  return highlightLiterals(windowText, lits, winStart > 0, winEnd < originalPageText.length);
}

function highlightLiterals(
  text: string,
  literals: string[],
  ellipsisStart: boolean,
  ellipsisEnd: boolean
): SnippetSegment[] {
  const lower = text.toLowerCase();
  // Collect non-overlapping match ranges, longest literals first.
  const ranges: Array<{ start: number; end: number }> = [];
  for (const lit of literals) {
    if (!lit) continue;
    let from = 0;
    for (;;) {
      const idx = lower.indexOf(lit, from);
      if (idx === -1) break;
      const end = idx + lit.length;
      if (!ranges.some((rg) => idx < rg.end && end > rg.start)) {
        ranges.push({ start: idx, end });
      }
      from = end;
    }
  }
  ranges.sort((a, b) => a.start - b.start);

  const segments: SnippetSegment[] = [];
  if (ellipsisStart) segments.push({ text: "… ", highlight: false });
  let cursor = 0;
  for (const rg of ranges) {
    if (rg.start > cursor) {
      segments.push({ text: text.slice(cursor, rg.start), highlight: false });
    }
    segments.push({ text: text.slice(rg.start, rg.end), highlight: true });
    cursor = rg.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlight: false });
  if (ellipsisEnd) segments.push({ text: " …", highlight: false });
  return segments;
}

/** Pick the most informative span: prefer the longest, earliest. */
export function pickBestSpan(spans: Span[]): Span | undefined {
  if (spans.length === 0) return undefined;
  return [...spans].sort((a, b) => {
    const lenA = a.end - a.start;
    const lenB = b.end - b.start;
    if (lenB !== lenA) return lenB - lenA;
    return a.start - b.start;
  })[0];
}

export { tokenize };
