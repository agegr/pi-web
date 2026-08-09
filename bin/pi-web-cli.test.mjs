// Entry-point tests: execute bin/pi-web.js and assert the subcommand
// dispatch. The repo checkout has no .next build, so both paths terminate
// with a clean error instead of launching the server.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "pi-web.js");

test("pi-web update dispatches to the update command", () => {
  const result = spawnSync(process.execPath, [BIN, "update"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not determine how pi-web was installed/);
});

test("pi-web without a subcommand still takes the launch path", () => {
  const result = spawnSync(process.execPath, [BIN], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Build artifacts not found/);
});

test("option values named update do not trigger the update command", () => {
  const result = spawnSync(process.execPath, [BIN, "--hostname", "update"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /could not determine how pi-web was installed/);
  assert.match(result.stderr, /Build artifacts not found/);
});
