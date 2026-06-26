// Source factory: pick the data source based on resolved app mode.

import type { AppConfig } from "../config";
import { DemoSource } from "./demoSource";
import { SqlSource } from "./sqlSource";
import type { IndexSource } from "./source";

export function createSource(config: AppConfig): IndexSource {
  if (config.mode === "demo") {
    return new DemoSource();
  }
  return new SqlSource(config);
}
