import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { updateFromSource } = require("../bin/source-update.js");

function fixture(t, name = "@agegr/pi-web") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-update-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name }));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("updates from a validated source directory in order", (t) => {
  const dir = fixture(t);
  const calls = [];
  const message = updateFromSource(dir, {
    run(args) {
      calls.push(args);
      return { status: 0 };
    },
  });

  assert.deepEqual(calls, [
    ["ci"],
    ["run", "build"],
    ["install", "--global", dir],
  ]);
  assert.match(message, /pi-web reload/);
});

test("rejects unrelated directories and stops after a failed command", (t) => {
  assert.throws(() => updateFromSource(fixture(t, "other-package")), /Expected @agegr\/pi-web/);

  const dir = fixture(t);
  const calls = [];
  assert.throws(() => updateFromSource(dir, {
    run(args) {
      calls.push(args);
      return { status: args[0] === "ci" ? 1 : 0 };
    },
  }), /npm ci failed with exit code 1/);
  assert.deepEqual(calls, [["ci"]]);
});
