import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { authorizeProjectDevCwd } = await jiti.import("./project-dev-access.ts");
function workspace(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "pi-project-dev-access-")));
  const cwd = join(parent, "allowed");
  const outside = join(parent, "outside");
  mkdirSync(cwd);
  mkdirSync(outside);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { cwd, outside, roots: new Set([cwd]) };
}

test("development services accept a missing Procfile but reject an outside project or parent traversal", async (t) => {
  const { cwd, outside, roots } = workspace(t);
  assert.equal(await authorizeProjectDevCwd(cwd, roots), cwd);
  await assert.rejects(authorizeProjectDevCwd(outside, roots), /Access denied/);
  await assert.rejects(authorizeProjectDevCwd(`${cwd}/../allowed`, roots), /Access denied/);
});

test("an external Procfile symlink cannot be read or started, while Stop remains available", { skip: process.platform === "win32" }, async (t) => {
  const { cwd, outside, roots } = workspace(t);
  const target = join(outside, "commands");
  writeFileSync(target, "web: echo external");
  symlinkSync(target, join(cwd, "Procfile.dev"));
  await assert.rejects(authorizeProjectDevCwd(cwd, roots), /Access denied: Procfile.dev/);
  assert.equal(await authorizeProjectDevCwd(cwd, roots, false), cwd);
});

test("a project alias resolves to its real directory and an internal Procfile link is allowed", { skip: process.platform === "win32" }, async (t) => {
  const { cwd, roots } = workspace(t);
  writeFileSync(join(cwd, "commands"), "web: echo internal");
  symlinkSync(join(cwd, "commands"), join(cwd, "Procfile.dev"));
  symlinkSync(cwd, join(cwd, "alias"));
  assert.equal(await authorizeProjectDevCwd(join(cwd, "alias"), roots), cwd);
});
