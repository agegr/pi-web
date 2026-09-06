import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./worktree.ts");
}

async function git(cwd, args) {
  await execFileAsync("git", ["-C", cwd, ...args]);
}

test("project resolution cache stays bounded across many missing cwds", async () => {
  const { resolveProject } = await loadSubject();
  globalThis.__piProjectCache?.clear();
  for (let index = 0; index < 270; index += 1) {
    await resolveProject(path.join(os.tmpdir(), `pi-web-missing-project-${process.pid}-${index}`));
  }
  assert.equal(globalThis.__piProjectCache?.size, 256);
});

test("worktree mutation invalidates caches and preserves dirty-force semantics", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-mutation-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const repo = path.join(tempRoot, "repo");
  await execFileAsync("git", ["init", repo]);
  await git(repo, ["config", "user.name", "Pi Web Test"]);
  await git(repo, ["config", "user.email", "pi-web-test@example.invalid"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(repo, "README.md"), "# test\n");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "initial"]);

  const { addWorktree, listWorktrees, removeWorktree } = await loadSubject();
  globalThis.__piProjectCache?.clear();
  globalThis.__piWorktreeListCache?.clear();
  const created = await addWorktree(repo, "feature/cache-test");
  assert.equal((await listWorktrees(repo, { force: true })).length, 2);
  await writeFile(path.join(created.path, "dirty.txt"), "dirty\n");
  await assert.rejects(removeWorktree(repo, created.path), /modified or untracked files|is dirty/i);
  await removeWorktree(repo, created.path, true);
  assert.equal((await listWorktrees(repo, { force: true })).length, 1);
});

test("main and linked worktrees share one canonical project root", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const repo = path.join(tempRoot, "repo");
  const linked = path.join(tempRoot, "linked");
  await execFileAsync("git", ["init", repo]);
  await git(repo, ["config", "user.name", "Pi Web Test"]);
  await git(repo, ["config", "user.email", "pi-web-test@example.invalid"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(repo, "README.md"), "# test\n");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "initial"]);
  await git(repo, ["worktree", "add", "-b", "feature/test", linked]);

  const { findCurrentWorktreePath, listWorktrees, resolveProject } = await loadSubject();
  globalThis.__piProjectCache?.clear();
  const concurrentProjects = [
    resolveProject(`${repo}${path.sep}`),
    resolveProject(`${repo}${path.sep}`),
    resolveProject(`${repo}${path.sep}`),
  ];
  assert.equal(globalThis.__piProjectPromises?.size, 1);
  const [mainProject] = await Promise.all(concurrentProjects);
  const linkedProject = await resolveProject(linked);

  assert.equal(mainProject.isTopLevel, true);
  assert.equal(mainProject.isWorktree, false);
  assert.equal(linkedProject.isTopLevel, true);
  assert.equal(linkedProject.isWorktree, true);
  assert.equal(linkedProject.branch, "feature/test");
  assert.equal(mainProject.projectRoot, linkedProject.projectRoot);
  assert.equal(mainProject.repositoryRoot, repo);
  assert.equal(linkedProject.repositoryRoot, linked);
  assert.equal(mainProject.gitCommonRoot, linkedProject.gitCommonRoot);

  const worktreeCommandsBefore = globalThis.__piGitProcessState?.started ?? 0;
  const concurrentWorktrees = [
    listWorktrees(linked),
    listWorktrees(linked),
    listWorktrees(linked),
  ];
  await Promise.resolve();
  assert.equal(globalThis.__piWorktreeListPromises?.size, 1);
  const [worktrees] = await Promise.all(concurrentWorktrees);
  assert.equal(globalThis.__piProjectPromises?.size, 0);
  assert.equal(globalThis.__piWorktreeListPromises?.size, 0);
  assert.equal(globalThis.__piGitProcessState?.active, 0);
  assert.equal((globalThis.__piGitProcessState?.started ?? 0) - worktreeCommandsBefore, 1);
  assert.ok((globalThis.__piWorktreeListCache?.size ?? 0) >= 1);

  const cachedCommands = globalThis.__piGitProcessState?.started ?? 0;
  assert.deepEqual(await listWorktrees(repo), worktrees);
  assert.equal(globalThis.__piGitProcessState?.started, cachedCommands);
  await listWorktrees(repo, { force: true });
  assert.equal((globalThis.__piGitProcessState?.started ?? 0) - cachedCommands, 1);
  const listedLinked = worktrees.find((worktree) => worktree.branch === "feature/test");
  assert.ok(listedLinked);
  assert.equal(findCurrentWorktreePath(worktrees, `${linked}${path.sep}`), listedLinked.path);
});
