// Runtime configuration + mode resolution.
//
// Precedence: environment variables > config.yaml > built-in defaults.
// When the source volume / index tables / warehouse are NOT configured, the
// app runs in clearly-labeled DEMO MODE with fabricated records only.

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import dotenv from "dotenv";

dotenv.config();

export type AppMode = "demo" | "pilot" | "production";

export interface AppConfig {
  mode: AppMode;
  appealsVolumePath: string; // "" in demo mode
  indexCatalog: string;
  indexSchema: string;
  documentsTable: string; // unqualified name
  pagesTable: string; // unqualified name
  documentsTableFqn: string; // catalog.schema.table or "" in demo
  pagesTableFqn: string;
  pilotMaxFiles: number;
  warehouseId: string;
  databricksHost: string;
  hasWarehouse: boolean;
  // hard caps
  maxCandidatePages: number;
  maxResults: number;
}

interface YamlConfig {
  appeals_volume_path?: string;
  index_catalog?: string;
  index_schema?: string;
  documents_table?: string;
  pages_table?: string;
  pilot_max_files?: number;
}

function loadYaml(): YamlConfig {
  const configPath = process.env.CONFIG_PATH || "config.yaml";
  const abs = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(abs)) return {};
  try {
    const raw = fs.readFileSync(abs, "utf8");
    const parsed = yaml.load(raw) as YamlConfig | undefined;
    return parsed ?? {};
  } catch (err) {
    console.warn(`[config] Could not parse ${abs}: ${(err as Error).message}`);
    return {};
  }
}

function isPlaceholder(v: string | undefined): boolean {
  return !v || v.includes("REPLACE_ME") || v.trim() === "";
}

function buildFqn(catalog: string, schema: string, table: string): string {
  if (isPlaceholder(catalog) || isPlaceholder(schema) || !table) return "";
  return `${catalog}.${schema}.${table}`;
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const y = loadYaml();

  const appealsVolumePath = (process.env.APPEALS_VOLUME_PATH || y.appeals_volume_path || "").trim();
  const indexCatalog = (process.env.INDEX_CATALOG || y.index_catalog || "").trim();
  const indexSchema = (process.env.INDEX_SCHEMA || y.index_schema || "").trim();
  const documentsTable = (y.documents_table || "appeal_research_documents").trim();
  const pagesTable = (y.pages_table || "appeal_research_pages").trim();
  const pilotMaxFiles = Number(y.pilot_max_files ?? 25) || 25;
  const warehouseId = (process.env.DATABRICKS_WAREHOUSE_ID || "").trim();
  const databricksHost = (process.env.DATABRICKS_HOST || "").trim();

  // Env-provided fully-qualified table names take precedence if present.
  const documentsTableFqn =
    (process.env.DOCUMENTS_TABLE || "").trim() ||
    buildFqn(indexCatalog, indexSchema, documentsTable);
  const pagesTableFqn =
    (process.env.PAGES_TABLE || "").trim() || buildFqn(indexCatalog, indexSchema, pagesTable);

  const volumeConfigured = !isPlaceholder(appealsVolumePath) && appealsVolumePath.startsWith("/Volumes/");
  const tablesConfigured = !!documentsTableFqn && !!pagesTableFqn;
  const hasWarehouse = !!warehouseId;

  let mode: AppMode = "demo";
  if (volumeConfigured && tablesConfigured && hasWarehouse) {
    mode = process.env.APP_MODE === "production" ? "production" : "pilot";
  }

  cached = {
    mode,
    appealsVolumePath: volumeConfigured ? appealsVolumePath : "",
    indexCatalog,
    indexSchema,
    documentsTable,
    pagesTable,
    documentsTableFqn,
    pagesTableFqn,
    pilotMaxFiles,
    warehouseId,
    databricksHost,
    hasWarehouse,
    maxCandidatePages: Number(process.env.MAX_CANDIDATE_PAGES || 2000),
    maxResults: Number(process.env.MAX_RESULTS || 100),
  };
  return cached;
}

/** The port to bind: Databricks injects DATABRICKS_APP_PORT. */
export function getPort(): number {
  return Number(process.env.DATABRICKS_APP_PORT || process.env.PORT || 8080);
}
