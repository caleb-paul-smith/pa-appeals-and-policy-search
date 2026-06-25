# pa-appeals-and-policy-search

An internal, lawyer-style research tool for FEMA appeal decisions and policy
PDFs. It searches a **page-level index** of OCR'd PDFs with deterministic
legal-research operators (exact phrase, boolean, proximity), returns ranked
page hits with highlighted snippets, and opens the **original PDF** in an
in-browser reader positioned to the matching page with the matched language
highlighted.

This is **not** a generic RAG chatbot, not a Streamlit dashboard, and not a
notebook UI. The first version prioritizes deterministic behavior over
semantic/AI behavior. It uses **no** external LLM/API, no public CDN, no
third-party document-processing service, and no browser telemetry. All PDF
bytes and extracted text stay inside this Databricks workspace and Unity
Catalog.

---

## How it works

```
                ┌──────────────────────────────────────────────────────────┐
   Browser      │  React + TypeScript client (Vite build, served by Express)│
   (PDF.js)     │  3 panels: Search · Ranked results · PDF reader           │
                └───────────────┬──────────────────────────────────────────┘
                                │  /api/search  /api/status  /pdf/:id
                ┌───────────────▼──────────────────────────────────────────┐
   Express      │  Deterministic query parser → AST                         │
   (Node/TS)    │  Candidate fetch → precise in-app evaluation → ranking    │
                │  PDF stream endpoint (allowlisted volume root only)       │
                └───────┬───────────────────────────┬──────────────────────┘
                        │ SQL warehouse (read-only) │ read-only volume
                ┌───────▼───────────┐       ┌───────▼──────────────────────┐
   Unity        │ Delta index tables │       │ Source PDFs (system of record)│
   Catalog      │ documents + pages  │◀──────│ written once by the indexer   │
                └────────────────────┘ index └───────────────────────────────┘
                                              notebooks/01_build_page_index.py
```

Raw user query text is **never** concatenated into SQL. The query is parsed and
validated in application code; only validated literal terms reach the SQL layer
and only as **bound parameters**. The precise boolean/proximity match is
computed in Node against fetched page text, so results are exact and explainable.

---

## Repository structure

```
pa-appeals-and-policy-search/
├── app.yaml                      # Databricks App manifest (Node.js)
├── config.example.yaml           # Copy to config.yaml and fill in (git-ignored)
├── .env.example                  # Copy to .env or set as App env vars
├── package.json                  # Single package; builds server + client
├── vite.config.ts                # Client build + dev proxy
├── README.md
├── IMPLEMENTATION_STATUS.md
├── notebooks/
│   └── 01_build_page_index.py    # Controlled pilot indexer (Databricks notebook)
├── server/
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts              # Express app, routes, security headers
│       ├── config.ts             # Env/YAML config + mode resolution
│       ├── data/
│       │   ├── source.ts         # IndexSource interface
│       │   ├── demoSource.ts     # In-memory fabricated corpus (Demo Mode)
│       │   ├── demoData.ts       # Fabricated placeholder records
│       │   ├── sqlSource.ts      # Databricks SQL warehouse (Pilot/Prod)
│       │   └── index.ts          # Source factory
│       ├── pdf/
│       │   ├── pathGuard.ts      # Allowlist + path-traversal protection
│       │   ├── pathGuard.test.ts
│       │   └── demoPdf.ts        # In-process demo PDF generation (pdf-lib)
│       └── search/
│           ├── queryParser.ts    # Lexer + recursive-descent parser
│           ├── queryParser.test.ts
│           ├── evaluator.ts      # Match/rank/snippet against page tokens
│           ├── normalize.ts      # Whitespace/lowercase + offset map
│           ├── searchService.ts  # Orchestration
│           └── types.ts
└── client/
    ├── index.html
    ├── tsconfig.json
    └── src/
        ├── main.tsx, App.tsx, api.ts, types.ts, styles.css
        ├── pdf/pdfSetup.ts       # PDF.js worker (bundled locally) + highlight
        └── components/           # SearchPanel, ResultsList, PdfReader, etc.
```

---

## Operating modes

The mode is resolved at startup from configuration:

| Mode | When | Data source |
|------|------|-------------|
| **Demo Mode** | Volume / tables / warehouse not configured | In-memory fabricated placeholder records (no real content). Demo PDFs are generated in-process so the reader works end-to-end. |
| **Pilot Mode** | Volume + index tables + warehouse configured | Reads the governed Delta index via the SQL warehouse and streams real PDFs from the approved volume. |
| **Production Mode** | Same as Pilot, with `APP_MODE=production` | Identical data path; label distinguishes a promoted deployment. |

