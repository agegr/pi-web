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

test("listLocalBranches returns local branches alphabetically and throws outside a repo", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-branches-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const repo = path.join(tempRoot, "repo");
  // Pin the initial branch so the expected list does not depend on the
  // machine's init.defaultBranch setting.
  await execFileAsync("git", ["init", "-b", "main", repo]);
  await git(repo, ["config", "user.name", "Pi Web Test"]);
  await git(repo, ["config", "user.email", "pi-web-test@example.invalid"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(repo, "README.md"), "# test\n");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "initial"]);

  const { listLocalBranches } = await loadSubject();

  // Fresh repo: only the branch git created on init.
  assert.deepEqual(await listLocalBranches(repo), ["main"]);

  await git(repo, ["branch", "feature/zzz"]);
  await git(repo, ["branch", "aaa"]);
  assert.deepEqual(await listLocalBranches(repo), ["aaa", "feature/zzz", "main"]);

  // Worktree checkouts of an existing branch must not duplicate it.
  await git(repo, ["worktree", "add", "-b", "feature/test", path.join(tempRoot, "linked")]);
  assert.deepEqual(await listLocalBranches(repo), ["aaa", "feature/test", "feature/zzz", "main"]);

  const scratch = await mkdtemp(path.join(tempRoot, "scratch-"));
  await assert.rejects(listLocalBranches(scratch));
});

test("listLocalBranches returns no branches for a repo with no commits", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-unborn-head-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const repo = path.join(tempRoot, "repo");
  await execFileAsync("git", ["init", "-b", "main", repo]);

  const { listLocalBranches } = await loadSubject();

  // Unborn HEAD: `for-each-ref` exits 0 with empty output, unlike `show-ref`
  // (exit 1), so an implementation swap must not start throwing here.
  assert.deepEqual(await listLocalBranches(repo), []);
});

/** Repo with one commit on main, plus the helper to make side branches. */
async function makeRepo(tempRoot, name = "repo") {
  const repo = path.join(tempRoot, name);
  await execFileAsync("git", ["init", "-b", "main", repo]);
  await git(repo, ["config", "user.name", "Pi Web Test"]);
  await git(repo, ["config", "user.email", "pi-web-test@example.invalid"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(repo, "README.md"), "# test\n");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "initial"]);
  return repo;
}

/** Branch whose tip is a commit main cannot reach. */
async function commitOnBranch(repo, branch) {
  await git(repo, ["checkout", "-b", branch]);
  await writeFile(path.join(repo, "side.txt"), `${branch}\n`);
  await git(repo, ["add", "side.txt"]);
  await git(repo, ["commit", "-m", `work on ${branch}`]);
  await git(repo, ["checkout", "main"]);
}

test("deleteBranch removes a merged branch and reports missing ones", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-delete-branch-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const repo = await makeRepo(tempRoot);
  const { deleteBranch, listLocalBranches } = await loadSubject();

  // Merged (branches off HEAD, no new commits): plain -d is enough.
  await git(repo, ["branch", "merged/one"]);
  await deleteBranch(repo, "merged/one");
  assert.deepEqual(await listLocalBranches(repo), ["main"]);

  await assert.rejects(deleteBranch(repo, "missing"), /Branch not found: missing/);
  await assert.rejects(deleteBranch(repo, "   "), /Branch name is required/);

  const scratch = await mkdtemp(path.join(tempRoot, "scratch-"));
  await assert.rejects(deleteBranch(scratch, "main"));
});

test("deleteBranch needs force for unmerged commits", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-delete-unmerged-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const repo = await makeRepo(tempRoot);
  const { deleteBranch, listLocalBranches } = await loadSubject();

  await commitOnBranch(repo, "unmerged/one");
  await assert.rejects(deleteBranch(repo, "unmerged/one"), /not fully merged/i);
  // The failed attempt must not have deleted anything.
  assert.ok((await listLocalBranches(repo)).includes("unmerged/one"));

  await deleteBranch(repo, "unmerged/one", true);
  assert.deepEqual(await listLocalBranches(repo), ["main"]);
});

test("deleteBranch refuses a branch checked out in a worktree", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-delete-checked-out-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const repo = await makeRepo(tempRoot);
  const linked = path.join(tempRoot, "linked");
  await git(repo, ["worktree", "add", "-b", "feature/held", linked]);
  const { deleteBranch, listLocalBranches } = await loadSubject();

  await assert.rejects(deleteBranch(repo, "feature/held", true), /checked out/i);
  await assert.rejects(deleteBranch(repo, "feature/held", true), /remove that worktree first/);
  // Refused even from inside the holding worktree, and the branch survives.
  await assert.rejects(deleteBranch(linked, "feature/held", true), /checked out/i);
  assert.ok((await listLocalBranches(repo)).includes("feature/held"));
});
