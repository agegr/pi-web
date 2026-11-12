import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./[id]/export/route.ts", import.meta.url), "utf8");

test("session export uses a private per-request temp directory", () => {
  assert.match(source, /mkdtempSync\(join\(tmpdir\(\), "pi-web-export-"\)\)/);
  assert.doesNotMatch(source, /join\(tmpdir\(\), "pi-web-export"\)/);
  assert.match(source, /rmSync\(tempDir, \{ recursive: true, force: true \}\)/);
});
