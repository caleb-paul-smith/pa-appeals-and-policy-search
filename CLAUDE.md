# CLAUDE.md

## Purpose

This file is intentionally committed at the repository root as operating context for Claude Code or another coding agent working in this repo.

Do not copy this file into the Databricks product folder when moving only that folder into another repository or workspace. It is repo-level engineering guidance, not a deployable app artifact.

## Product Goal

Build `pa-appeals-and-policy-search` into a professional, efficient, FEMA-wide search product for Public Assistance appeals and related policy PDFs.

The target user experience is:

- deterministic legal-style search for exact phrases, boolean logic, proximity, wildcard, and frequency queries;
- semantic search over embedded PDF chunks;
- source PDF preview by document and page;
- one-button onboarding of new PDF stacks;
- governed access through Databricks Unity Catalog;
- clear operational status for indexing, vector sync, and failures.

Treat this as a production product, not a demo notebook.

## Repository Layout

- Root repo: GitHub staging/work area.
- Databricks product folder: `pa-appeals-and-policy-search - Databricks Product/`.
- Databricks app manifest: `pa-appeals-and-policy-search - Databricks Product/app.yaml`.
- App server: `pa-appeals-and-policy-search - Databricks Product/server/`.
- App client: `pa-appeals-and-policy-search - Databricks Product/client/`.
- Existing processor notebook: `pa-appeals-and-policy-search - Databricks Product/PA Appeals PDF Incremental Processor.ipynb`.
- Migration plan notebook: `pa-appeals-and-policy-search - Databricks Product/MIGRATION_PLAN.ipynb`.
- Databricks Genie handoff brief: `pa-appeals-and-policy-search - Databricks Product/DATABRICKS_GENIE_CHANGE_BRIEF.md`.

## Current Implemented State

The Databricks product folder has already been migrated from Python/Gradio to a Node.js, TypeScript, Express, React, and Vite Databricks App.

Implemented:

- `app.yaml` runs `npm run start`.
- `package.json` / `package-lock.json` define the dependency contract.
- Express serves the API and built React client.
- Deterministic search engine supports:
  - terms,
  - phrases,
  - `AND`,
  - `OR`,
  - `NOT`,
  - `NEAR(n)`,
  - `ONEAR(n)`,
  - wildcard/truncation such as `administrat*`,
  - frequency syntax such as `ATLEAST3(procurement)`.
- Semantic search proxy route exists:
  - `POST /api/semantic-search`.
- Admin routes exist:
  - `GET /api/admin/stats`,
  - `POST /api/admin/refresh`,
  - `GET /api/admin/status/:runId`.
- React UI includes:
  - Search/Admin tabs,
  - deterministic/semantic mode toggle,
  - query history,
  - grouped results,
  - Admin panel for stats, refresh, and run status.

Old files removed from the Databricks product folder:

- `app.py`,
- `requirements.txt`,
- empty migration Markdown placeholders.

## Current Databricks Assets

Known existing assets from the migration plan:

- App name: `pa-appeals-and-policy-search`
- Current PDF volume: `/Volumes/tws_ro_region5/rcd/pa_second_appeals`
- Current Vector/AI Search index: `tws_ro_region5.rcd.pa_appeals_chunks_vs_index`
- Current chunks table: `tws_ro_region5.rcd.pa_appeals_chunks_vs`
- Current Vector Search endpoint: `pa-appeals-search-endpoint`
- Databricks host: `https://adb-5672234203219303.3.azuredatabricks.net`
- Processor notebook workspace path: `/Users/0492734585@fema.dhs.gov/pa-appeals-and-policy-search/PA Appeals PDF Incremental Processor`

Do not move or rename the processor notebook unless the user explicitly asks and the downstream Power Automate/job dependencies are accounted for.

## Critical Engineering Rules

- Forward the caller's `X-Forwarded-Access-Token` for semantic search and admin actions. Do not replace it with an app-level service principal token.
- Do not hard-code secrets, personal access tokens, warehouse credentials, or private account values outside explicit environment configuration.
- Keep generated artifacts out of source control:
  - `node_modules/`,
  - `client/dist/`,
  - `server/dist/`.
