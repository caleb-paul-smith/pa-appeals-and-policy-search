// Allowlist + path-traversal protection for serving PDFs from the approved
// Unity Catalog volume. The browser NEVER supplies a path — only a document id,
// which is resolved to a stored path here and then validated against the
// configured volume root.

import path from "node:path";

export interface PathGuardResult {
  ok: boolean;
  resolvedPath?: string;
  reason?: string;
}

/**
 * Validate that `storedPath` (from the documents table) resolves to a real
 * location strictly inside `volumeRoot`, and is a .pdf file.
 */
export function validateVolumePath(volumeRoot: string, storedPath: string): PathGuardResult {
  if (!volumeRoot || !volumeRoot.startsWith("/Volumes/")) {
    return { ok: false, reason: "Volume root is not configured or not under /Volumes/." };
  }
  if (!storedPath) {
    return { ok: false, reason: "Document has no stored path." };
  }
  // Reject obviously hostile inputs early.
  if (storedPath.includes("\0")) {
    return { ok: false, reason: "Illegal path." };
  }

  const root = path.resolve(volumeRoot);
  // A stored path may be absolute (under the volume) or volume-relative.
  const candidate = path.isAbsolute(storedPath)
    ? path.resolve(storedPath)
    : path.resolve(root, storedPath);

  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) {
    return { ok: false, reason: "Resolved path escapes the approved volume root." };
  }
  if (path.extname(candidate).toLowerCase() !== ".pdf") {
    return { ok: false, reason: "Only .pdf files may be served." };
  }
  return { ok: true, resolvedPath: candidate };
}
