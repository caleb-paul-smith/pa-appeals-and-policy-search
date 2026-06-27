// API shapes shared with the server (kept in sync manually across tsconfig roots).

export type MatchType = "phrase" | "proximity" | "boolean" | "term" | "semantic";

export type SearchMode = "deterministic" | "semantic";

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
  matchCount: number;
  snippet: SnippetSegment[];
  highlightTerms: string[];
  matchExplanation: string;
}

export interface SearchResponse {
  ok: boolean;
  error?: string;
  example?: string;
  query: string;
  results: SearchResult[];
  candidatesScanned: number;
  truncated: boolean;
}

export type AppMode = "demo" | "pilot" | "production";

export interface StatusResponse {
  mode: AppMode;
  sourceKind: "demo" | "sql";
  stats: {
    documentCount: number;
    pageCount: number;
    lastIndexedAt: string;
  };
  boundaries: string;
  queryExample: string;
  config: {
    documentsTable: string | null;
    pagesTable: string | null;
    warehouseConfigured: boolean;
    volumeConfigured: boolean;
    vectorSearchConfigured: boolean;
    pilotMaxFiles: number;
  };
  error?: string;
}

export interface AdminStats {
  indexedRowCount: number | string;
  ready: boolean;
  statusMessage: string;
  indexName: string;
}

export interface AdminRunStatus {
  runId: string;
  lifecycleState: string;
  resultState: string;
  statusLabel: string;
  startTime: string;
  endTime: string;
  errorMessage?: string;
}