- Keep `package-lock.json` committed. Databricks should install dependencies from the lockfile.
- Preserve local demo/stub behavior when Databricks env vars are absent.
- Add or update tests when parser, search behavior, path handling, admin routes, or indexing logic changes.
- Keep UI professional and operational: clear status, errors, progress, and next actions.

## Major Known Gap

Semantic results currently come from Vector/AI Search chunks and include chunk/file/page data, but they do not yet reliably include all metadata needed to open the source PDF:

- `corpus_id`,
- `document_id`,
- `source_path`,
- `relative_path`,
- `page_number`,
- `chunk_id`.

Fixing this is essential before the semantic mode feels production-complete.

## Next Major Feature: Corpus Onboarding

The user wants an easy way to point the app at new stacks of PDFs and make them searchable by deterministic and semantic search with one button.

Implement this as governed corpus onboarding.

Core model:

- `Corpus`: one searchable stack of PDFs.
- `Document`: one PDF.
- `Page`: extracted page text.
- `Chunk`: semantic search unit.
- `Index Run`: operational history for ingestion/vector sync.

Recommended storage pattern:

- raw PDFs live in Unity Catalog Volumes or governed external volumes;
- extracted text and metadata live in Delta tables;
- semantic search indexes the chunks Delta table;
- both deterministic and semantic search filter by `corpus_id`.

Recommended tables:

- `search_corpora`
- `search_documents`
- `search_pages`
- `search_chunks`
- `search_index_runs`

Recommended UI addition:

- Admin tab section: `Add PDF Stack`
  - display name,
  - source path,
  - corpus id,
  - pilot/full mode,
  - validate path button,
  - index PDFs button,
  - run status/progress.

Recommended backend additions:

- `POST /api/admin/corpora/validate`
- `POST /api/admin/corpora/onboard`
- `GET /api/admin/corpora`
- `GET /api/admin/corpora/runs/:runId`

Recommended notebook/job additions:

- parameterize the indexing job with:
  - `SOURCE_PATH`,
  - `CORPUS_ID`,
  - `DISPLAY_NAME`,
  - `MODE`,
  - `FORCE_REINDEX`.
- recursively scan PDFs under the source path;
- create stable document ids from `corpus_id + relative_path`;
- extract page text;
- chunk text for semantic search;
- write/merge document, page, chunk, and run records;
- sync or create the Databricks AI Search index.

Recommended frontend additions:

- corpus selector in Search;
- search one corpus or all corpora;
- display corpus name in results;
- show corpus/index readiness state;
- disable or warn when a corpus is still indexing.

## Databricks Genie Usage

Use Databricks Genie or Databricks Assistant to inspect the live workspace, not to own the app implementation.

Ask Genie to confirm:

- which catalog/schema should own production search tables;
- whether the app has a resource named `sql-warehouse`;
- whether `X-Forwarded-Access-Token` is available in app requests;
- current chunks table schema;
- current AI Search index type and indexed columns;
- whether Change Data Feed is enabled where needed;
- exact permissions needed for volumes, SQL warehouse, AI Search, and Jobs API;
- whether an external volume is needed for non-Databricks PDF locations.

Then implement app/notebook changes in this repo.

## Validation Commands

Run from `pa-appeals-and-policy-search - Databricks Product/`:

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Known validation from the migration PR:

- `npm ci` passed.
- `npm test` passed.
- `npm run typecheck` passed.
- `npm run build` passed outside the local sandbox.
- `npm ci` reported 5 dependency audit findings: 2 moderate and 3 high. Review deliberately; do not run forced upgrades blindly.

## Recommended Next Branch

Use a neutral branch name:

```text
feature/corpus-onboarding
```

Suggested commit title:

```text
Add governed PDF corpus onboarding
```

## Definition Of Done For Corpus Onboarding

- Admin can enter a governed Volume/external volume path.
- App validates that the caller can access the path.
- App submits an indexing job with source path and corpus id.
- Job creates/updates corpus, document, page, chunk, and run records.
- Semantic index includes enough metadata to open source PDFs from semantic hits.
- Search UI can filter by corpus.
- Deterministic and semantic search both work against the new corpus.
- Index status is visible and understandable to non-engineers.
- Tests cover parser/search changes and path-safety behavior.
