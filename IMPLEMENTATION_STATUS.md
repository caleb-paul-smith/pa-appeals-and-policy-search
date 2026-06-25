# Implementation status

Snapshot of what is built, what you must provide, and the single next action.

## ✅ Built and validated (runs today in Demo Mode)

- **Node.js + TypeScript Databricks App scaffold**: single `package.json`,
  `app.yaml` (Node, dynamic `DATABRICKS_APP_PORT`, `prestart` build), `.gitignore`.
- **Express backend** serving the API and the built client from one process,
  with hardened headers (CSP `default-src 'self'`, no external origins).
- **Deterministic query engine** — lexer + recursive-descent parser + evaluator:
  plain terms (implicit AND), exact phrases, `AND`/`OR`/`NOT`, parentheses,
  `NEAR(n)`, and ordered `ONEAR(n)`. Invalid syntax → readable error + example.
  Raw query text is never put into SQL.
- **Deterministic ranking** (exact phrase > proximity > boolean/term, with
  match-count and proximity-tightness bonuses) and **safe snippet highlighting**.
- **Secure PDF endpoint** — id → stored path → allowlist + path-traversal guard
  → `application/pdf` stream. Browser never supplies a path.
- **React three-panel UI** — search controls + advanced-syntax drawer + pilot
  boundaries panel; ranked results with match type, snippet, explanation;
  PDF.js reader with open-to-page, selectable text layer, highlight,
  Previous/Next Match + counter, page controls, zoom, clear; query + selection
  preserved in the URL.
- **Demo Mode** — fabricated placeholder records only (no real text/names);
  demo PDFs generated in-process so the full UX works offline.
- **Pilot/Production SQL data source** — parameterized queries against the two
  Delta index tables via a configured SQL warehouse.
- **Indexer notebook** — `notebooks/01_build_page_index.py`: pilot-capped,
  dry-run-by-default, idempotent, records failures, `pypdf` text-layer only.
- **Tests** — query parser/evaluator (22) and path-guard security (10), all green.
- **Build checks** — `npm run build` (server `tsc` + client Vite) and
  `npm run typecheck` both pass in this environment.

## 🟡 Configuration values you must provide (after you approve a source)

| Setting | Where | Example |
|---------|-------|---------|
| `appeals_volume_path` / `APPEALS_VOLUME_PATH` | `config.yaml` / App env | `/Volumes/<cat>/<schema>/appeals_volume` |
| `index_catalog`, `index_schema` | `config.yaml` | your governed catalog/schema |
| `DOCUMENTS_TABLE`, `PAGES_TABLE` | App env | `cat.schema.appeal_research_documents` … |
| `DATABRICKS_WAREHOUSE_ID` | App resource / env | from the attached SQL warehouse |
| `DATABRICKS_HOST` / `DATABRICKS_TOKEN` | local dev only | for `npm run dev` against real tables |

No real volume path, catalog, schema, warehouse id, token, or secret is
hardcoded anywhere in the repo.

## 🟡 Databricks resources to attach (read-only)

1. **Unity Catalog volume** resource for the approved PDFs — **READ VOLUME** only.
2. **SQL warehouse** resource (`sql-warehouse`) — `CAN USE` + `SELECT` on the two
   index tables only.

See README → *App-resource setup* for exact UI steps. Do not grant additional
privileges or alter existing permissions.

## ⛔ Not done by design (awaiting your approval)

- No real Unity Catalog metadata was enumerated and no PDF content was read —
  this environment has no Databricks credentials, and per your instructions
  nothing reads document contents until you configure and approve a specific
  source volume path.
- The app has not been deployed and the full corpus has not been scanned.

## 👉 The one next action for you

**Choose and approve the source volume + index schema, then run the indexer dry
run.** Concretely, in your Databricks workspace:

```
1. Tell me (or set in config.yaml) the approved values for:
     appeals_volume_path, index_catalog, index_schema
2. Open notebooks/01_build_page_index.py, set those values, keep DRY_RUN=true,
   and run all cells to review the discovery summary.
3. When the dry-run summary looks right, set DRY_RUN=false (MODE=pilot) to build
   the pilot index, then attach the two app resources and deploy.
```

Because I cannot see your Unity Catalog metadata from this environment, I could
not present candidate appeals/policy volumes automatically — **please share the
candidate catalogs/schemas/volumes (or run the metadata query in the README), and
I will help you pick the exact path before any PDF content is read.**
