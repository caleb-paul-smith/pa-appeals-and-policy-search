# Databricks Genie Change Brief

## Purpose

This folder now contains the Databricks App implementation for `pa-appeals-and-policy-search`. The app has been migrated from the previous Python/Gradio entry point to a Node.js, TypeScript, Express, React, and Vite stack while preserving the live semantic search and admin refresh behavior described in `MIGRATION_PLAN.ipynb`.

The processor notebook remains unchanged:

- `PA Appeals PDF Incremental Processor.ipynb`
- Workspace path used by the app: `/Users/0492734585@fema.dhs.gov/pa-appeals-and-policy-search/PA Appeals PDF Incremental Processor`

## Runtime Change

`app.yaml` now starts the Node application:

```yaml
command:
  - npm
  - run
  - start
```

`npm run start` runs `prestart`, which builds the server and client first:

```text
prestart -> npm run build
build -> npm run build:server && npm run build:client
start -> node server/dist/index.js
```

This means Databricks should install dependencies from `package.json` / `package-lock.json`, build the TypeScript server and Vite client, then serve the app from one Express process.

## Environment Configuration

`app.yaml` now defines these app environment values:

- `DATABRICKS_HOST`: `https://adb-5672234203219303.3.azuredatabricks.net`
- `VS_INDEX_NAME`: `tws_ro_region5.rcd.pa_appeals_chunks_vs_index`
- `VS_ENDPOINT_NAME`: `pa-appeals-search-endpoint`
- `PROCESSOR_NOTEBOOK_PATH`: `/Users/0492734585@fema.dhs.gov/pa-appeals-and-policy-search/PA Appeals PDF Incremental Processor`
- `APPEALS_VOLUME_PATH`: `/Volumes/tws_ro_region5/rcd/pa_second_appeals`
- `DATABRICKS_WAREHOUSE_ID`: pulled from the Databricks App resource named `sql-warehouse`
- `DOCUMENTS_TABLE`: blank until the deterministic index tables are built
- `PAGES_TABLE`: blank until the deterministic index tables are built

With blank deterministic table names, deterministic search runs in demo mode. Semantic search can run live immediately when the Databricks forwarded user token is present.

## Backend Changes

### Express App

The Express entry point is `server/src/index.ts`.

Existing routes preserved:

- `GET /api/health`
- `GET /api/status`
- `GET /api/search`
- `GET /api/document/:id`
- `GET /pdf/:id`

New routes added:

- `POST /api/semantic-search`
- `GET /api/admin/stats`
- `POST /api/admin/refresh`
- `GET /api/admin/status/:runId`

All semantic and admin Databricks calls forward the browser request header `X-Forwarded-Access-Token`. The app does not substitute a service principal token for these actions.

### Semantic Search Proxy

New file:

- `server/src/semantic/vectorSearch.ts`

Behavior:

- Accepts a query and result count from the React client.
- Posts to Databricks Vector Search:
  - `/api/2.0/vector-search/indexes/{VS_INDEX_NAME}/query`
- Requests these columns:
  - `chunk_id`
  - `filename`
  - `page_number`
  - `chunk_type`
  - `chunk_text`
- Normalizes Vector Search rows into the shared `SearchResult` shape:
  - `matchType: "semantic"`
  - raw Vector Search score
  - 500-character snippet
  - empty `highlightTerms`
  - `matchCount: 1`

If `DATABRICKS_HOST` or `VS_INDEX_NAME` is not configured, semantic search returns an explicit demo response so local development still works.

### Admin Proxy

New file:

- `server/src/admin/databricksAdmin.ts`

Admin functions:

- Index stats:
  - Calls `GET /api/2.0/vector-search/indexes/{VS_INDEX_NAME}`
  - Returns indexed row count, ready flag, status message, and index name
- Manual refresh:
  - Calls `POST /api/2.1/jobs/runs/submit`
  - Submits the existing processor notebook using `source: "WORKSPACE"`
  - Uses the dependency spec from the prior Python app: `dependencies: ["pypdf"]`
- Run status:
  - Calls `GET /api/2.1/jobs/runs/get?run_id={runId}`
  - Returns lifecycle state, result state, status label, start time, end time, and error message when present

## Deterministic Search Changes

Updated files:

- `server/src/search/types.ts`
- `server/src/search/queryParser.ts`
- `server/src/search/evaluator.ts`
- `server/src/search/queryParser.test.ts`

### Wildcard / Truncation

Syntax:

```text
administrat*
```

Behavior:

- The lexer emits a wildcard node for bare terms ending in `*`.
- The parser stores the normalized prefix.
- The evaluator matches any token whose normalized text starts with that prefix.
- Matching full token values are added to highlight literals.

### ATLEAST Frequency Operator

Syntax:

```text
ATLEAST3(procurement)
ATLEAST2("direct administrative costs")
```

Behavior:

- The lexer recognizes `ATLEAST` followed by a positive integer.
- The parser treats it as a unary operator.
- The evaluator checks that the inner expression has at least the requested number of matches on the page.
- Matching spans and highlight literals from the inner expression are preserved when the threshold is met.

