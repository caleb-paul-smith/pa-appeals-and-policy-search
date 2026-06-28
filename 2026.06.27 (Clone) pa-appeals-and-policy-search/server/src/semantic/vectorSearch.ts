import type { AppConfig } from "../config";
import type { SearchResponse } from "../search/searchService";
import type { SearchResult, SnippetSegment } from "../search/types";

const VS_COLUMNS = ["chunk_id", "filename", "page_number", "chunk_type", "chunk_text"];

interface VectorSearchManifest {
  columns?: Array<{ name?: string }>;
}

interface VectorSearchResponse {
  manifest?: VectorSearchManifest;
  result?: {
    data_array?: unknown[][];
  };
}

export function hasVectorSearchConfig(config: AppConfig): boolean {
  return !!config.databricksHost && !!config.vsIndexName;
}

export async function runSemanticSearch(
  rawQuery: string,
  numResults: number,
  userToken: string | undefined,
  config: AppConfig
): Promise<SearchResponse> {
  const query = rawQuery.trim();
  if (!query) {
    return {
      ok: false,
      error: "Enter a search query.",
      query: rawQuery,
      results: [],
      candidatesScanned: 0,
      truncated: false,
    };
  }

  if (!hasVectorSearchConfig(config)) {
    return demoSemanticResponse(query);
  }
  if (!userToken) {
    return {
      ok: false,
      error: "No user authentication token found. Refresh the Databricks App and try again.",
      query,
      results: [],
      candidatesScanned: 0,
      truncated: false,
    };
  }

  const url =
    `${config.databricksHost.replace(/\/$/, "")}/api/2.0/vector-search/indexes/` +
    `${encodeURIComponent(config.vsIndexName)}/query`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      columns: VS_COLUMNS,
      query_text: query,
      num_results: clampNumResults(numResults),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Vector Search request failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const data = (await response.json()) as VectorSearchResponse;
  const results = normalizeVectorResults(data);
  return {
    ok: true,
    query,
    results,
    candidatesScanned: results.length,
    truncated: false,
  };
}

function normalizeVectorResults(data: VectorSearchResponse): SearchResult[] {
  const columns = (data.manifest?.columns ?? [])
    .map((col) => col.name)
    .filter((name): name is string => !!name);
  const rows = data.result?.data_array ?? [];
  return rows.map((row, index) => {
    const values = new Map<string, unknown>();
    columns.forEach((name, colIndex) => values.set(name, row[colIndex]));

    const chunkId = stringValue(values.get("chunk_id")) || `semantic-${index + 1}`;
    const fileName = stringValue(values.get("filename")) || "Unknown document";
    const pageNumber = numberValue(values.get("page_number")) || 1;
    const score = numberValue(values.get("score"));
    const chunkText = stringValue(values.get("chunk_text"));

    return {
      documentId: chunkId,
      fileName,
      pageNumber,
      matchType: "semantic",
      score,
      matchCount: 1,
      snippet: snippetFromText(chunkText, 500),
      highlightTerms: [],
      matchExplanation: `Semantic match - relevance score: ${score.toFixed(3)}`,
    };
  });
}

function demoSemanticResponse(query: string): SearchResponse {
  const result: SearchResult = {
    documentId: "demo-semantic",
    fileName: "Semantic search demo result",
    pageNumber: 1,
    matchType: "semantic",
    score: 0.812,
    matchCount: 1,
    snippet: [
      {
        text:
          "Semantic search is in demo mode because DATABRICKS_HOST or VS_INDEX_NAME is not configured. " +
          `The query "${query}" will be sent to Vector Search when the Databricks App environment is set.`,
        highlight: false,
      },
    ],
    highlightTerms: [],
    matchExplanation: "Semantic match - demo response.",
  };
  return {
    ok: true,
    query,
    results: [result],
    candidatesScanned: 1,
    truncated: false,
  };
}

function snippetFromText(text: string, maxChars: number): SnippetSegment[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const truncated = cleaned.length > maxChars ? `${cleaned.slice(0, maxChars).trim()} ...` : cleaned;
  return [{ text: truncated, highlight: false }];
}

function clampNumResults(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(25, Math.max(1, Math.floor(value)));
}

function stringValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function numberValue(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
