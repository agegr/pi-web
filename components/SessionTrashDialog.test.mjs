import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionTrashDialog.tsx", import.meta.url), "utf8");

test("loads only the current project's trash without browser caching", () => {
  assert.match(source, /\/api\/sessions\/trash\?projectKey=\$\{encodeURIComponent\(projectKey\)\}/);
  assert.match(source, /cache: "no-store"/);
});

test("shows the 30-day access-time deletion notice prominently", () => {
  assert.match(source, /t\("trash\.retentionNotice"\)/);
  assert.match(source, /rgba\(245,158,11,0\.45\)/);
  assert.match(source, /fontWeight: 650/);
});

test("supports restoring one session and permanently deleting a selection", () => {
  assert.match(source, /\/api\/sessions\/trash\/\$\{encodeURIComponent\(sessionId\)\}\/restore/);
  assert.match(source, /body: JSON\.stringify\(\{ ids \}\)/);
  assert.match(source, /checked=\{allSelected\}/);
  assert.match(source, /t\("trash\.confirmPermanentDelete", \{ count: selectedCount \}\)/);
});