The current mode, indexed document/page counts, and index freshness are shown in
the header status area.

---

## Query language

| Feature | Example | Meaning |
|---------|---------|---------|
| Plain terms | `procurement reasonable` | Both terms on the same page (implicit AND) |
| Exact phrase | `"direct administrative costs"` | Case-insensitive exact phrase |
| Boolean | `procurement AND reasonable` | `AND` / `OR` / `NOT`, with parentheses |
| Grouping | `("first appeal" OR "second appeal") AND procurement NOT draft` | |
| Proximity | `"force account" NEAR(12) reasonable` | Both within 12 tokens, either order |
| Ordered proximity | `"direct administrative cost" ONEAR(15) "reasonable cost"` | Left must precede right |

Invalid syntax returns a readable validation error and an example. Ranking is
deterministic: exact phrase > proximity > boolean/term, with bonuses for more
matches and tighter proximity.

---

## Discovering candidate source volumes (metadata only)

This tool never scans arbitrary workspace files or document contents to find a
corpus. To identify candidate volumes whose **names** suggest appeals/policy,
run this **read-only metadata** query (it touches only the information schema /
catalog metadata you are entitled to see, not any file contents):

```sql
-- Candidate volumes by name. Adjust the catalog in FROM as needed; repeat per
-- catalog you can access, or query system.information_schema if available.
SELECT volume_catalog, volume_schema, volume_name, volume_type
FROM   <catalog>.information_schema.volumes
WHERE  lower(volume_name)  RLIKE '(appeal|policy|decision|fema|disaster|pa[_-]?)'
   OR  lower(volume_schema) RLIKE '(appeal|policy|decision|fema|disaster)'
ORDER  BY volume_catalog, volume_schema, volume_name;

-- You can also browse with: SHOW VOLUMES IN <catalog>.<schema>;
```

Review the short candidate list, pick the **one** approved volume, and use its
`/Volumes/<catalog>/<schema>/<volume>` path below. Do not point the app at a
volume until its sensitivity/access boundary is approved.

## Configuration steps

> Do this **after** you have chosen and approved a specific source volume and an
> index catalog/schema. Nothing reads PDF content until then.

1. **Choose the source volume and index schema.** Identify the approved Unity
   Catalog volume holding the OCR'd PDFs and the catalog/schema where the index
   tables will live.
2. **Create `config.yaml`** from the template and fill in the placeholders:
   ```bash
   cp config.example.yaml config.yaml
   ```
   Set `appeals_volume_path`, `index_catalog`, `index_schema`, and (optionally)
   table names / `pilot_max_files`. `config.yaml` is git-ignored.
3. **Set environment / app configuration** (`.env` locally, or App env vars in
   deployment):
   - `APPEALS_VOLUME_PATH` — absolute `/Volumes/...` root.
   - `DATABRICKS_WAREHOUSE_ID` — warehouse with read access to the index tables.
   - `DOCUMENTS_TABLE`, `PAGES_TABLE` — fully-qualified `catalog.schema.table`.
   - (local dev only) `DATABRICKS_HOST`, `DATABRICKS_TOKEN`.

When these are present and valid, the app leaves Demo Mode automatically.

---

## Controlled pilot indexing workflow

The indexer is `notebooks/01_build_page_index.py`. It is safe by default: it
**dry-runs**, runs in **pilot mode** (≤ `pilot_max_files`), and refuses to run
against `REPLACE_ME` placeholders or to index the full corpus without explicit
confirmation.

1. Import the notebook into your Databricks workspace (or open it from this repo
   folder if linked as a workspace source folder).
2. Edit the configuration cell to match `config.yaml` (volume path, catalog,
   schema, table names, `PILOT_MAX_FILES`).
3. **Dry run first** (default `DRY_RUN=true`): run all cells and review the
   summary — PDFs discovered/selected, pages that would be written, empty-text
   pages, failures. No tables are written.
4. **Pilot index**: set `DRY_RUN=false`, keep `MODE=pilot`, and run. This
   creates the two Delta tables (if absent) and indexes at most
   `PILOT_MAX_FILES` PDFs. Re-running is idempotent — unchanged files are
   skipped; changed files atomically replace their page rows.
5. **Full index (only when approved)**: set `MODE=full` **and**
   `CONFIRM_FULL_INDEX=INDEX_ALL`. Without both, full mode is refused.

The indexer uses only each PDF's existing text layer via `pypdf` (installed with
a notebook-scoped `%pip install`). It never calls an external OCR service.
Future appeal-metadata columns (`disaster_number`, `appeal_level`, `state`,
`applicant`, `decision_outcome`) are created but left **NULL** in this first run
— populate them later only when reliably sourced (e.g. from a documented
filename/path convention).

