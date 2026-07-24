import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function subject() { return import("./path-security.ts"); }

test("canonical allow-list checks reject symlink escapes", async (t) => {
  const { resolveAllowedDirectory } = await subject();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-path-security-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }));
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(allowed, "escape"), "dir");

  assert.equal(resolveAllowedDirectory(allowed, new Set([allowed])), fs.realpathSync(allowed));
  assert.equal(resolveAllowedDirectory(path.join(allowed, "escape"), new Set([allowed])), null);
});

test("an explicitly allowed symlink root is canonicalized consistently", async (t) => {
  const { resolveAllowedDirectory } = await subject();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-path-security-root-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }));
  const target = path.join(base, "target");
  const alias = path.join(base, "alias");
  fs.mkdirSync(target);
  fs.symlinkSync(target, alias, "dir");
  assert.equal(resolveAllowedDirectory(alias, new Set([alias])), fs.realpathSync(target));
});
