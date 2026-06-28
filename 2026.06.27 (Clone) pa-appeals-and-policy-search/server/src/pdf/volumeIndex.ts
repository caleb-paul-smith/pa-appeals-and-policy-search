// Basename -> absolute-path resolver for PDFs stored under the approved volume.
//
// Why this exists: the Vector Search chunks table records only a PDF *basename*
// (e.g. "FEMA-1561-DR-FL Town of Windermere.pdf"), but the files live nested by
// era/year under the volume root (e.g. ".../pa_second_appeals/2009-2025/2018/").
// To open a keyword/semantic hit's source PDF we must map the basename back to
// its real path. We scan the volume once (lazily) and cache the result.
//
// This is a stop-gap until the chunks table carries a `relative_path` column.
// Path safety is still enforced separately by validateVolumePath().

import fs from "node:fs";
import path from "node:path";

// Guardrail so a pathological tree can't be walked unboundedly.
const MAX_FILES_SCANNED = 200_000;

interface VolumeIndexEntry {
  byBasename: Map<string, string>;
  duplicates: number;
}

const cache = new Map<string, VolumeIndexEntry>();

function buildIndex(volumeRoot: string): VolumeIndexEntry {
  const byBasename = new Map<string, string>();
  let duplicates = 0;
  let scanned = 0;

  const stack: string[] = [volumeRoot];
  while (stack.length > 0) {
    if (scanned >= MAX_FILES_SCANNED) {
      console.warn(
        `[volumeIndex] Stopped scanning ${volumeRoot} after ${MAX_FILES_SCANNED} files.`
      );
      break;
    }
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable directory — skip
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
        scanned++;
        if (byBasename.has(entry.name)) {
          duplicates++;
          continue; // keep the first occurrence
        }
        byBasename.set(entry.name, full);
      }
    }
  }
  if (duplicates > 0) {
    console.warn(
      `[volumeIndex] ${duplicates} duplicate PDF basename(s) under ${volumeRoot}; kept first seen.`
    );
  }
  return { byBasename, duplicates };
}

/**
 * Resolve a PDF basename to its absolute path under `volumeRoot`, scanning and
 * caching the volume on first use. Returns null when the volume is unconfigured,
 * unreadable, or the basename is not found. Pass `forceRefresh` to rebuild.
 */
export function findPdfByBasename(
  volumeRoot: string,
  basename: string,
  forceRefresh = false
): string | null {
  if (!volumeRoot || !basename) return null;
  if (!fs.existsSync(volumeRoot)) return null;

  let index = cache.get(volumeRoot);
  if (!index || forceRefresh) {
    index = buildIndex(volumeRoot);
    cache.set(volumeRoot, index);
  }
  return index.byBasename.get(basename) ?? null;
}

/** Test/operational helper: drop the cached scan for a root (or all roots). */
export function clearVolumeIndexCache(volumeRoot?: string): void {
  if (volumeRoot) cache.delete(volumeRoot);
  else cache.clear();
}
