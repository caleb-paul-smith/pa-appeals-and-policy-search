# Databricks notebook source
# MAGIC %md
# MAGIC # 01 — Build page-level index for Appeals & Policy Research
# MAGIC
# MAGIC Controlled pilot indexer. Reads OCR'd PDFs from **one approved Unity
# MAGIC Catalog volume** and writes two governed Delta tables that the app queries
# MAGIC through a SQL warehouse.
# MAGIC
# MAGIC **This notebook reads nothing until you set the configuration values below
# MAGIC and explicitly confirm a run.** It defaults to a safe dry run and to pilot
# MAGIC mode (at most `PILOT_MAX_FILES` files). It never calls an external OCR or
# MAGIC document-processing service — it uses the PDFs' existing text layer only.
# MAGIC
# MAGIC All PDF bytes and extracted text stay inside this workspace / Unity Catalog.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Dependencies
# MAGIC Install the notebook-scoped PDF library. `pypdf` reads the existing text
# MAGIC layer; no external service is contacted.

# COMMAND ----------

# MAGIC %pip install "pypdf==4.3.1"
# MAGIC dbutils.library.restartPython()

# COMMAND ----------

# MAGIC %md
# MAGIC ## Configuration
# MAGIC Fill these in to match your approved volume and index schema. They mirror
# MAGIC `config.example.yaml`. Do **not** commit populated values.

# COMMAND ----------

# --- Required configuration (mirror config.example.yaml) ---------------------
APPEALS_VOLUME_PATH = "/Volumes/REPLACE_ME/catalog/schema/appeals_volume"
INDEX_CATALOG = "REPLACE_ME"
INDEX_SCHEMA = "REPLACE_ME"
DOCUMENTS_TABLE = "appeal_research_documents"
PAGES_TABLE = "appeal_research_pages"
PILOT_MAX_FILES = 25

# --- Run controls (widgets so they can be set as job parameters) -------------
dbutils.widgets.dropdown("DRY_RUN", "true", ["true", "false"], "Dry run (no writes)")
dbutils.widgets.dropdown("MODE", "pilot", ["pilot", "full"], "Indexing mode")
dbutils.widgets.text("CONFIRM_FULL_INDEX", "NO", "Type INDEX_ALL to allow full mode")
dbutils.widgets.dropdown("FORCE_REINDEX", "false", ["true", "false"], "Re-extract even if unchanged")

DRY_RUN = dbutils.widgets.get("DRY_RUN") == "true"
MODE = dbutils.widgets.get("MODE")
CONFIRM_FULL_INDEX = dbutils.widgets.get("CONFIRM_FULL_INDEX")
FORCE_REINDEX = dbutils.widgets.get("FORCE_REINDEX") == "true"

DOCUMENTS_FQN = f"{INDEX_CATALOG}.{INDEX_SCHEMA}.{DOCUMENTS_TABLE}"
PAGES_FQN = f"{INDEX_CATALOG}.{INDEX_SCHEMA}.{PAGES_TABLE}"

# COMMAND ----------

# MAGIC %md
# MAGIC ## Guardrails
# MAGIC Refuse to run against placeholders, refuse full-corpus indexing unless
# MAGIC explicitly confirmed, and confine all reads to the approved volume root.

# COMMAND ----------

import os
import re
import hashlib
from datetime import datetime, timezone

if "REPLACE_ME" in APPEALS_VOLUME_PATH or "REPLACE_ME" in DOCUMENTS_FQN:
    raise ValueError(
        "Configuration still contains REPLACE_ME. Set APPEALS_VOLUME_PATH, "
        "INDEX_CATALOG, and INDEX_SCHEMA to your approved values before running."
    )

if not APPEALS_VOLUME_PATH.startswith("/Volumes/"):
    raise ValueError("APPEALS_VOLUME_PATH must be a Unity Catalog volume path under /Volumes/.")

# Normalize the approved root once; every file we touch must live under it.
VOLUME_ROOT = os.path.realpath(APPEALS_VOLUME_PATH)

if MODE == "full" and CONFIRM_FULL_INDEX != "INDEX_ALL":
    raise ValueError(
        "Full indexing is disabled. Set MODE=full AND CONFIRM_FULL_INDEX=INDEX_ALL "
        "to index the entire corpus. The default is pilot mode."
    )

