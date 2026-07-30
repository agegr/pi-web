import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  return import("./directory-browser.ts");
}

test("lists directories and directory symlinks without returning files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-web-browse-"));
  try {
    await mkdir(path.join(root, "project"));
    await writeFile(path.join(root, "notes.txt"), "test", "utf8");
    await symlink(path.join(root, "project"), path.join(root, "linked-project"));

    const { listDirectories } = await loadSubject();
    const directories = await listDirectories(root);

    assert.deepEqual(directories.map((entry) => entry.name), ["linked-project", "project"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expands home-relative paths and rejects missing directories", async () => {
  const { getBrowseStartDirectory, normalizeDirectory, resolveDirectory } = await loadSubject();
  assert.equal(getBrowseStartDirectory(), homedir());
  assert.equal(getBrowseStartDirectory("/project"), "/project");
  assert.equal(normalizeDirectory("~/project"), path.join(homedir(), "project"));
  await assert.rejects(resolveDirectory(path.join(tmpdir(), `pi-web-missing-${Date.now()}`)));
});

test("finds parent directories across POSIX and Windows paths", async () => {
  const { getParentDirectory } = await loadSubject();

  assert.equal(getParentDirectory("/Users/alex/project"), "/Users/alex");
  assert.equal(getParentDirectory("/"), null);
  assert.equal(getParentDirectory("C:\\Users\\Alex\\project"), "C:\\Users\\Alex");
  assert.equal(getParentDirectory("C:\\"), null);
});

test("lists available drives / filesystem roots", async () => {
  const { listDrives } = await loadSubject();
  const drives = await listDrives();

  assert.ok(drives.length > 0, "should expose at least one filesystem root");
  for (const drive of drives) {
    assert.equal(typeof drive.name, "string");
    assert.ok(drive.name.length > 0);
    assert.equal(typeof drive.path, "string");
    assert.ok(drive.path.length > 0);
  }
  // POSIX always exposes the root; Windows exposes drive letters like "C:".
  if (process.platform !== "win32") {
    assert.ok(drives.some((d) => d.path === "/"), "POSIX should expose the root /");
  } else {
    assert.ok(drives.every((d) => /^[A-Z]:$/.test(d.name)), "Windows drive names should look like C:");
  }
});

