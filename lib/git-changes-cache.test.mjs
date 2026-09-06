import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";

const execFileAsync = promisify(execFile);
const jiti = createJiti(import.meta.url);
const {
  getGitFileDiff,
  getGitStatus,
  invalidateGitStatus,
} = await jiti.import("./git-changes.ts");
const { gitProcessStats } = await jiti.import("./git-process.ts");
const { listWorktrees } = await jiti.import("./worktree.ts");

async function git(cwd, args) {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

function resetCaches() {
  globalThis.__piGitStatusCache = undefined;
  globalThis.__piProjectCache = undefined;
  globalThis.__piProjectPromises = undefined;
  globalThis.__piGitProcessState = undefined;
}

test("parallel status and worktree loads share one project discovery", async (t) => {
  resetCaches();
  globalThis.__piWorktreeListCache = undefined;
  globalThis.__piWorktreeListPromises = undefined;
  const directory = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-shared-root-"));
  t.after(async () => {
    resetCaches();
    globalThis.__piWorktreeListCache = undefined;
    globalThis.__piWorktreeListPromises = undefined;
    await rm(directory, { recursive: true, force: true });
  });
  await git(directory, ["init"]);
  await git(directory, ["config", "user.name", "Pi Web Test"]);
  await git(directory, ["config", "user.email", "pi-web-test@example.invalid"]);
  await git(directory, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(directory, "tracked.txt"), "base\n");
  await git(directory, ["add", "."]);
  await git(directory, ["commit", "-m", "initial"]);

  const started = gitProcessStats().started;
  await Promise.all([getGitStatus(directory), listWorktrees(directory)]);
  // project discovery + porcelain + numstat + worktree list
  assert.equal(gitProcessStats().started - started, 4);
});

test("Git status coalesces concurrent work and reuses one bounded snapshot", async (t) => {
  resetCaches();
  const directory = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-cache-"));
  t.after(async () => {
    resetCaches();
    await rm(directory, { recursive: true, force: true });
  });
  await git(directory, ["init"]);
  await git(directory, ["config", "user.name", "Pi Web Test"]);
  await git(directory, ["config", "user.email", "pi-web-test@example.invalid"]);
  await git(directory, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(directory, "tracked.txt"), "one\n");
  await git(directory, ["add", "tracked.txt"]);
  await git(directory, ["commit", "-m", "initial"]);
  await writeFile(path.join(directory, "tracked.txt"), "one\ntwo\n");
  await writeFile(path.join(directory, "new.txt"), "a\nb\n");

  const startedBefore = gitProcessStats().started;
  const [first, concurrentA, concurrentB] = await Promise.all([
    getGitStatus(directory),
    getGitStatus(directory),
    getGitStatus(directory),
  ]);
  assert.deepEqual(concurrentA, first);
  assert.deepEqual(concurrentB, first);
  assert.equal(first.isGitRepository, true);
  assert.equal(first.files.length, 2);
  assert.equal(first.additions, 3);
  assert.equal(first.deletions, 0);
  assert.equal(gitProcessStats().started - startedBefore, 3);
  assert.equal(globalThis.__piGitStatusCache.responses.size, 1);
  assert.equal(globalThis.__piGitStatusCache.repositories.size, 1);

  const cachedStarted = gitProcessStats().started;
  assert.deepEqual(await getGitStatus(directory), first);
  assert.equal(gitProcessStats().started, cachedStarted);

  const probe = await getGitFileDiff(
    directory,
    path.join(directory, "tracked.txt"),
    { includePatch: false },
  );
  assert.deepEqual(probe, { supported: true, status: "modified" });
  assert.equal(gitProcessStats().started, cachedStarted);

  const diff = await getGitFileDiff(directory, path.join(directory, "tracked.txt"));
  assert.equal(diff.supported, true);
  assert.match(diff.patch, /\+two/);
  assert.equal(gitProcessStats().started - cachedStarted, 1);

  invalidateGitStatus(directory);
  const invalidatedStarted = gitProcessStats().started;
  await getGitStatus(directory);
  assert.equal(gitProcessStats().started - invalidatedStarted, 2);
  assert.equal(gitProcessStats().active, 0);
  assert.equal(gitProcessStats().queued, 0);
});

test("cached status preserves rename, delete, add, untracked, and conflict semantics", async (t) => {
  resetCaches();
  const directory = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-semantics-"));
  t.after(async () => {
    resetCaches();
    await rm(directory, { recursive: true, force: true });
  });
  await git(directory, ["init", "-b", "main"]);
  await git(directory, ["config", "user.name", "Pi Web Test"]);
  await git(directory, ["config", "user.email", "pi-web-test@example.invalid"]);
  await git(directory, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(directory, "conflict.txt"), "base\n");
  await writeFile(path.join(directory, "rename.txt"), "rename\n");
  await writeFile(path.join(directory, "delete.txt"), "delete\n");
  await git(directory, ["add", "."]);
  await git(directory, ["commit", "-m", "base"]);
  await git(directory, ["switch", "-c", "other"]);
  await writeFile(path.join(directory, "conflict.txt"), "other\n");
  await git(directory, ["commit", "-am", "other"]);
  await git(directory, ["switch", "main"]);
  await writeFile(path.join(directory, "conflict.txt"), "main\n");
  await git(directory, ["commit", "-am", "main"]);
  await assert.rejects(git(directory, ["merge", "other"]));
  await git(directory, ["mv", "rename.txt", "renamed.txt"]);
  await rm(path.join(directory, "delete.txt"));
  await writeFile(path.join(directory, "added.txt"), "added\n");
  await git(directory, ["add", "added.txt"]);
  await writeFile(path.join(directory, "untracked.txt"), "one\ntwo\n");

  const status = await getGitStatus(directory, { force: true });
  const kinds = new Set(status.files.map((file) => file.status));
  for (const expected of ["conflict", "renamed", "deleted", "added", "untracked"]) {
    assert.equal(kinds.has(expected), true, `missing ${expected}`);
  }
  assert.ok(status.additions >= 3);
  assert.ok(status.deletions >= 1);
});

test("repository status snapshots are shared with a subdirectory projection", async (t) => {
  resetCaches();
  const directory = await mkdtemp(path.join(os.tmpdir(), "pi-web-git-subdir-"));
  t.after(async () => {
    resetCaches();
    await rm(directory, { recursive: true, force: true });
  });
  await git(directory, ["init"]);
  await git(directory, ["config", "user.name", "Pi Web Test"]);
  await git(directory, ["config", "user.email", "pi-web-test@example.invalid"]);
  await git(directory, ["config", "commit.gpgsign", "false"]);
  const subdirectory = path.join(directory, "nested");
  await mkdir(subdirectory);
  await writeFile(path.join(subdirectory, "file.txt"), "base\n");
  await git(directory, ["add", "."]);
  await git(directory, ["commit", "-m", "initial"]);
  await writeFile(path.join(subdirectory, "file.txt"), "base\nchanged\n");

  await getGitStatus(directory);
  const started = gitProcessStats().started;
  const nested = await getGitStatus(subdirectory);
  assert.equal(nested.files.length, 1);
  // One project discovery and one cwd-scoped numstat; porcelain is shared.
  assert.equal(gitProcessStats().started - started, 2);
  assert.equal(globalThis.__piGitStatusCache.repositories.size, 1);
});
