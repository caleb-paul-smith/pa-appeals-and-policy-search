// Source factory: pick the data source based on resolved app mode.

import type { AppConfig } from "../config";
import { ChunksSqlSource } from "./chunksSqlSource";
import { DemoSource } from "./demoSource";
import { SqlSource } from "./sqlSource";
import type { IndexSource } from "./source";

export function createSource(config: AppConfig): IndexSource {
  if (config.mode === "demo") {
    return new DemoSource();
  }
  // Prefer the dedicated page-index tables when they have been built; otherwise
  // run keyword search against the Vector Search chunks table.
  if (config.documentsTableFqn && config.pagesTableFqn) {
    return new SqlSource(config);
  }
  return new ChunksSqlSource(config);
}
