import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadUpload() {
  return import("./file-upload.ts");
}

test("normalizes valid drop-relative paths", async () => {
  const { normalizeDropRelativePath } = await loadUpload();
  assert.equal(normalizeDropRelativePath("a/b.txt"), "a/b.txt");
  assert.equal(normalizeDropRelativePath("单层.txt"), "单层.txt");
});

test("rejects absolute, escaping, and malformed drop paths", async () => {
  const { normalizeDropRelativePath } = await loadUpload();
  for (const bad of ["", "/etc/passwd", "C:/x", "../evil", "a/../b", "a/./b", "a\\b", "a//b"]) {
    assert.equal(normalizeDropRelativePath(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("parses drop roots and preserves per-root isDir", async () => {
  const { parseDropRoots } = await loadUpload();
  assert.deepEqual(
    parseDropRoots('[{"name":"docs","isDir":true},{"name":"a.txt","isDir":false}]'),
    [{ name: "docs", isDir: true }, { name: "a.txt", isDir: false }],
  );
  assert.equal(parseDropRoots("not json"), null);
  assert.equal(parseDropRoots('[{"name":"..","isDir":true}]'), null);
  assert.equal(parseDropRoots('[{"name":"x"}]'), null);
});

test("requires every dropped path to live under a declared root", async () => {
  const { validateDropPaths } = await loadUpload();
  const roots = [{ name: "docs", isDir: true }];
  assert.equal(validateDropPaths(["docs/a.txt", "docs/sub/b.txt"], roots), null);
  assert.match(validateDropPaths(["other/a.txt"], roots) ?? "", /not under a dropped item/);
  assert.match(validateDropPaths(["docs/../x"], roots) ?? "", /Invalid path/);
});

test("unique-names dropped roots against the directory and within the batch", async () => {
  const { resolveDropRootNames } = await loadUpload();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-drop-"));
  try {
    fs.writeFileSync(path.join(dir, "a.txt"), "x");
    const mapping = resolveDropRootNames(dir, [
      { name: "a.txt", isDir: false },
      { name: "a.txt", isDir: false },
      { name: "docs", isDir: true },
    ]);
    assert.equal(mapping.get("a.txt"), "a (1).txt");
    assert.equal(mapping.get("docs"), "docs");
    assert.equal(mapping.size, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
