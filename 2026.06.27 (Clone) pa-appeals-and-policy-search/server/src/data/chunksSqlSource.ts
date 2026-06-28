// Databricks SQL warehouse data source backed by the Vector Search CHUNKS table
// (PILOT / PRODUCTION keyword search).
//
// Why this exists:
//  - The dedicated page-index tables (appeal_research_documents / _pages) are an
//    optional, separate pipeline that may not have been built.
//  - The chunks table behind the Vector Search index (e.g.
//    `tws_ro_region5.rcd.pa_appeals_chunks_vs`) already contains every chunk of
//    extracted text. Pointing deterministic search at it gives working keyword
//    search over the real corpus with no extra indexing.
//
// SECURITY:
//  - The table identifier comes from server config and is validated against a
//    strict identifier pattern before interpolation.
//  - All user-derived values (search literals, filenames) are passed as BOUND
//    named parameters. Raw user query text never reaches SQL.
//  - getDocument() confirms a filename actually exists in the corpus before a
//    path is built, and the PDF route additionally validates the resolved path
//    against the approved volume root (defense in depth).

import type { DBSQLClient as DBSQLClientType } from "@databricks/sql";
import type { AppConfig } from "../config";
import { normalizePlain } from "../search/normalize";
import { findPdfByBasename } from "../pdf/volumeIndex";
import type { DocumentRow, IndexSource, IndexStats, PageRow } from "./source";

const IDENT_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,2}$/;

export function assertIdentifier(fqn: string, label: string): string {
  if (!IDENT_RE.test(fqn)) {
    throw new Error(`Configured ${label} is not a valid identifier: ${fqn}`);
  }
  return fqn;
}

/** Escape LIKE wildcards so literal % and _ are matched literally. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export interface LikeFilter {
  /** SQL boolean expression (empty string when there are no literals). */
  clause: string;
  params: Record<string, string>;
}

/**
 * Build a whitespace-tolerant LIKE filter over chunk_text. Chunk text is
 * normalized in SQL (collapse whitespace + lowercase) so phrase literals such
 * as "direct administrative costs" match even across line breaks — mirroring
 * the `normalized_text` column the page-index path relies on.
 */
export function buildChunkLikeFilter(literals: string[]): LikeFilter {
  const params: Record<string, string> = {};
  if (literals.length === 0) return { clause: "", params };
  const clauses = literals.map((lit, i) => {
    const key = `lit${i}`;
    params[key] = `%${escapeLike(lit.toLowerCase())}%`;
    return `LOWER(REGEXP_REPLACE(chunk_text, '\\\\s+', ' ')) LIKE :${key} ESCAPE '\\\\'`;
  });
  return { clause: clauses.join(" OR "), params };
}

/**
 * Candidate-page SQL. Matching chunks are grouped back up to a single row per
 * (filename, page_number) so downstream evaluation/ranking keeps page-level
 * semantics. CONCAT_WS joins a page's matching chunks into one text block.
 */
export function buildCandidateSql(chunksFqn: string, clause: string, cap: number): string {
  const where = clause ? `WHERE (${clause}) ` : "";
  return (
    `SELECT filename AS filename, page_number AS page_number, ` +
    `CONCAT_WS('\\n', COLLECT_LIST(chunk_text)) AS page_text ` +
    `FROM ${chunksFqn} ${where}` +
    `GROUP BY filename, page_number ` +
    `ORDER BY filename, page_number LIMIT ${cap}`
  );
}

/**
 * Resolve a corpus filename (a bare basename) to an absolute path under the
 * approved volume root. PDFs are nested by era/year, so we first look the
 * basename up in the recursively-built volume index; if that finds nothing we
 * fall back to a flat root/basename guess. Returns "" when no volume is
 * configured (search still works; preview does not). The PDF route always
 * re-validates the result against the approved root.
 */
