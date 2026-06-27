// In-memory demo data source. No external services, no real content.

import { normalizePlain } from "../search/normalize";
import { DEMO_DOCUMENTS, demoStats } from "./demoData";
import type { DocumentRow, IndexSource, IndexStats, PageRow } from "./source";
import { renderDemoPdf } from "../pdf/demoPdf";

export class DemoSource implements IndexSource {
  readonly kind = "demo" as const;

  async stats(): Promise<IndexStats> {
    return demoStats();
  }

  async fetchCandidatePages(literals: string[], limit: number): Promise<PageRow[]> {
    const rows: PageRow[] = [];
    for (const doc of DEMO_DOCUMENTS) {
      for (const page of doc.pages) {
        const normalized = normalizePlain(page.text);
        // Coarse prefilter to mirror the SQL path; precise matching happens later.
        if (literals.length === 0 || literals.some((l) => normalized.includes(l))) {
          rows.push({
            documentId: doc.documentId,
            fileName: doc.fileName,
            pageNumber: page.pageNumber,
            pageText: page.text,
            normalizedText: normalized,
          });
        }
        if (rows.length >= limit) return rows;
      }
    }
    return rows;
  }

  async getDocument(documentId: string): Promise<DocumentRow | null> {
    const doc = DEMO_DOCUMENTS.find((d) => d.documentId === documentId);
    if (!doc) return null;
    return {
      documentId: doc.documentId,
      fileName: doc.fileName,
      relativePath: doc.relativePath,
      volumePath: "", // demo documents have no real volume path
      pageCount: doc.pages.length,
    };
  }

  async getDemoPdf(documentId: string): Promise<Buffer | null> {
    const doc = DEMO_DOCUMENTS.find((d) => d.documentId === documentId);
    if (!doc) return null;
    return renderDemoPdf(doc);
  }
}
