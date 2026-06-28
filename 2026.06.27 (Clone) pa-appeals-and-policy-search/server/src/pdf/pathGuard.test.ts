// Path-traversal / allowlist checks for PDF serving. Run: npm run test:security

import { validateVolumePath } from "./pathGuard";

const ROOT = "/Volumes/main/appeals/schema/appeals_volume";
let passed = 0;
let failed = 0;

function check(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ FAIL: ${name}`);
  }
}

// Allowed: a normal pdf under the root (absolute and relative forms).
check("absolute pdf under root allowed", validateVolumePath(ROOT, `${ROOT}/2024/file.pdf`).ok);
check("relative pdf under root allowed", validateVolumePath(ROOT, "2024/file.pdf").ok);

// Rejected: traversal attempts.
check(
  "dot-dot traversal rejected",
  validateVolumePath(ROOT, `${ROOT}/../../etc/passwd.pdf`).ok === false
);
check("relative traversal rejected", validateVolumePath(ROOT, "../../secret.pdf").ok === false);
check(
  "absolute outside-root rejected",
  validateVolumePath(ROOT, "/Volumes/other/cat/sch/vol/file.pdf").ok === false
);
check("sibling-prefix path rejected", validateVolumePath(ROOT, `${ROOT}_evil/file.pdf`).ok === false);

// Rejected: non-pdf and bad inputs.
check("non-pdf rejected", validateVolumePath(ROOT, `${ROOT}/notes.txt`).ok === false);
const nullByte = String.fromCharCode(0);
check("null byte rejected", validateVolumePath(ROOT, `${ROOT}/a${nullByte}.pdf`).ok === false);
check("empty stored path rejected", validateVolumePath(ROOT, "").ok === false);
check("non-volume root rejected", validateVolumePath("/etc", "/etc/passwd.pdf").ok === false);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
