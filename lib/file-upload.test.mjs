import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  return import("./file-upload.ts");
}

test("validates upload names without accepting paths or duplicates", async () => {
  const { validateUploadFileNames } = await loadSubject();

  assert.equal(validateUploadFileNames(["one.txt", "two file.md"]), null);
  assert.match(validateUploadFileNames(["../secret.txt"]), /must not contain a path/);
  assert.match(validateUploadFileNames(["folder\\secret.txt"]), /must not contain a path/);
  assert.match(validateUploadFileNames(["same.txt", "same.txt"]), /Duplicate/);
  assert.match(validateUploadFileNames([]), /No files/);
});

test("finds conflicts and prevents replacing directories", async (t) => {
  const { inspectUploadTargets } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-upload-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, "file.txt"), "old");
  fs.mkdirSync(path.join(root, "directory"));

  assert.deepEqual(
    inspectUploadTargets(root, ["new.txt", "file.txt", "directory"]),
    {
      conflicts: ["file.txt", "directory"],
      nonReplaceable: ["directory"],
    },
  );
});

test("prevents replacing symbolic links", async (t) => {
  const { inspectUploadTargets } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-upload-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, "file.txt"), "old");
  try {
    fs.symlinkSync("file.txt", path.join(root, "link.txt"));
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("Creating symbolic links requires additional privileges on this platform");
      return;
    }
    throw error;
  }

  assert.deepEqual(
    inspectUploadTargets(root, ["link.txt"]),
    {
      conflicts: ["link.txt"],
      nonReplaceable: ["link.txt"],
    },
  );
});

test("parses only supported conflict strategies", async () => {
  const { parseUploadConflictStrategy } = await loadSubject();

  assert.equal(parseUploadConflictStrategy(null), "error");
  assert.equal(parseUploadConflictStrategy("overwrite"), "overwrite");
  assert.equal(parseUploadConflictStrategy("skip"), "skip");
  assert.equal(parseUploadConflictStrategy("rename"), null);
});

test("validates folder upload paths: relative, no dot segments, no .git", async () => {
  const { validateUploadPaths } = await loadSubject();

  assert.equal(validateUploadPaths(["data/a.csv", "data/sub/b.csv", "top.txt", ".env"]), null);
  assert.match(validateUploadPaths(["/etc/passwd"]), /must be relative/);
  assert.match(validateUploadPaths(["C:/Windows/x"]), /must be relative|Invalid file name/);
  assert.match(validateUploadPaths(["data\\a.csv"]), /must be relative/);
  assert.match(validateUploadPaths(["data/../a.csv"]), /Invalid file name/);
  assert.match(validateUploadPaths(["data/./a.csv"]), /Invalid file name/);
  assert.match(validateUploadPaths(["data//a.csv"]), /Invalid file name/);
  assert.match(validateUploadPaths(["data/"]), /Invalid file name/);
  assert.match(validateUploadPaths(["repo/.git/config"]), /\.git/);
  assert.match(validateUploadPaths(["repo/.GIT./config"]), /\.git/);
  assert.match(validateUploadPaths(["data/a.csv", "data/a.csv"]), /Duplicate/);
  assert.match(validateUploadPaths(["data", "data/a.csv"]), /both a file and a folder/);
  assert.match(validateUploadPaths([]), /No files/);
});

test("a folder upload's conflicts are looked up without following links on the way", async (t) => {
  const { inspectUploadTargets } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-upload-nested-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-upload-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  fs.mkdirSync(path.join(root, "data", "sub"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "sub", "a.csv"), "old");
  fs.writeFileSync(path.join(root, "plain"), "a file");
  fs.writeFileSync(path.join(outside, "b.csv"), "outside");
  fs.symlinkSync(outside, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");

  assert.deepEqual(
    inspectUploadTargets(root, ["data/sub/a.csv", "data/new/c.csv", "plain/x.csv", "linked/b.csv"]),
    { conflicts: ["data/sub/a.csv"], nonReplaceable: [] },
  );
});

test("creates an upload's folders one segment at a time and refuses files and links on the way", async (t) => {
  const { prepareUploadDestination } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-upload-prepare-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-upload-prepare-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  assert.equal(prepareUploadDestination(root, "a/b/c.txt"), path.join(root, "a", "b", "c.txt"));
  assert.equal(fs.statSync(path.join(root, "a", "b")).isDirectory(), true);
  assert.equal(prepareUploadDestination(root, "top.txt"), path.join(root, "top.txt"));

  fs.writeFileSync(path.join(root, "plain"), "a file");
  assert.throws(() => prepareUploadDestination(root, "plain/x.txt"), /plain is not a folder/);

  fs.symlinkSync(outside, path.join(root, "a", "linked"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => prepareUploadDestination(root, "a/linked/deep/x.txt"), /a\/linked is not a folder/);
  assert.deepEqual(fs.readdirSync(outside), []);
});
