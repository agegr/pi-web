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

test("hidden dot-prefixed directories are excluded by default and included with showHidden", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-web-browse-hidden-"));
  try {
    await mkdir(path.join(root, "alpha"));
    await mkdir(path.join(root, ".git"));
    await mkdir(path.join(root, ".config"));
    await mkdir(path.join(root, "zeta"));
    // A dot-prefixed symlink pointing at a directory must be filtered too.
    await symlink(path.join(root, "alpha"), path.join(root, ".linked"));
    // A dot-prefixed symlink pointing at a FILE is excluded either way.
    await writeFile(path.join(root, "file.txt"), "x", "utf8");
    await symlink(path.join(root, "file.txt"), path.join(root, ".file-link"));

    const { listDirectories } = await loadSubject();

    // Default: hidden directories (plain and symlink) are filtered out and
    // sorting is unchanged.
    assert.deepEqual(
      (await listDirectories(root)).map((entry) => entry.name),
      ["alpha", "zeta"],
    );
    // Opt-in: everything dot-prefixed appears, still sorted; the file
    // symlink stays excluded (it never was a directory).
    assert.deepEqual(
      (await listDirectories(root, { showHidden: true })).map((entry) => entry.name),
      [".config", ".git", ".linked", "alpha", "zeta"],
    );
    // showHidden: false is the explicit default.
    assert.deepEqual(
      (await listDirectories(root, { showHidden: false })).map((entry) => entry.name),
      ["alpha", "zeta"],
    );
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