---

## App-resource setup (Databricks App UI)

After choosing the source volume and index schema, attach two resources to the
app. **Read-only.** Do not grant additional privileges.

1. **Unity Catalog volume resource (READ ONLY)**
   - App → *Edit* → *Resources* → *Add resource* → **Volume**.
   - Select the approved appeals volume; grant **READ VOLUME** only.
   - Ensure `APPEALS_VOLUME_PATH` (App env var) matches the volume path.
2. **SQL warehouse resource (read access to index tables)**
   - *Add resource* → **SQL warehouse**; name it `sql-warehouse` (matches
     `app.yaml`'s `valueFrom`).
   - The service principal needs `CAN USE` on the warehouse and `SELECT` on the
     two index tables (and `USE CATALOG`/`USE SCHEMA` on their parents).
   - `DATABRICKS_WAREHOUSE_ID` is injected from the attached resource.

> Document-level entitlement note: this pilot assumes **all** indexed documents
> share one sensitivity/access boundary. Per-document entitlement rules (row- or
> document-level filtering tied to the requesting user) will likely be required
> before wider deployment.

---

## Deployment

This is a Node.js Databricks App. `app.yaml` runs `npm run start`, whose
`prestart` builds both the server (`tsc`) and the client (Vite) so a fresh
container deploys cleanly. The server binds to `DATABRICKS_APP_PORT`.

1. Sync this folder to the workspace as the app's source (Databricks App
   *Deploy from workspace folder*).
2. Attach the two resources above and set the App env vars.
3. Deploy. The app serves the built client and API from one process.

Validate the deployment by opening the app: the status chip should read **Pilot
Mode**, with non-zero document/page counts once the index has been built.

---

## Local development

```bash
npm install
npm run dev        # Express on :8080, Vite dev server on :5173 (proxies /api, /pdf)
# open http://localhost:5173
```

Without configuration the app runs in **Demo Mode** with fabricated data so the
full UX (search → ranked results → open PDF → highlight → next/prev match) works
offline.

```bash
npm test           # query-parser + evaluator + path-guard checks
npm run typecheck  # server + client type checks
npm run build      # production build (server/dist + client/dist)
```

---

## Security & data restrictions

- The source volume is **read-only**; original PDFs remain the system of record.
- The browser never supplies a file path. `/pdf/:id` resolves a document id to a
  stored path, validates it is strictly under `APPEALS_VOLUME_PATH`, rejects
  path traversal and non-`.pdf` files, and streams `application/pdf`.
- No PDF bytes or extracted text are uploaded, exported, mirrored, or sent to any
  external service. No public/third-party search or PDF API is used.
- The PDF.js worker is bundled from the local dependency — no CDN.
- A restrictive Content-Security-Policy (`default-src 'self'`, no external
  origins), plus `X-Content-Type-Options`, `X-Frame-Options`, and
  `Referrer-Policy: no-referrer`, is applied to all responses.
- Extracted text is rendered via safe DOM text nodes; no raw PDF text is ever
  injected as HTML.
- Test fixtures, demo content, and docs contain **no** real appeal text and no
  real internal document names.

---

## Known limitations (first pilot)

- **Deterministic only** — no semantic/embedding search, no Vector Search,
  Genie, or Model Serving.
- **Match navigation is per rendered page.** The reader opens to the result's
  page and highlights/navigates matches on the displayed page(s); cross-page
  match counting is not yet global.
- **Phrase highlighting in the reader** is applied within text-layer runs. For
  PDFs whose text layer splits a phrase across runs, individual matched terms
  highlight reliably but a phrase spanning runs may highlight partially. The
  results-list snippet highlighting is always exact.
- **Appeal metadata is null** (disaster number, appeal level, state, applicant,
  outcome) until reliably sourced.
- **Single access boundary** — no per-document entitlement enforcement yet.
- The coarse SQL prefilter uses `LIKE` on normalized text; precise correctness
  is enforced in app code, but very large corpora may need a proper inverted
  index for performance.

---

## Recommended second-phase enhancements

1. Global, cross-page match navigation with a virtualized multi-page reader.
2. Per-document / row-level entitlement enforcement tied to the requesting user.
3. Reliable appeal-metadata extraction (documented filename/path conventions,
   then optional structured parsing) to enable faceted filtering.
4. An inverted-index or Databricks-native full-text approach for scale, keeping
   the deterministic operators.
5. Optional semantic re-ranking as a clearly-labeled secondary mode (never
   replacing the deterministic results), using in-workspace embeddings/Model
   Serving only.
6. Saved searches, result export within the workspace, and audit logging.
7. Phrase-across-run highlighting in the reader via text-item span stitching.