EFFECTIVE_MAX_FILES = None if MODE == "full" else PILOT_MAX_FILES
print(f"Mode={MODE}  dry_run={DRY_RUN}  max_files={EFFECTIVE_MAX_FILES}  force_reindex={FORCE_REINDEX}")
print(f"Volume root: {VOLUME_ROOT}")
print(f"Documents table: {DOCUMENTS_FQN}")
print(f"Pages table: {PAGES_FQN}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Create governed tables (idempotent)
# MAGIC Future appeal-metadata columns are created now but left NULL in this first
# MAGIC run — they will only be populated when reliably sourced (see README).

# COMMAND ----------

if not DRY_RUN:
    spark.sql(f"CREATE CATALOG IF NOT EXISTS {INDEX_CATALOG}")
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {INDEX_CATALOG}.{INDEX_SCHEMA}")

    spark.sql(
        f"""
        CREATE TABLE IF NOT EXISTS {DOCUMENTS_FQN} (
            document_id STRING NOT NULL,
            volume_path STRING,
            relative_path STRING,
            file_name STRING,
            file_extension STRING,
            file_size_bytes BIGINT,
            file_modified_timestamp TIMESTAMP,
            content_hash STRING,
            page_count INT,
            extract_status STRING,
            extract_error STRING,
            -- Future metadata: left NULL until reliably sourced.
            disaster_number STRING,
            appeal_level STRING,
            state STRING,
            applicant STRING,
            decision_outcome STRING,
            indexed_at TIMESTAMP
        ) USING DELTA
        """
    )

    spark.sql(
        f"""
        CREATE TABLE IF NOT EXISTS {PAGES_FQN} (
            document_id STRING NOT NULL,
            page_number INT NOT NULL,
            page_text STRING,
            normalized_text STRING,
            token_count INT,
            indexed_at TIMESTAMP
        ) USING DELTA
        """
    )
    print("Tables ensured.")
else:
    print("[dry-run] Would create catalog/schema/tables if absent.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Discover .pdf files under the approved volume

# COMMAND ----------

def discover_pdfs(root: str):
    """Yield (abs_path, relative_path) for .pdf files strictly under root."""
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if not name.lower().endswith(".pdf"):
                continue
            abs_path = os.path.realpath(os.path.join(dirpath, name))
            # Defense in depth: never follow a symlink out of the approved root.
            if abs_path != root and not abs_path.startswith(root + os.sep):
                print(f"  ! skipping path outside volume root: {abs_path}")
                continue
            rel = os.path.relpath(abs_path, root)
            yield abs_path, rel


all_pdfs = sorted(discover_pdfs(VOLUME_ROOT), key=lambda t: t[1])
discovered = len(all_pdfs)
selected = all_pdfs if EFFECTIVE_MAX_FILES is None else all_pdfs[:EFFECTIVE_MAX_FILES]
print(f"Discovered {discovered} PDF(s); selected {len(selected)} for this run.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Helpers: stable IDs, change detection, text normalization

# COMMAND ----------

def document_id_for(relative_path: str) -> str:
    """Stable id derived from the volume-relative path (not random)."""
    return "doc_" + hashlib.sha256(relative_path.encode("utf-8")).hexdigest()[:24]


def content_hash_for(size: int, mtime_ns: int) -> str:
    """Cheap change-detection key from file metadata."""
    return hashlib.sha256(f"{size}:{mtime_ns}".encode("utf-8")).hexdigest()[:32]


_ws_re = re.compile(r"\s+")


def normalize_text(text: str) -> str:
    """Collapse whitespace + lowercase — must match the app's normalization."""
    return _ws_re.sub(" ", text or "").strip().lower()


def existing_hashes():
    """Map document_id -> content_hash for change detection (empty if no table)."""
    if DRY_RUN:
        try:
            rows = spark.sql(
                f"SELECT document_id, content_hash FROM {DOCUMENTS_FQN}"
            ).collect()
        except Exception:
            return {}
    else:
        rows = spark.sql(f"SELECT document_id, content_hash FROM {DOCUMENTS_FQN}").collect()
    return {r["document_id"]: r["content_hash"] for r in rows}

# COMMAND ----------

# MAGIC %md
# MAGIC ## Extract pages (existing text layer only) and write per-document
# MAGIC Each document is processed independently. Unreadable PDFs/pages are
# MAGIC recorded rather than failing the whole job. Writes are idempotent: a
# MAGIC document's page rows are replaced atomically when its content changes.

# COMMAND ----------

from pypdf import PdfReader
from pyspark.sql import Row

prior = existing_hashes()

stats = {
    "discovered": discovered,
    "selected": len(selected),
    "indexed": 0,
    "skipped_unchanged": 0,
    "pages_indexed": 0,
    "empty_pages": 0,
    "failures": 0,
}


def extract_pages(abs_path: str):
    """Return (page_count, list_of_(page_number, text), status, error)."""
    try:
        reader = PdfReader(abs_path)
        pages = []
        empty = 0
        for i, page in enumerate(reader.pages):
            try:
                text = page.extract_text() or ""
            except Exception as pe:  # noqa: BLE001 — record, don't fail the file
                text = ""
                print(f"    page {i + 1} extract error: {pe}")
            if not text.strip():
                empty += 1
            pages.append((i + 1, text))
        status = "ok" if pages else "empty"
        return len(pages), pages, status, None, empty
    except Exception as e:  # noqa: BLE001 — record unreadable PDF
        return 0, [], "failed", str(e)[:1000], 0


def write_document(doc_row: dict, page_rows: list):
    if DRY_RUN:
        return
    doc_df = spark.createDataFrame([Row(**doc_row)])
    doc_df.createOrReplaceTempView("_incoming_doc")
    spark.sql(
        f"""
        MERGE INTO {DOCUMENTS_FQN} t
        USING _incoming_doc s ON t.document_id = s.document_id
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
        """
    )
    # Replace page rows for this document atomically (idempotent re-index).
    spark.sql(
        f"DELETE FROM {PAGES_FQN} WHERE document_id = '{doc_row['document_id']}'"
    )
    if page_rows:
        spark.createDataFrame([Row(**r) for r in page_rows]).write.mode("append").saveAsTable(
            PAGES_FQN
        )


now = datetime.now(timezone.utc)

for abs_path, rel in selected:
    doc_id = document_id_for(rel)
    st = os.stat(abs_path)
    chash = content_hash_for(st.st_size, st.st_mtime_ns)

    if not FORCE_REINDEX and prior.get(doc_id) == chash:
        stats["skipped_unchanged"] += 1
        print(f"= unchanged: {rel}")
        continue

    print(f"+ indexing: {rel}")
    page_count, pages, status, error, empty = extract_pages(abs_path)
    stats["empty_pages"] += empty
    if status == "failed":
        stats["failures"] += 1

    doc_row = {
        "document_id": doc_id,
        "volume_path": abs_path,
        "relative_path": rel,
        "file_name": os.path.basename(abs_path),
        "file_extension": ".pdf",
        "file_size_bytes": int(st.st_size),
        "file_modified_timestamp": datetime.fromtimestamp(st.st_mtime, timezone.utc),
        "content_hash": chash,
        "page_count": int(page_count),
        "extract_status": status,
        "extract_error": error,
        # Future metadata intentionally NULL in this run.
        "disaster_number": None,
        "appeal_level": None,
        "state": None,
        "applicant": None,
        "decision_outcome": None,
        "indexed_at": now,
    }

    page_rows = []
    for page_number, text in pages:
        norm = normalize_text(text)
        page_rows.append(
            {
                "document_id": doc_id,
                "page_number": int(page_number),
                "page_text": text,
                "normalized_text": norm,
                "token_count": len(norm.split()),
                "indexed_at": now,
            }
        )

    if DRY_RUN:
        print(f"    [dry-run] would write 1 doc row + {len(page_rows)} page rows")
    else:
        write_document(doc_row, page_rows)

    if status != "failed":
        stats["indexed"] += 1
        stats["pages_indexed"] += len(page_rows)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Summary

# COMMAND ----------

print("==== Index run summary ====")
print(f"  mode               : {MODE}{' (DRY RUN)' if DRY_RUN else ''}")
print(f"  PDFs discovered    : {stats['discovered']}")
print(f"  PDFs selected      : {stats['selected']}")
print(f"  PDFs indexed       : {stats['indexed']}")
print(f"  skipped (unchanged): {stats['skipped_unchanged']}")
print(f"  pages indexed      : {stats['pages_indexed']}")
print(f"  empty-text pages   : {stats['empty_pages']}")
print(f"  failures           : {stats['failures']}")
if DRY_RUN:
    print("\nThis was a DRY RUN — no tables were written. Set DRY_RUN=false to index.")
