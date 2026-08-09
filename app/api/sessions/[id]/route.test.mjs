import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("session context uses the live RPC manager while a running session has no flushed file", () => {
  assert.match(source, /const runningSession = getRpcSession\(id\)/);
  assert.match(source, /if \(runningSession\?\.isAlive\(\)\)/);
  assert.match(source, /runningSession\.inner\.sessionManager/);
  assert.match(source, /does not flush a/);
});
