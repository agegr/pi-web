import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { writeFileExactModeAtomicSync, writePrivateFileAtomicSync, writeSessionFileAtomicSync } = await import("./atomic-file.ts");

function createTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-atomic-file-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("atomically replaces a file with restrictive permissions", (t) => {
  const root = createTempRoot(t);
  const destination = path.join(root, "models.json");
  fs.writeFileSync(destination, "old", { mode: 0o644 });

  writePrivateFileAtomicSync(destination, "new");

  assert.equal(fs.readFileSync(destination, "utf8"), "new");
  assert.deepEqual(fs.readdirSync(root), ["models.json"]);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
  }
});

test("keeps the destination and removes the temporary file when replacement fails", (t) => {
  const root = createTempRoot(t);
  const destination = path.join(root, "models.json");
  fs.mkdirSync(destination);

  assert.throws(() => writePrivateFileAtomicSync(destination, "new"));
  assert.equal(fs.statSync(destination).isDirectory(), true);
  assert.deepEqual(fs.readdirSync(root), ["models.json"]);
});

test("replaces a session file and keeps the mode pi gave it", (t) => {
  const root = createTempRoot(t);
  const destination = path.join(root, "session.jsonl");
  fs.writeFileSync(destination, "old\n");
  fs.chmodSync(destination, 0o640);

  writeSessionFileAtomicSync(destination, "new\n");

  assert.equal(fs.readFileSync(destination, "utf8"), "new\n");
  assert.deepEqual(fs.readdirSync(root), ["session.jsonl"]);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(destination).mode & 0o777, 0o640);
  }
});

test("an exact mode is kept whatever the umask", { skip: process.platform === "win32" }, (t) => {
  const root = createTempRoot(t);
  const destination = path.join(root, "mcp.json");
  const previous = process.umask(0o077);
  t.after(() => process.umask(previous));

  writeFileExactModeAtomicSync(destination, "{}\n", 0o644);

  assert.equal(fs.readFileSync(destination, "utf8"), "{}\n");
  assert.deepEqual(fs.readdirSync(root), ["mcp.json"]);
  assert.equal(fs.statSync(destination).mode & 0o777, 0o644);
});

test("a symlinked session file keeps its link and the bytes reach its target", { skip: process.platform === "win32" }, (t) => {
  const root = createTempRoot(t);
  const target = path.join(root, "real.jsonl");
  const link = path.join(root, "session.jsonl");
  fs.writeFileSync(target, "old\n");
  fs.symlinkSync(target, link);

  writeSessionFileAtomicSync(link, "new\n");

  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(target, "utf8"), "new\n");
});
