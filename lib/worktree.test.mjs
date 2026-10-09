import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
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

test("recognizes submodule and dirty-worktree removal errors as forceable", async () => {
  const { worktreeRemovalRequiresForce } = await loadSubject();

  assert.equal(worktreeRemovalRequiresForce("fatal: working trees containing submodules cannot be moved or removed"), true);
  assert.equal(worktreeRemovalRequiresForce("fatal: '/tmp/linked' contains modified or untracked files, use --force to delete it"), true);
  assert.equal(worktreeRemovalRequiresForce("fatal: worktree is dirty"), true);
  // A locked worktree needs `remove -f -f`; a single force would still fail.
  assert.equal(worktreeRemovalRequiresForce("fatal: cannot remove a locked working tree;\nuse 'remove -f -f' to override or unlock first"), false);
  assert.equal(worktreeRemovalRequiresForce("fatal: unrelated git failure"), false);
});

test("forced worktree removal passes Git's force flag", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-force-"));
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
  await git(repo, ["worktree", "add", "-b", "feature/force", linked]);
  await writeFile(path.join(linked, "untracked.txt"), "discard me\n");

  const { removeWorktree } = await loadSubject();
  await removeWorktree(repo, linked, true);
  assert.equal(existsSync(linked), false);
});

test("worktree removal accepts a path that runs through a link", async (t) => {
  // Git lists worktrees by their real path; macOS's tmpdir is a link to /private/var.
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-link-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const repo = path.join(tempRoot, "repo");
  const alias = path.join(tempRoot, "alias");
  await execFileAsync("git", ["init", repo]);
  await git(repo, ["config", "user.name", "Pi Web Test"]);
  await git(repo, ["config", "user.email", "pi-web-test@example.invalid"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(repo, "README.md"), "# test\n");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "initial"]);
  await git(repo, ["worktree", "add", "-b", "feature/link", path.join(tempRoot, "linked")]);
  await symlink(tempRoot, alias, "dir");

  const { removeWorktree } = await loadSubject();
  await removeWorktree(repo, path.join(alias, "linked"));
  assert.equal(existsSync(path.join(tempRoot, "linked")), false);
});

test("worktrees of bare clones group under their clone, not the folder holding them (#1049)", async (t) => {
  const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-bare-")));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const source = path.join(tempRoot, "source");
  await execFileAsync("git", ["init", source]);
  await git(source, ["config", "user.name", "Pi Web Test"]);
  await git(source, ["config", "user.email", "pi-web-test@example.invalid"]);
  await git(source, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(source, "README.md"), "# test\n");
  await git(source, ["add", "README.md"]);
  await git(source, ["commit", "-m", "initial"]);

  // parent/repo1.git/worktree1 and parent/repo2.git/worktree1
  const parent = path.join(tempRoot, "parent");
  for (const name of ["repo1.git", "repo2.git"]) {
    await git(tempRoot, ["clone", "--bare", source, path.join(parent, name)]);
    await git(path.join(parent, name), ["worktree", "add", "-b", "worktree1", path.join(parent, name, "worktree1")]);
  }
  // The `.bare` layout: project/.git is a file pointing at project/.bare.
  const project = path.join(tempRoot, "project");
  await git(tempRoot, ["clone", "--bare", source, path.join(project, ".bare")]);
  await writeFile(path.join(project, ".git"), "gitdir: ./.bare\n");
  await git(project, ["worktree", "add", "-b", "feature", path.join(project, "feature")]);

  const { addWorktree, invalidateProjectCache, resolveProject } = await loadSubject();
  for (const name of ["repo1.git", "repo2.git"]) {
    const clone = path.join(parent, name);
    const linked = await resolveProject(path.join(clone, "worktree1"));
    assert.equal(linked.isWorktree, true);
    assert.equal(linked.projectRoot, clone);
    assert.equal((await resolveProject(clone)).projectRoot, clone);
  }
  assert.equal((await resolveProject(path.join(project, "feature"))).projectRoot, project);

  // A new worktree goes to that clone, beside it.
  const created = await addWorktree(path.join(parent, "repo1.git"), "created");
  assert.equal(created.path, path.join(parent, "repo1.git-worktrees", "created"));
  assert.equal((await resolveProject(created.path)).projectRoot, path.join(parent, "repo1.git"));

  // Its sessions stay in that project once the folder is gone.
  await rm(created.path, { recursive: true, force: true });
  invalidateProjectCache();
  assert.equal((await resolveProject(created.path)).projectRoot, path.join(parent, "repo1.git"));
});
