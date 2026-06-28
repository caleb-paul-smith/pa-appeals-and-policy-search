// Lightweight assertions for the query engine. Run with: npm run test:parser
// Uses only fabricated, generic policy-vocabulary text — no real appeal content.

import { parseQuery } from "./queryParser";
import {
  evaluate,
  matchTypeOf,
  matchCountOf,
  pickBestSpan,
} from "./evaluator";
import { normalizePlain, tokenize } from "./normalize";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${name}`);
  }
}

function evalPage(query: string, page: string) {
  const parsed = parseQuery(query);
  if (!parsed.ok || !parsed.ast) {
    return { satisfied: false, parsed };
  }
  const tokens = tokenize(normalizePlain(page));
  const res = evaluate(parsed.ast, tokens);
  return {
    satisfied: res.satisfied,
    type: matchTypeOf(res),
    count: matchCountOf(res),
    res,
    parsed,
  };
}

// Fabricated generic sentence (NOT real appeal text).
const PAGE =
  "The procurement process must remain reasonable and documented. " +
  "Force account labor was reviewed and the reasonable cost standard applied. " +
  "Direct administrative costs were claimed on first appeal but not on second appeal. " +
  "Direct administrative costs were documented again.";

console.log("Query parser / evaluator checks:");

// 1. Plain terms => implicit AND, both must occur.
check("plain terms both present", evalPage("procurement reasonable", PAGE).satisfied === true);
check(
  "plain terms missing one => no match",
  evalPage("procurement nonexistentword", PAGE).satisfied === false
);

// 2. Exact phrase.
const phrase = evalPage('"direct administrative costs"', PAGE);
check("exact phrase matches", phrase.satisfied === true);
check("exact phrase type", phrase.type === "phrase");
const phraseMiss = evalPage('"administrative direct costs"', PAGE);
check("wrong-order phrase does not match", phraseMiss.satisfied === false);

// 3. Booleans.
check(
  "OR / AND / NOT combination",
  evalPage('("first appeal" OR "second appeal") AND procurement NOT draft', PAGE).satisfied === true
);
check(
  "NOT excludes",
  evalPage("procurement NOT reasonable", PAGE).satisfied === false
);
check(
  "OR picks matching branch",
  evalPage('"first appeal" OR "no such phrase"', PAGE).satisfied === true
);

// 4. Proximity.
const near = evalPage('"force account" NEAR(12) reasonable', PAGE);
check("NEAR within distance matches", near.satisfied === true);
check("NEAR type is proximity", near.type === "proximity");
check(
  "NEAR too tight does not match",
  evalPage('"direct administrative costs" NEAR(1) procurement', PAGE).satisfied === false
);

// 5. Ordered proximity.
check(
  "ONEAR ordered match (force before reasonable)",
  evalPage('"force account" ONEAR(12) reasonable', PAGE).satisfied === true
);
// In the page, "reasonable cost" appears in that order, so ordered cost->reasonable
// can never be satisfied while the unordered form can.
check(
  "ONEAR wrong order fails",
  evalPage("cost ONEAR(3) reasonable", PAGE).satisfied === false
);
check(
  "NEAR unordered same pair matches",
  evalPage("cost NEAR(3) reasonable", PAGE).satisfied === true
);

// 6. Invalid syntax => readable error + example.
const bad1 = parseQuery('procurement AND');
check("dangling AND errors", bad1.ok === false && !!bad1.error && !!bad1.example);
const bad2 = parseQuery('"unterminated');
check("unterminated phrase errors", bad2.ok === false);
const bad3 = parseQuery("(procurement OR reasonable");
check("unbalanced paren errors", bad3.ok === false);
const bad4 = parseQuery("NEAR(5)");
check("bare NEAR errors", bad4.ok === false);
const bad5 = parseQuery("   ");
check("empty query errors", bad5.ok === false);

// 7. Positive literals exclude negated terms.
const lits = parseQuery("procurement NOT draft");
check(
  "positive literals exclude NOT operand",
  !!lits.positiveLiterals &&
    lits.positiveLiterals.includes("procurement") &&
    !lits.positiveLiterals.includes("draft")
);

// 8. Best span + counting sanity.
const phraseRes = evalPage('"reasonable cost"', PAGE);
check("phrase match count >= 1", (phraseRes.count ?? 0) >= 1);
check(
  "best span resolves",
  phraseRes.res ? pickBestSpan(phraseRes.res.spans) !== undefined : false
);

// 9. Wildcard / truncation.
const wildcard = evalPage("administrat*", PAGE);
check("wildcard prefix matches administrative", wildcard.satisfied === true);
check("wildcard type is term", wildcard.type === "term");
check(
  "wildcard positive literal uses prefix",
  parseQuery("administrat*").positiveLiterals?.includes("administrat") === true
);
check("wildcard miss fails", evalPage("unmatchable*", PAGE).satisfied === false);

// 10. ATLEAST frequency operator.
const atleast = evalPage("ATLEAST2(reasonable)", PAGE);
check("ATLEAST succeeds when term count meets threshold", atleast.satisfied === true);
check("ATLEAST preserves count", atleast.count === 2);
check("ATLEAST fails below threshold", evalPage("ATLEAST3(procurement)", PAGE).satisfied === false);
check(
  "ATLEAST supports phrases",
  evalPage('ATLEAST2("direct administrative costs")', PAGE).satisfied === true
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
