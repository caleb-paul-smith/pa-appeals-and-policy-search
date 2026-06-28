// Databricks SQL warehouse data source (PILOT / PRODUCTION).
//
// SECURITY:
//  - Table identifiers come from server config and are validated against a
//    strict identifier pattern before interpolation.
//  - All user-derived values (search literals, document ids) are passed as
//    BOUND named parameters. Raw user query text never reaches SQL.
//  - The warehouse resource should grant READ access only.

import type { DBSQLClient as DBSQLClientType } from "@databricks/sql";
import type { AppConfig } from "../config";
import type { DocumentRow, IndexSource, IndexStats, PageRow } from "./source";

const IDENT_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,2}$/;

function assertIdentifier(fqn: string, label: string): string {
  if (!IDENT_RE.test(fqn)) {
    throw new Error(`Configured ${label} is not a valid identifier: ${fqn}`);
  }
  return fqn;
}

function httpPathForWarehouse(id: string): string {
  return `/sql/1.0/warehouses/${id}`;
}

export class SqlSource implements IndexSource {
  readonly kind = "sql" as const;
  private readonly docsFqn: string;
  private readonly pagesFqn: string;
  private clientPromise: Promise<DBSQLClientType> | null = null;

  constructor(private readonly config: AppConfig) {
    this.docsFqn = assertIdentifier(config.documentsTableFqn, "documents_table");
    this.pagesFqn = assertIdentifier(config.pagesTableFqn, "pages_table");
  }

  private async getClient(): Promise<DBSQLClientType> {
    if (this.clientPromise) return this.clientPromise;
    this.clientPromise = (async () => {
      const { DBSQLClient } = await import("@databricks/sql");
      const host = this.config.databricksHost.replace(/^https?:\/\//, "");
      if (!host) throw new Error("DATABRICKS_HOST is not configured.");
      const token = process.env.DATABRICKS_TOKEN || "";
      const client = new DBSQLClient();
      // Token auth for local/dev. In a deployed Databricks App, attach the SQL
      // warehouse as an app resource so platform-managed credentials are used.
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
      `SELECT ` +
      `(SELECT COUNT(*) FROM ${this.docsFqn}) AS document_count, ` +
      `(SELECT COUNT(*) FROM ${this.pagesFqn}) AS page_count, ` +
      `(SELECT CAST(MAX(indexed_at) AS STRING) FROM ${this.docsFqn}) AS last_indexed`;
    const rows = await this.query<{
      document_count: number | bigint;
      page_count: number | bigint;
      last_indexed: string | null;
    }>(sql);
    const r = rows[0] ?? { document_count: 0, page_count: 0, last_indexed: null };
    return {
      documentCount: Number(r.document_count) || 0,
      pageCount: Number(r.page_count) || 0,
      lastIndexedAt: r.last_indexed || "unknown",
    };
  }

  async fetchCandidatePages(literals: string[], limit: number): Promise<PageRow[]> {
    const cap = Math.min(limit, this.config.maxCandidatePages);
    const params: Record<string, string | number> = {};
    let where = "";
    if (literals.length > 0) {
      const clauses = literals.map((lit, i) => {
        const key = `lit${i}`;
        params[key] = `%${escapeLike(lit)}%`;
        return `p.normalized_text LIKE :${key} ESCAPE '\\'`;
      });
      where = `WHERE (${clauses.join(" OR ")}) `;
    }
    const sql =
      `SELECT d.file_name AS file_name, p.document_id AS document_id, ` +
      `p.page_number AS page_number, p.page_text AS page_text, ` +
      `p.normalized_text AS normalized_text ` +
      `FROM ${this.pagesFqn} p JOIN ${this.docsFqn} d ON p.document_id = d.document_id ` +
      `${where}ORDER BY p.document_id, p.page_number LIMIT ${cap}`;
    const rows = await this.query<{
      file_name: string;
      document_id: string;
      page_number: number | bigint;
      page_text: string | null;
      normalized_text: string | null;
    }>(sql, params);
    return rows.map((r) => ({
      documentId: String(r.document_id),
      fileName: r.file_name,
      pageNumber: Number(r.page_number),
      pageText: r.page_text ?? "",
      normalizedText: r.normalized_text ?? "",
    }));
  }

  async getDocument(documentId: string): Promise<DocumentRow | null> {
    const sql =
      `SELECT document_id, file_name, relative_path, volume_path, page_count ` +
      `FROM ${this.docsFqn} WHERE document_id = :id LIMIT 1`;
    const rows = await this.query<{
      document_id: string;
      file_name: string;
      relative_path: string | null;
      volume_path: string | null;
      page_count: number | bigint | null;
    }>(sql, { id: documentId });
    const r = rows[0];
    if (!r) return null;
    return {
      documentId: String(r.document_id),
      fileName: r.file_name,
      relativePath: r.relative_path ?? "",
      volumePath: r.volume_path ?? "",
      pageCount: Number(r.page_count ?? 0),
    };
  }
}

/** Escape LIKE wildcards so literal % and _ are matched literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}
