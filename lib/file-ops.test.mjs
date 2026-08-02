import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./file-ops.ts");
  } catch {
    return import("./file-ops.ts");
  }
}

test("validateSingleFileName accepts ordinary names", async () => {
  const { validateSingleFileName } = await loadSubject();
  for (const name of ["foo.txt", "folder", ".hidden", "no_ext", "a b", "中文.md"]) {
    assert.equal(validateSingleFileName(name), null, `expected ${name} to be valid`);
  }
});

test("validateSingleFileName rejects traversal and path separators", async () => {
  const { validateSingleFileName } = await loadSubject();
  for (const name of ["", ".", "..", "a/b", "a\\b", "a\0b", "trailing/", "a/b/c"]) {
    assert.ok(validateSingleFileName(name), `expected ${JSON.stringify(name)} to be rejected`);
  }
});

test("isAncestorOrSelf detects self, descendants, and rejects prefixes", async () => {
  const { isAncestorOrSelf } = await loadSubject();
  assert.equal(isAncestorOrSelf("/a/b", "/a/b"), true);
  assert.equal(isAncestorOrSelf("/a", "/a/b"), true);
  assert.equal(isAncestorOrSelf("/a", "/a/b/c"), true);
  assert.equal(isAncestorOrSelf("/a/", "/a/b"), true);
  // A sibling that shares a name prefix is NOT a descendant.
  assert.equal(isAncestorOrSelf("/a/b", "/a/bc"), false);
  assert.equal(isAncestorOrSelf("/a/b", "/a/c"), false);
  assert.equal(isAncestorOrSelf("/a", "/x"), false);
  assert.equal(isAncestorOrSelf("/a/b/c", "/a/b"), false);
});

test("isAncestorOrSelf handles windows separators", async () => {
  const { isAncestorOrSelf } = await loadSubject();
  assert.equal(isAncestorOrSelf("C:\\a", "C:\\a\\b"), true);
  assert.equal(isAncestorOrSelf("C:\\a\\b", "C:\\a\\b"), true);
  assert.equal(isAncestorOrSelf("C:\\a", "D:\\a\\b"), false);
});

test("authorizeExistingPath returns the real path for an allowed entry", async (t) => {
  const { authorizeExistingPath } = await loadSubject();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-ops-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const file = path.join(base, "file.txt");
  fs.writeFileSync(file, "hi");
  const roots = new Set([base]);

  const real = await authorizeExistingPath(file, roots);
  assert.equal(real, fs.realpathSync(file));
});

test("authorizeExistingPath rejects a symlink that escapes the allowed root", async (t) => {
  const { authorizeExistingPath, FileOpError } = await loadSubject();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-ops-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
  const link = path.join(allowed, "link");
  fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  const roots = new Set([allowed]);

  // The link target resolves outside the allowed root, so writes/deletes via
  // the link must be refused even though the link itself lives inside it.
  await assert.rejects(
    authorizeExistingPath(path.join(link, "secret.txt"), roots),
    (error) => error instanceof FileOpError && error.status === 403,
  );
});

test("authorizeExistingPath throws 404 for a missing path", async (t) => {
  const { authorizeExistingPath, FileOpError } = await loadSubject();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-ops-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const roots = new Set([base]);

  await assert.rejects(
    authorizeExistingPath(path.join(base, "missing.txt"), roots),
    (error) => error instanceof FileOpError && error.status === 404,
  );
});

test("authorizeExistingPath allows a symlink that points back inside the root", async (t) => {
  const { authorizeExistingPath } = await loadSubject();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-ops-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const target = path.join(base, "real.txt");
  fs.writeFileSync(target, "hi");
  const link = path.join(base, "link.txt");
  fs.symlinkSync(target, link);
  const roots = new Set([base]);

  const real = await authorizeExistingPath(link, roots);
  assert.equal(real, fs.realpathSync(link));
  assert.equal(real, fs.realpathSync(target));
});