export function resolveChunkVolumePath(volumeRoot: string, filename: string): string {
  if (!volumeRoot || !filename) return "";
  const found = findPdfByBasename(volumeRoot, filename);
  if (found) return found;
  const root = volumeRoot.endsWith("/") ? volumeRoot.slice(0, -1) : volumeRoot;
  return `${root}/${filename}`;
}

function httpPathForWarehouse(id: string): string {
  return `/sql/1.0/warehouses/${id}`;
}

export class ChunksSqlSource implements IndexSource {
  readonly kind = "sql" as const;
  private readonly chunksFqn: string;
  private clientPromise: Promise<DBSQLClientType> | null = null;

  constructor(private readonly config: AppConfig) {
    this.chunksFqn = assertIdentifier(config.chunksTableFqn, "chunks_table");
  }

  private async getClient(): Promise<DBSQLClientType> {
    if (this.clientPromise) return this.clientPromise;
    this.clientPromise = (async () => {
      const { DBSQLClient } = await import("@databricks/sql");
      const host = this.config.databricksHost.replace(/^https?:\/\//, "");
      if (!host) throw new Error("DATABRICKS_HOST is not configured.");
      const token = process.env.DATABRICKS_TOKEN || "";
      const client = new DBSQLClient();
      await client.connect({
        host,
        path: httpPathForWarehouse(this.config.warehouseId),
        token,
      });
      return client;
    })();
    return this.clientPromise;
  }

  private async query<T = Record<string, unknown>>(
    sql: string,
    namedParameters: Record<string, string | number> = {}
  ): Promise<T[]> {
    const client = await this.getClient();
    const session = await client.openSession();
    try {
      const op = await session.executeStatement(sql, {
        runAsync: true,
        namedParameters,
        maxRows: this.config.maxCandidatePages + 16,
      });
      const rows = (await op.fetchAll()) as T[];
      await op.close();
      return rows;
    } finally {
      await session.close();
    }
  }

  async stats(): Promise<IndexStats> {
    const sql =
      `SELECT COUNT(DISTINCT filename) AS document_count, ` +
      `COUNT(DISTINCT filename, page_number) AS page_count ` +
      `FROM ${this.chunksFqn}`;
    const rows = await this.query<{
      document_count: number | bigint;
      page_count: number | bigint;
    }>(sql);
    const r = rows[0] ?? { document_count: 0, page_count: 0 };
    return {
      documentCount: Number(r.document_count) || 0,
      pageCount: Number(r.page_count) || 0,
      lastIndexedAt: `live: ${this.chunksFqn}`,
    };
  }

  async fetchCandidatePages(literals: string[], limit: number): Promise<PageRow[]> {
    const cap = Math.min(limit, this.config.maxCandidatePages);
    const { clause, params } = buildChunkLikeFilter(literals);
    const sql = buildCandidateSql(this.chunksFqn, clause, cap);
    const rows = await this.query<{
      filename: string;
      page_number: number | bigint;
      page_text: string | null;
    }>(sql, params);
    return rows.map((r) => {
      const pageText = r.page_text ?? "";
      return {
        documentId: String(r.filename),
        fileName: String(r.filename),
        pageNumber: Number(r.page_number),
        pageText,
        normalizedText: normalizePlain(pageText),
      };
    });
  }

  async getDocument(documentId: string): Promise<DocumentRow | null> {
    // documentId is the corpus filename. Confirm it exists before building a path.
    const sql =
      `SELECT filename AS filename, MAX(page_number) AS page_count ` +
      `FROM ${this.chunksFqn} WHERE filename = :id GROUP BY filename LIMIT 1`;
    const rows = await this.query<{
      filename: string;
      page_count: number | bigint | null;
    }>(sql, { id: documentId });
    const r = rows[0];
    if (!r) return null;
    const fileName = String(r.filename);
    return {
      documentId: fileName,
      fileName,
      relativePath: fileName,
      volumePath: resolveChunkVolumePath(this.config.appealsVolumePath, fileName),
      pageCount: Number(r.page_count ?? 0),
    };
  }
}
