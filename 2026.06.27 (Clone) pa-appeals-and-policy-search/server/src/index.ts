// Express entry point. Serves the API and the built React client from a single
// process bound to the Databricks-provided app port.

import path from "node:path";
import fs from "node:fs";
import express, { type Request, type Response } from "express";
import { getConfig, getPort } from "./config";
import { createSource } from "./data";
import { runSearch } from "./search/searchService";
import { QUERY_EXAMPLE } from "./search/queryParser";
import { validateVolumePath } from "./pdf/pathGuard";
import { runSemanticSearch } from "./semantic/vectorSearch";
import {
  AuthError,
  fetchAdminStats,
  fetchRunStatus,
  triggerRefresh,
} from "./admin/databricksAdmin";
import { requireAdmin, isCallerAdmin } from "./admin/adminAuth";

const config = getConfig();
const source = createSource(config);
const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

// Conservative security headers. The PDF.js worker and inline styles require a
// permissive-but-bounded CSP; no external origins are allowed.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
    ].join("; ")
  );
  next();
});

const BOUNDARIES =
  "Original PDFs remain in Unity Catalog. This pilot searches an internal " +
  "page-level index and serves PDFs only from the configured approved volume. " +
  "It does not upload documents to external services, replace source-record " +
  "controls, or make legal or policy determinations.";

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/status", async (_req: Request, res: Response) => {
  try {
    const stats = await source.stats();
    res.json({
      mode: config.mode,
      sourceKind: source.kind,
      stats,
      boundaries: BOUNDARIES,
      queryExample: QUERY_EXAMPLE,
      // Non-secret config echo for the status panel.
      config: {
        documentsTable: config.documentsTableFqn || null,
        pagesTable: config.pagesTableFqn || null,
        warehouseConfigured: config.hasWarehouse,
        volumeConfigured: !!config.appealsVolumePath,
        vectorSearchConfigured: !!config.vsIndexName,
        pilotMaxFiles: config.pilotMaxFiles,
      },
    });
  } catch (err) {
    res.status(503).json({
      mode: config.mode,
      error: "Index status unavailable.",
      detail: safeMessage(err),
    });
  }
});

app.get("/api/search", async (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  try {
    const response = await runSearch(q, source, config);
    if (!response.ok) {
      return res.status(400).json(response);
    }
    res.json(response);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Search failed.",
      detail: safeMessage(err),
      query: q,
      results: [],
    });
  }
});

app.post("/api/semantic-search", async (req: Request, res: Response) => {
  const q = typeof req.body?.query === "string" ? req.body.query : "";
  const numResults = Number(req.body?.numResults ?? 10);
  try {
    const response = await runSemanticSearch(q, numResults, forwardedUserToken(req), config);
    if (!response.ok) {
      return res.status(response.error?.startsWith("No user authentication token") ? 401 : 400).json(response);
    }
    res.json(response);
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: "Semantic search failed.",
      detail: safeMessage(err),
      query: q,
      results: [],
      candidatesScanned: 0,
      truncated: false,
    });
  }
});

// Admin access check — called by the frontend to decide whether to show the Admin tab.
app.get("/api/admin/check", async (req: Request, res: Response) => {
  const allowed = await isCallerAdmin(forwardedUserToken(req), config);
  res.json({ admin: allowed });
});

// All remaining admin routes require the caller to be in the ADMIN_USERS list.
const adminGate = requireAdmin(config);

app.get("/api/admin/stats", adminGate, async (req: Request, res: Response) => {
  try {
    res.json(await fetchAdminStats(forwardedUserToken(req), config));
  } catch (err) {
    sendDatabricksError(res, err, "Could not fetch Vector Search stats.");
  }
});

app.post("/api/admin/refresh", adminGate, async (req: Request, res: Response) => {
  try {
    res.json(await triggerRefresh(forwardedUserToken(req), config));
  } catch (err) {
    sendDatabricksError(res, err, "Could not trigger refresh.");
  }
});

app.get("/api/admin/status/:runId", adminGate, async (req: Request, res: Response) => {
  try {
    res.json(await fetchRunStatus(req.params.runId, forwardedUserToken(req), config));
  } catch (err) {
    sendDatabricksError(res, err, "Could not fetch run status.");
  }
});

app.get("/api/document/:id", async (req: Request, res: Response) => {
  try {
    const doc = await source.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: "Document not found." });
    // Never expose the absolute volume path to the browser.
    res.json({
      documentId: doc.documentId,
      fileName: doc.fileName,
      relativePath: doc.relativePath,
      pageCount: doc.pageCount,
    });
  } catch (err) {
    res.status(500).json({ error: "Could not load document.", detail: safeMessage(err) });
  }
});

// Stream the original PDF. The browser supplies only a document id; the path is
// resolved server-side and validated against the approved volume root.
app.get("/pdf/:id", async (req: Request, res: Response) => {
  try {
    const doc = await source.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: "Document not found." });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${sanitizeFilename(doc.fileName)}"`);

    // Demo mode: synthesize a PDF in-process.
    if (source.kind === "demo" && source.getDemoPdf) {
      const buf = await source.getDemoPdf(doc.documentId);
      if (!buf) return res.status(404).json({ error: "Demo document not found." });
      return res.end(buf);
    }

    // Pilot / production: stream the file from the approved volume only.
    const guard = validateVolumePath(config.appealsVolumePath, doc.volumePath);
    if (!guard.ok || !guard.resolvedPath) {
      return res.status(403).json({ error: "Access denied.", detail: guard.reason });
    }
    if (!fs.existsSync(guard.resolvedPath)) {
      return res.status(404).json({ error: "Source PDF not found in volume." });
    }
    const stream = fs.createReadStream(guard.resolvedPath);
    stream.on("error", () => {
      if (!res.headersSent) res.status(500);
      res.end();
    });
    stream.pipe(res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: "Could not serve PDF.", detail: safeMessage(err) });
    }
  }
});

// --- Static client ---------------------------------------------------------
const clientDist = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback for non-API routes.
  app.get(/^(?!\/api|\/pdf).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res
      .status(200)
      .send("Client build not found. Run `npm run build` then restart, or use `npm run dev`.");
  });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200);
}

function safeMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Avoid leaking absolute volume paths in error detail.
  return msg.replace(/\/Volumes\/[^\s"]*/g, "/Volumes/<redacted>");
}

function forwardedUserToken(req: Request): string | undefined {
  const header = req.header("x-forwarded-access-token");
  return header?.trim() || undefined;
}

function sendDatabricksError(res: Response, err: unknown, error: string): void {
  res.status(err instanceof AuthError ? 401 : 502).json({
    error,
    detail: safeMessage(err),
  });
}

const port = getPort();
app.listen(port, () => {
  console.log(
    `[pa-appeals-and-policy-search] listening on :${port} — mode=${config.mode}, source=${source.kind}`
  );
});
