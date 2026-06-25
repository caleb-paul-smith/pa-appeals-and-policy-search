// Shared search types for the deterministic query engine.
//
// The query language is intentionally small and fully parsed/validated in
// application code. Raw user text is NEVER concatenated into SQL.

export type MatchType = "phrase" | "proximity" | "boolean" | "term";

/** A parsed query node. */
export type QueryNode =
  | { type: "term"; value: string }
  | { type: "phrase"; value: string; tokens: string[] }
  | { type: "and"; left: QueryNode; right: QueryNode }
  | { type: "or"; left: QueryNode; right: QueryNode }
  | { type: "not"; operand: QueryNode }
  | {
      type: "near";
      left: QueryNode;
      right: QueryNode;
      distance: number;
      ordered: boolean;
    };

/** Result of attempting to parse a raw query string. */
export interface ParseResult {
  ok: boolean;
  ast?: QueryNode;
  /** Positive literal strings (terms + phrases) usable for a coarse SQL prefilter. */
  positiveLiterals?: string[];
  error?: string;
  example?: string;
}

/** A contiguous run of matched tokens, expressed as token indices (inclusive). */
export interface Span {
  start: number;
  end: number;
}

/** Outcome of evaluating an AST against a single page's normalized tokens. */
export interface EvalResult {
  satisfied: boolean;
  phraseHits: number;
  proximityHits: number;
  termHits: number;
  /** Tightness bonus accumulated from proximity matches (tighter => larger). */
  proximityTightness: number;
  /** Positive matched spans (never includes NOT operands). */
  spans: Span[];
  /** Literal strings that should be highlighted in the reader / snippet. */
  literals: Set<string>;
  usedPhrase: boolean;
  usedProximity: boolean;
  usedBoolean: boolean;
}

/** A snippet broken into safe segments for HTML-free rendering. */
export interface SnippetSegment {
  text: string;
  highlight: boolean;
}

export interface SearchResult {
  documentId: string;
  fileName: string;
  pageNumber: number;
  matchType: MatchType;
  score: number;
  /** Total positive matched occurrences on the page. */
  matchCount: number;
  snippet: SnippetSegment[];
  /** Literal strings the reader should highlight on the page. */
  highlightTerms: string[];
  matchExplanation: string;
}
