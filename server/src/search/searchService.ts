// Orchestrates parse -> candidate fetch -> precise evaluation -> ranking.

import type { AppConfig } from "../config";
import type { IndexSource } from "../data/source";
import { normalizeWithMap, tokenize } from "./normalize";
import { parseQuery } from "./queryParser";
import {
  buildSnippet,
  evaluate,
  explain,
  matchCountOf,
  matchTypeOf,
  pickBestSpan,
  scoreOf,
} from "./evaluator";
import type { SearchResult } from "./types";

export interface SearchResponse {
  ok: boolean;
  error?: string;
  example?: string;
  query: string;
  results: SearchResult[];
  candidatesScanned: number;
  truncated: boolean;
}

export async function runSearch(
  rawQuery: string,
  source: IndexSource,
  config: AppConfig
): Promise<SearchResponse> {
  const parsed = parseQuery(rawQuery);
  if (!parsed.ok || !parsed.ast) {
    return {
      ok: false,
      error: parsed.error,
      example: parsed.example,
      query: rawQuery,
      results: [],
      candidatesScanned: 0,
      truncated: false,
    };
  }

  const candidates = await source.fetchCandidatePages(
    parsed.positiveLiterals ?? [],
    config.maxCandidatePages
  );

  const results: SearchResult[] = [];
  for (const page of candidates) {
    const norm = normalizeWithMap(page.pageText);
    const tokens = tokenize(norm.text);
    const evalResult = evaluate(parsed.ast, tokens);
    if (!evalResult.satisfied) continue;

    const matchType = matchTypeOf(evalResult);
    const best = pickBestSpan(evalResult.spans);
    const snippet = buildSnippet(page.pageText, evalResult.literals, best, tokens);
    results.push({
      documentId: page.documentId,
      fileName: page.fileName,
      pageNumber: page.pageNumber,
      matchType,
      score: scoreOf(evalResult),
      matchCount: matchCountOf(evalResult),
      snippet,
      highlightTerms: [...evalResult.literals],
      matchExplanation: explain(evalResult, matchType),
    });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
    return a.pageNumber - b.pageNumber;
  });

  const truncated = results.length > config.maxResults;
  return {
    ok: true,
    query: rawQuery,
    results: results.slice(0, config.maxResults),
    candidatesScanned: candidates.length,
    truncated,
  };
}
