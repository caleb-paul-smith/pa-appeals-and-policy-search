// Unit tests for the chunks-table keyword source helpers. Run: npm run test:chunks

import {
  assertIdentifier,
  buildCandidateSql,
  buildChunkLikeFilter,
  escapeLike,
  resolveChunkVolumePath,
} from "./chunksSqlSource";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ FAIL: ${name}`);
  }
}

// --- assertIdentifier ------------------------------------------------------
check("accepts 3-part identifier", assertIdentifier("cat.schema.tbl", "x") === "cat.schema.tbl");
check(
  "rejects identifier with injection",
  (() => {
    try {
      assertIdentifier("cat.schema.tbl; DROP TABLE x", "x");
      return false;
    } catch {
      return true;
    }
  })()
);
check(
  "rejects identifier with space",
  (() => {
    try {
      assertIdentifier("cat schema", "x");
      return false;
    } catch {
      return true;
    }
  })()
);

// --- escapeLike ------------------------------------------------------------
check("escapes percent", escapeLike("50%") === "50\\%");
check("escapes underscore", escapeLike("a_b") === "a\\_b");
check("escapes backslash", escapeLike("a\\b") === "a\\\\b");

// --- buildChunkLikeFilter --------------------------------------------------
const empty = buildChunkLikeFilter([]);
check("empty literals -> empty clause", empty.clause === "" && Object.keys(empty.params).length === 0);

const one = buildChunkLikeFilter(["Procurement"]);
check("single literal -> one bound param", one.params.lit0 === "%procurement%");
check("single literal -> lowercased, no OR", one.clause.includes(":lit0") && !one.clause.includes(" OR "));
check("single literal -> whitespace-normalized column", one.clause.includes("REGEXP_REPLACE(chunk_text"));

const many = buildChunkLikeFilter(["force account", "reasonable_cost"]);
check("two literals -> OR-joined", many.clause.includes(" OR "));
check("phrase literal preserved with space", many.params.lit0 === "%force account%");
check("special char in literal escaped", many.params.lit1 === "%reasonable\\_cost%");

// --- buildCandidateSql -----------------------------------------------------
const sqlNoFilter = buildCandidateSql("cat.schema.chunks", "", 500);
check("no-filter SQL omits WHERE", !/\bWHERE\b/.test(sqlNoFilter));
check("no-filter SQL groups by page", sqlNoFilter.includes("GROUP BY filename, page_number"));
check("no-filter SQL applies LIMIT", sqlNoFilter.includes("LIMIT 500"));

const sqlFiltered = buildCandidateSql("cat.schema.chunks", one.clause, 100);
check("filtered SQL includes WHERE", sqlFiltered.includes("WHERE ("));
check("filtered SQL aggregates chunk_text", sqlFiltered.includes("CONCAT_WS"));
check("filtered SQL references table", sqlFiltered.includes("FROM cat.schema.chunks"));

// --- resolveChunkVolumePath ------------------------------------------------
// A non-existent volume root falls back to the flat root/basename guess.
check(
  "flat fallback when volume not present",
  resolveChunkVolumePath("/Volumes/does/not/exist", "FEMA-1561-DR-FL Town.pdf") ===
    "/Volumes/does/not/exist/FEMA-1561-DR-FL Town.pdf"
);
check("empty volume root -> empty path", resolveChunkVolumePath("", "x.pdf") === "");
check("empty filename -> empty path", resolveChunkVolumePath("/Volumes/x", "") === "");
check(
  "trailing slash on root handled",
  resolveChunkVolumePath("/Volumes/x/", "a.pdf") === "/Volumes/x/a.pdf"
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
