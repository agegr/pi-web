import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

test("file explorer has an explicit unavailable state for deleted cwds", () => {
  assert.match(source, /cwdAvailable\?: boolean/);
  assert.match(source, /cwdAvailable === false/);
  assert.match(source, /files\.unavailable/);
  assert.match(source, /data-file-explorer-unavailable/);
});

test("file explorer does not fetch or open uploads for an unavailable cwd", () => {
  assert.match(source, /if \(cwdAvailable === false\)/);
  assert.match(source, /if \(!uploadBusy && !unavailable\)/);
});
