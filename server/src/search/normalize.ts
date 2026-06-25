// Text normalization shared by the indexer's intent and the search engine.
//
// The Python indexer produces `normalized_text` with the SAME rules (collapse
// whitespace + lowercase). We re-derive a normalized form with an offset map
// here so we can build readable, correctly-cased snippets from the ORIGINAL
// page text while matching against the normalized form.

export interface Normalized {
  /** Lowercased, single-spaced text. */
  text: string;
  /** map[i] = index into the original string for normalized char i. */
  map: number[];
}

/**
 * Collapse runs of whitespace to single spaces and lowercase, while recording
 * the original-string index of each surviving character.
 */
export function normalizeWithMap(original: string): Normalized {
  const out: string[] = [];
  const map: number[] = [];
  let prevWasSpace = true; // leading whitespace is trimmed
  for (let i = 0; i < original.length; i++) {
    const ch = original[i];
    if (/\s/.test(ch)) {
      if (!prevWasSpace) {
        out.push(" ");
        map.push(i);
        prevWasSpace = true;
      }
    } else {
      out.push(ch.toLowerCase());
      map.push(i);
      prevWasSpace = false;
    }
  }
  // Trim a single trailing space if present.
  if (out.length && out[out.length - 1] === " ") {
    out.pop();
    map.pop();
  }
  return { text: out.join(""), map };
}

/** Plain normalization (no offset map) — matches the indexer's normalized_text. */
export function normalizePlain(original: string): string {
  return original.replace(/\s+/g, " ").trim().toLowerCase();
}

export interface Token {
  text: string;
  /** char offset (inclusive) within the normalized string */
  start: number;
  /** char offset (exclusive) within the normalized string */
  end: number;
}

/** Tokenize a normalized string into word tokens with char offsets. */
export function tokenize(normalized: string): Token[] {
  const tokens: Token[] = [];
  const re = /[^\s]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}
