import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const mainProject = await resolveProject(`${repo}${path.sep}`);
  const linkedProject = await resolveProject(linked);

  assert.equal(mainProject.isTopLevel, true);
  assert.equal(mainProject.isWorktree, false);
  assert.equal(linkedProject.isTopLevel, true);
  assert.equal(linkedProject.isWorktree, true);
  assert.equal(linkedProject.branch, "feature/test");
  assert.equal(mainProject.projectRoot, linkedProject.projectRoot);

  const worktrees = await listWorktrees(linked);
  const listedLinked = worktrees.find((worktree) => worktree.branch === "feature/test");
  assert.ok(listedLinked);
  assert.equal(findCurrentWorktreePath(worktrees, `${linked}${path.sep}`), listedLinked.path);
});

test("removed worktree cwd resolves back to the main repo", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const repo = path.join(tempRoot, "repo");
  await execFileAsync("git", ["init", repo]);
  await git(repo, ["config", "user.name", "Pi Web Test"]);
  await git(repo, ["config", "user.email", "pi-web-test@example.invalid"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(repo, "README.md"), "# test\n");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "initial"]);

  // pi-web's addWorktree() layout: <repoRoot>-worktrees/<branch>
  const worktreePath = path.join(`${repo}-worktrees`, "feature-test");
  await git(repo, ["worktree", "add", "-b", "feature/test", worktreePath]);

  const { invalidateProjectCache, resolveProject } = await loadSubject();
  const live = await resolveProject(worktreePath);
  assert.equal(live.projectRoot, repo);
  assert.equal(live.isWorktree, true);

  // Remove the worktree directory from disk (not via git), like a crashed or
  // externally deleted checkout. Sessions in it must still group under repo.
  await rm(worktreePath, { recursive: true, force: true });
  invalidateProjectCache();

  const removed = await resolveProject(worktreePath);
  assert.equal(removed.projectRoot, repo);
  assert.equal(removed.isWorktree, true);
  assert.equal(removed.branch, "feature-test");
  assert.equal(removed.pseudoProject, undefined);
});

test("rev-parse fallback resolves a removed worktree when the derived sibling has no .git", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  // A monorepo layout: the -worktrees container sits next to a directory that
  // is not itself a checkout top level but lives inside the outer repository.
  const outer = path.join(tempRoot, "outer");
  const inner = path.join(outer, "packages", "sub");
  await execFileAsync("git", ["init", outer]);
  await git(outer, ["config", "user.name", "Pi Web Test"]);
  await git(outer, ["config", "user.email", "pi-web-test@example.invalid"]);
  await git(outer, ["config", "commit.gpgsign", "false"]);
  await mkdir(inner, { recursive: true });
  await writeFile(path.join(inner, "README.md"), "# sub\n");
  await git(outer, ["add", "."]);
  await git(outer, ["commit", "-m", "initial"]);
  const subWorktree = path.join(`${inner}-worktrees`, "feature-x");
  await git(outer, ["worktree", "add", "-b", "feature/x", subWorktree]);

  const { invalidateProjectCache, resolveProject } = await loadSubject();
  const live = await resolveProject(subWorktree);
  assert.ok(live.isWorktree);

  await rm(subWorktree, { recursive: true, force: true });
  invalidateProjectCache();

  const removed = await resolveProject(subWorktree);
  assert.equal(removed.projectRoot, outer);
  assert.equal(removed.isWorktree, true);
  assert.equal(removed.pseudoProject, undefined);
});

test("unresolvable removed path is flagged as a pseudo-project", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const { resolveProject } = await loadSubject();
  // No -worktrees sibling layout, no discoverable parent repo.
  const dangling = path.join(tempRoot, "plain-removed-branch");
  const info = await resolveProject(dangling);
  assert.equal(info.projectRoot, dangling);
  assert.equal(info.pseudoProject, true);
  assert.equal(info.isWorktree, false);
});