### Tests

Parser/evaluator tests now cover:

- Wildcard success and miss cases
- Wildcard positive literal extraction
- ATLEAST success and failure cases
- ATLEAST with a repeated phrase

## Frontend Changes

### Top-Level Tabs

Updated file:

- `client/src/App.tsx`

The app now has two top-level tabs:

- Search
- Admin

The header and status bar remain visible on both tabs.

### Search Modes

Updated file:

- `client/src/components/SearchPanel.tsx`

The Search tab now has a mode toggle above the query box:

- Deterministic
- Semantic

Deterministic is the default. The Advanced syntax drawer appears only in deterministic mode. Semantic mode uses the Vector Search route and displays a concise mode hint.

### Query History

Search history is stored in browser `localStorage`:

```text
pa-search-history
```

Behavior:

- Keeps the most recent 20 queries.
- De-duplicates repeated queries.
- Shows recent queries while the query textarea is focused.
- Clicking a recent query populates and submits it.

### Results Grouping

Updated file:

- `client/src/components/ResultsList.tsx`

The results header now includes a `Group by document` toggle.

Behavior:

- Default is ungrouped.
- Grouped mode renders collapsible document sections.
- Semantic results have a distinct `Semantic` badge.

Important limitation:

Semantic Vector Search currently returns chunk identity and filename but not the deterministic document id or volume-relative PDF path. Therefore semantic results can be listed and ranked, but PDF preview requires a follow-up document mapping.

### Admin Panel

New file:

- `client/src/components/AdminPanel.tsx`

The Admin tab provides:

- Refreshable Vector Search index stats
- Manual processor notebook refresh
- Run status lookup
- Automatic polling every 5 seconds while a run is `RUNNING` or `PENDING`

## Styling Changes

Updated file:

- `client/src/styles.css`

Added styling for:

- Search/Admin tabs
- Deterministic/Semantic segmented control
- Query history dropdown
- Grouped result sections
- Semantic match badge
- Admin panel sections, stat grids, messages, and errors
- Narrow viewport layout for admin and results controls

## Dependency Files

Added to the Databricks product folder:

- `package.json`
- `package-lock.json`
- `vite.config.ts`
- `server/`
- `client/`
- `notebooks/01_build_page_index.py`
- `.gitignore`

Removed from the Databricks product folder:

- `app.py`
- `requirements.txt`
- empty `MIGRATION_PLAN.md`

The app no longer depends on Gradio. The Python processor notebook remains in place and is called by the Admin refresh route.

`node_modules/` is intentionally not included. Dependencies are represented by `package.json` and `package-lock.json`; Databricks should install from the lockfile during app setup/startup.

## Validation Performed

Commands run from this folder:

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Results:

- `npm ci`: completed from `package-lock.json`
- `npm test`: passed
  - 30 parser/evaluator checks
  - 10 path guard checks
- `npm run typecheck`: passed
- `npm run build`: passed outside the local sandbox

The first local Vite build attempt failed only because the local sandbox blocked an ancestor-directory read. The same build passed outside the sandbox.

## Issues To Check In Databricks

1. Confirm the Databricks App has a resource named `sql-warehouse`.
2. Confirm the `sql-warehouse` resource resolves into `DATABRICKS_WAREHOUSE_ID`.
3. Confirm `X-Forwarded-Access-Token` is present in requests to the app.
4. Confirm the caller has permission to query the Vector Search index.
5. Confirm the caller has permission to submit and inspect Jobs API runs.
6. Confirm the processor notebook path has not changed.
7. Confirm whether all authenticated users should see the Admin tab or whether it should be role-gated.
8. Confirm whether the Vector Search chunks table can expose a document id or relative PDF path for semantic result preview.

## Recommendations

1. Add document identity to semantic search results.
   - Best option: include a stable deterministic `document_id` and `relative_path` in the chunks table and Vector Search index.
   - This would allow semantic hits to open the original PDF at the matching page.

2. Gate the Admin tab.
   - If refresh actions should not be available to every authenticated app user, add server-side authorization checks before the admin routes execute.

3. Build and configure the deterministic Delta index tables.
   - Run `notebooks/01_build_page_index.py` after setting catalog/schema values.
   - Then set `DOCUMENTS_TABLE` and `PAGES_TABLE` in `app.yaml`.

4. Review npm audit findings.
   - `npm ci` reported 5 audit findings in dependencies: 2 moderate and 3 high.
   - Do not run `npm audit fix --force` without testing because it can introduce breaking upgrades.

5. Consider code-splitting PDF.js.
   - The production build warns that one client chunk exceeds 500 kB.
   - This is expected with PDF.js, but dynamic import of the PDF reader could reduce initial Search/Admin load size.

6. Watch the Vite CJS API deprecation warning.
   - Build currently passes.
   - A later cleanup can move the Vite config/package setup to the current ESM-preferred path if needed.
