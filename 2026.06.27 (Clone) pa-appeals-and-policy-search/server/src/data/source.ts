// Data-source abstraction. DEMO MODE uses an in-memory fabricated corpus;
// PILOT/PRODUCTION query the governed Delta index via a SQL warehouse.

export interface PageRow {
  documentId: string;
  fileName: string;
  pageNumber: number;
  pageText: string;
  normalizedText: string;
}

export interface DocumentRow {
  documentId: string;
  fileName: string;
  relativePath: string;
  /** Absolute path under the approved volume (empty in demo). */
  volumePath: string;
  pageCount: number;
}

export interface IndexStats {
  documentCount: number;
  pageCount: number;
  lastIndexedAt: string;
}

export interface IndexSource {
  readonly kind: "demo" | "sql";
  stats(): Promise<IndexStats>;
  /**
   * Fetch candidate pages for precise in-app evaluation. `literals` are the
   * validated positive literal strings (never raw user query text). An empty
   * list means "no coarse prefilter possible" — caller bounds with `limit`.
   */
  fetchCandidatePages(literals: string[], limit: number): Promise<PageRow[]>;
  getDocument(documentId: string): Promise<DocumentRow | null>;
  /** Demo-only: synthesize a PDF for a fabricated document. Returns null otherwise. */
  getDemoPdf?(documentId: string): Promise<Buffer | null>;
}
