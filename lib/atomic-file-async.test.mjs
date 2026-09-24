import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { writePrivateFileAtomic } = await import("./atomic-file-async.ts");

function createTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-atomic-async-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("creates and replaces private files without leaving temporary files", async (t) => {
  const root = createTempRoot(t);
  const destination = path.join(root, "models.json");

  await writePrivateFileAtomic(destination, "first");
  await writePrivateFileAtomic(destination, "second");

  assert.equal(fs.readFileSync(destination, "utf8"), "second");
  assert.deepEqual(fs.readdirSync(root), ["models.json"]);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
  }
});

test("retries a short-lived Windows rename failure", { skip: process.platform !== "win32" }, async (t) => {
  const root = createTempRoot(t);
  const destination = path.join(root, "models.json");
  fs.writeFileSync(destination, "old");
  const realRename = fs.promises.rename.bind(fs.promises);
  let attempts = 0;
  t.mock.method(fs.promises, "rename", async (...args) => {
    attempts++;
    if (attempts < 3) throw Object.assign(new Error("temporarily locked"), { code: "EPERM" });
    return realRename(...args);
  });

  await writePrivateFileAtomic(destination, "new");

  assert.equal(attempts, 3);
  assert.equal(fs.readFileSync(destination, "utf8"), "new");
  assert.deepEqual(fs.readdirSync(root), ["models.json"]);
});

test("a persistent Windows lock preserves the old file and cleans up after ten seconds", { skip: process.platform !== "win32" }, async (t) => {
  const root = createTempRoot(t);
  const destination = path.join(root, "models.json");
  fs.writeFileSync(destination, "old");
  const reported = [];
  let attempts = 0;
  t.mock.method(console, "error", (line) => reported.push(JSON.parse(line)));
  t.mock.method(fs.promises, "rename", async () => {
    attempts++;
    throw Object.assign(new Error("permanently locked"), { code: "EPERM" });
  });

  await assert.rejects(writePrivateFileAtomic(destination, "new"), { code: "EPERM" });

  assert.ok(attempts > 2);
  assert.equal(fs.readFileSync(destination, "utf8"), "old");
  assert.deepEqual(fs.readdirSync(root), ["models.json"]);
  assert.equal(reported[0].operation, "rename");
  assert.equal(reported[0].code, "EPERM");
  assert.equal(reported[0].renameAttempts, attempts);
});

test("a non-retryable failure returns immediately without replacing the file", async (t) => {
  const root = createTempRoot(t);
  const destination = path.join(root, "models.json");
  fs.writeFileSync(destination, "old");
  const reported = [];
  let attempts = 0;
  t.mock.method(console, "error", (line) => reported.push(JSON.parse(line)));
  t.mock.method(fs.promises, "rename", async () => {
    attempts++;
    throw Object.assign(new Error("invalid operation"), { code: "EINVAL" });
  });

  await assert.rejects(writePrivateFileAtomic(destination, "new"), { code: "EINVAL" });

  assert.equal(attempts, 1);
  assert.equal(fs.readFileSync(destination, "utf8"), "old");
  assert.deepEqual(fs.readdirSync(root), ["models.json"]);
  assert.equal(reported[0].renameAttempts, 1);
});
