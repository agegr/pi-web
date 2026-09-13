import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
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
  const {
    getBrowseStartDirectory,
    normalizeDirectory,
    resolveDirectory,
    shouldShowWindowsDrivePicker,
  } = await loadSubject();
  assert.equal(getBrowseStartDirectory(), homedir());
  assert.equal(getBrowseStartDirectory("/project"), "/project");
  assert.equal(shouldShowWindowsDrivePicker(undefined, "win32"), true);
  assert.equal(shouldShowWindowsDrivePicker(undefined, "darwin"), false);
  assert.equal(shouldShowWindowsDrivePicker(undefined, "linux"), false);
  assert.equal(shouldShowWindowsDrivePicker("C:\\Projects", "win32"), false);
  assert.equal(normalizeDirectory("~/project"), path.join(homedir(), "project"));
  await assert.rejects(resolveDirectory(path.join(tmpdir(), `pi-web-missing-${Date.now()}`)));
});

test("builds every Windows drive-letter candidate", async () => {
  const { getWindowsDriveCandidates } = await loadSubject();
  const drives = getWindowsDriveCandidates();

  assert.equal(drives.length, 26);
  assert.deepEqual(drives[0], { name: "A:", path: "A:\\" });
  assert.deepEqual(drives.at(-1), { name: "Z:", path: "Z:\\" });
});

test("finds parent directories across POSIX and Windows paths", async () => {
  const { getParentDirectory } = await loadSubject();

  assert.equal(getParentDirectory("/Users/alex/project"), "/Users/alex");
  assert.equal(getParentDirectory("/"), null);
  assert.equal(getParentDirectory("C:\\Users\\Alex\\project"), "C:\\Users\\Alex");
  assert.equal(getParentDirectory("C:\\"), null);
});

test("creates and renames a directory", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-web-directory-ops-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const { createDirectory, renameDirectory } = await loadSubject();
  const created = await createDirectory(root, "draft-project");
  assert.equal(created.name, "draft-project");
  assert.equal((await stat(created.path)).isDirectory(), true);

  const renamed = await renameDirectory(created.path, "renamed-project");
  assert.equal(renamed.name, "renamed-project");
  assert.equal((await stat(renamed.path)).isDirectory(), true);
  await assert.rejects(stat(created.path), { code: "ENOENT" });
});

test("deletes an empty directory", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-web-directory-delete-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const target = path.join(root, "to-delete");
  await mkdir(target);
  const { deleteDirectory } = await loadSubject();

  await deleteDirectory(target);
  await assert.rejects(stat(target), { code: "ENOENT" });
});

test("rejects directory names that could escape or collide", async () => {
  const { validateDirectoryName } = await loadSubject();

  assert.match(validateDirectoryName("../outside"), /path separator/);
  assert.match(validateDirectoryName("CON", "win32"), /reserved/);
  assert.match(validateDirectoryName("project?", "win32"), /invalid Windows/);
  assert.equal(validateDirectoryName("draft-project"), null);
});
