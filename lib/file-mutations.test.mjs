import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

async function loadSubject() {
  return jiti.import("./file-mutations.ts");
}

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-mutations-"));
}

test("validateEntryName rejects traversal, separators, and control characters", async () => {
  const { validateEntryName } = await loadSubject();

  assert.equal(validateEntryName("notes.md"), null);
  assert.equal(validateEntryName("数据文件夹"), null);
  assert.notEqual(validateEntryName(".."), null);
  assert.notEqual(validateEntryName("a/b"), null);
  assert.notEqual(validateEntryName("a\\b"), null);
  assert.notEqual(validateEntryName("bad\nname"), null);
  assert.notEqual(validateEntryName("null\0byte"), null);
  assert.notEqual(validateEntryName(""), null);
  assert.notEqual(validateEntryName(42), null);
});

test("createEntry refuses to overwrite and creates both kinds", async () => {
  const { createEntry } = await loadSubject();
  const workspace = makeWorkspace();

  assert.ok(createEntry(workspace, "new-file.txt", "file").ok);
  assert.ok(fs.statSync(path.join(workspace, "new-file.txt")).isFile());
  assert.ok(createEntry(workspace, "subdir", "directory").ok);
  assert.ok(fs.statSync(path.join(workspace, "subdir")).isDirectory());

  const conflict = createEntry(workspace, "new-file.txt", "file");
  assert.equal(conflict.ok, false);
  assert.equal(conflict.ok ? 0 : conflict.status, 409);
});

test("renameEntry renames inside the directory but never escapes it", async () => {
  const { renameEntry } = await loadSubject();
  const workspace = makeWorkspace();
  const target = path.join(workspace, "old.txt");
  fs.writeFileSync(target, "hello");

  assert.ok(renameEntry(target, "new.txt", new Set([workspace])).ok);
  assert.ok(fs.existsSync(path.join(workspace, "new.txt")));
  assert.ok(!fs.existsSync(target));

  const conflict = renameEntry(path.join(workspace, "new.txt"), "new.txt", new Set([workspace]));
  assert.equal(conflict.ok, false);
  assert.equal(conflict.ok ? 0 : conflict.status, 409);
});

test("renameEntry rejects names that would leave the parent directory", async () => {
  const { renameEntry } = await loadSubject();
  const workspace = makeWorkspace();
  const target = path.join(workspace, "entry.txt");
  fs.writeFileSync(target, "hello");

  const escaped = renameEntry(target, "..", new Set([workspace]));
  assert.equal(escaped.ok, false);
  assert.ok(fs.existsSync(target));
});

test("deleteEntry removes files and recursive directories only inside allowed roots", async () => {
  const { deleteEntry } = await loadSubject();
  const workspace = makeWorkspace();
  const outside = makeWorkspace();

  const file = path.join(workspace, "file.txt");
  fs.writeFileSync(file, "x");
  assert.ok(deleteEntry(file, false, new Set([workspace])).ok);
  assert.ok(!fs.existsSync(file));

  const nested = path.join(workspace, "deep");
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, "inner.txt"), "x");
  const nonRecursive = deleteEntry(nested, false, new Set([workspace]));
  assert.equal(nonRecursive.ok, false);
  assert.ok(deleteEntry(nested, true, new Set([workspace])).ok);
  assert.ok(!fs.existsSync(nested));

  const outsideFile = path.join(outside, "secret.txt");
  fs.writeFileSync(outsideFile, "x");
  const denied = deleteEntry(outsideFile, false, new Set([workspace]));
  assert.equal(denied.ok, false);
  assert.equal(denied.ok ? 0 : denied.status, 403);
  assert.ok(fs.existsSync(outsideFile));
});

test("deleteEntry unlinks symlinks without following them", async () => {
  const { deleteEntry } = await loadSubject();
  const workspace = makeWorkspace();
  const outside = makeWorkspace();
  const outsideFile = path.join(outside, "target.txt");
  fs.writeFileSync(outsideFile, "x");
  const link = path.join(workspace, "link.txt");
  fs.symlinkSync(outsideFile, link);

  assert.ok(deleteEntry(link, false, new Set([workspace])).ok);
  assert.ok(!fs.existsSync(link));
  assert.ok(fs.existsSync(outsideFile));
});

test("writeTextFile replaces content atomically and preserves mode", async () => {
  const { writeTextFile } = await loadSubject();
  const workspace = makeWorkspace();
  const target = path.join(workspace, "script.sh");
  fs.writeFileSync(target, "echo one\n", { mode: 0o755 });

  assert.ok(writeTextFile(target, "echo two\n", new Set([workspace])).ok);
  assert.equal(fs.readFileSync(target, "utf8"), "echo two\n");
  assert.equal(fs.statSync(target).mode & 0o777, 0o755);
  assert.equal(fs.readdirSync(workspace).filter((n) => n.includes(".tmp")).length, 0);
});

test("writeTextFile refuses symlinks, directories, and binary content", async () => {
  const { writeTextFile } = await loadSubject();
  const workspace = makeWorkspace();
  const outside = makeWorkspace();
  const outsideFile = path.join(outside, "target.txt");
  fs.writeFileSync(outsideFile, "keep me");

  const link = path.join(workspace, "link.txt");
  fs.symlinkSync(outsideFile, link);
  const linkResult = writeTextFile(link, "overwrite", new Set([workspace]));
  assert.equal(linkResult.ok, false);
  assert.ok(fs.existsSync(outsideFile));
  assert.equal(fs.readFileSync(outsideFile, "utf8"), "keep me");

  const dir = path.join(workspace, "dir");
  fs.mkdirSync(dir);
  const dirResult = writeTextFile(dir, "x", new Set([workspace]));
  assert.equal(dirResult.ok, false);
  assert.equal(dirResult.ok ? 0 : dirResult.status, 400);

  const binary = path.join(workspace, "blob.bin");
  fs.writeFileSync(binary, Buffer.from([0x89, 0x50, 0x00, 0x4e]));
  const binaryResult = writeTextFile(binary, "text", new Set([workspace]));
  assert.equal(binaryResult.ok, false);
  assert.equal(binaryResult.ok ? 0 : binaryResult.status, 415);
  assert.deepEqual(fs.readFileSync(binary), Buffer.from([0x89, 0x50, 0x00, 0x4e]));
});

test("writeTextFile enforces the size cap", async () => {
  const { writeTextFile, MAX_WRITE_BYTES } = await loadSubject();
  const workspace = makeWorkspace();
  const target = path.join(workspace, "big.txt");
  fs.writeFileSync(target, "small");

  const result = writeTextFile(target, "a".repeat(MAX_WRITE_BYTES + 1), new Set([workspace]));
  assert.equal(result.ok, false);
  assert.equal(result.ok ? 0 : result.status, 413);
  assert.equal(fs.readFileSync(target, "utf8"), "small");
});
