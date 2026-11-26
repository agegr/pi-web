import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
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

test("a removed worktree resolves back to the repo it branched from", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-removed-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const repo = path.join(tempRoot, "repo");
  await execFileAsync("git", ["init", repo]);

  const { inferRemovedWorktree, resolveProject } = await loadSubject();

  // Both project resolution paths agree on the repo and the display branch.
  const removed = path.join(`${repo}-worktrees`, "pi-web-agent-abc");
  assert.equal(inferRemovedWorktree(removed)?.projectRoot, realpathSync(repo));
  assert.deepEqual(await resolveProject(removed), inferRemovedWorktree(removed));

  // A cwd that is gone for any other reason has no repo to fall back to.
  assert.equal(inferRemovedWorktree(path.join(tempRoot, "not-a-worktree-dir")), null);
  assert.equal(inferRemovedWorktree(path.join(`${tempRoot}-worktrees`, "orphan")), null);
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

test("tells files a worktree still holds from submodules it contains", async () => {
  const { worktreeHasUncommittedFiles } = await loadSubject();

  assert.equal(worktreeHasUncommittedFiles("fatal: '/tmp/linked' contains modified or untracked files, use --force to delete it"), true);
  assert.equal(worktreeHasUncommittedFiles("fatal: worktree is dirty"), true);
  assert.equal(worktreeHasUncommittedFiles("fatal: working trees containing submodules cannot be moved or removed"), false);
  assert.equal(worktreeHasUncommittedFiles("fatal: unrelated git failure"), false);
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

async function linkedWorktree(t, prefix) {
  const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
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
  await git(repo, ["worktree", "add", "-b", "feature/phantom", linked]);
  return { tempRoot, repo, linked };
}

/** Runs `fn` with a `git` on PATH that is killed before it answers. */
async function withKilledGit(t, tempRoot, fn) {
  const bin = path.join(tempRoot, "killed-bin");
  await mkdir(bin);
  await writeFile(path.join(bin, "git"), "#!/bin/sh\nkill -9 $$\n");
  await chmod(path.join(bin, "git"), 0o755);
  t.mock.method(console, "error", () => {});
  const savedPath = process.env.PATH;
  process.env.PATH = bin;
  try {
    return await fn();
  } finally {
    process.env.PATH = savedPath;
  }
}

test("a killed git is not cached as the worktree's project (phantom project)", { skip: process.platform === "win32" }, async (t) => {
  const { tempRoot, repo, linked } = await linkedWorktree(t, "pi-web-worktree-killed-");
  const { resolveProject } = await loadSubject();

  const degraded = await withKilledGit(t, tempRoot, () => resolveProject(linked));
  assert.equal(degraded.projectRoot, linked);
  assert.equal(degraded.isWorktree, false);

  // The failed run never entered the cache: the next request resolves again.
  const healed = await resolveProject(linked);
  assert.equal(healed.projectRoot, repo);
  assert.equal(healed.isWorktree, true);
  assert.equal(healed.branch, "feature/phantom");
});

test("a killed git during a background refresh keeps the stale project", { skip: process.platform === "win32" }, async (t) => {
  const { tempRoot, repo, linked } = await linkedWorktree(t, "pi-web-worktree-refresh-");
  const { resolveProject } = await loadSubject();
  assert.equal((await resolveProject(linked)).projectRoot, repo);
  globalThis.__piProjectCache.get(linked).expiresAt = 0;

  await withKilledGit(t, tempRoot, async () => {
    assert.equal((await resolveProject(linked)).projectRoot, repo);
    await Promise.allSettled(globalThis.__piProjectRefresh.values());
  });

  const kept = globalThis.__piProjectCache.get(linked).info;
  assert.equal(kept.projectRoot, repo);
  assert.equal(kept.isWorktree, true);
});

test("a removed worktree typed in another letter case resolves alike on both paths", async (t) => {
  const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-case-")));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const repo = path.join(tempRoot, "MyRepo");
  await execFileAsync("git", ["init", repo]);
  // Only a case-insensitive filesystem (macOS, Windows) finds `myrepo`.
  if (!existsSync(path.join(tempRoot, "myrepo"))) return t.skip("case-sensitive filesystem");

  const { inferRemovedWorktree, resolveProject } = await loadSubject();
  // The OS realpath would rewrite `myrepo` to `MyRepo`; Node's JS one, as realpathSync, does not.
  const removed = path.join(tempRoot, "myrepo-worktrees", "feat");
  assert.deepEqual(await resolveProject(removed), inferRemovedWorktree(removed));
});

test("simultaneous cold resolutions share one Git process per cwd", { skip: process.platform === "win32" }, async (t) => {
  const { tempRoot, repo, linked } = await linkedWorktree(t, "pi-web-worktree-shared-");
  const { resolveProject } = await loadSubject();
  const bin = path.join(tempRoot, "counting-bin");
  const calls = path.join(tempRoot, "calls");
  await mkdir(bin);
  await writeFile(path.join(bin, "git"), '#!/bin/sh\nprintf "call\\n" >> "$PI_TEST_GIT_CALLS"\nPATH="$PI_TEST_GIT_PATH" exec git "$@"\n', { mode: 0o755 });
  const savedPath = process.env.PATH;
  process.env.PI_TEST_GIT_PATH = savedPath ?? "";
  process.env.PI_TEST_GIT_CALLS = calls;
  process.env.PATH = bin;
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => resolveProject(linked)));
    assert.ok(results.every((project) => project.projectRoot === repo));
    assert.equal(await readFile(calls, "utf8"), "call\n");
  } finally {
    process.env.PATH = savedPath;
    delete process.env.PI_TEST_GIT_PATH;
    delete process.env.PI_TEST_GIT_CALLS;
  }
});

test("git's own answers are cached, outside a repository or not", async (t) => {
  const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-plain-")));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const { resolveProject } = await loadSubject();
  const errors = t.mock.method(console, "error", () => {});

  const plain = path.join(tempRoot, "plain");
  await mkdir(plain);
  assert.equal((await resolveProject(plain)).projectRoot, plain);
  assert.ok(globalThis.__piProjectCache.has(plain));

  // A permanent failure (here safe.directory refusing the repo) is cached too,
  // so a broken cwd does not spawn git and log on every session list.
  const { repo } = await linkedWorktree(t, "pi-web-worktree-dubious-");
  // Ignore the machine's git config: GitHub's runners vouch for every path
  // with `safe.directory = *`, which would defeat the ownership refusal.
  const saved = {
    GIT_TEST_ASSUME_DIFFERENT_OWNER: process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  };
  process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = "1";
  process.env.GIT_CONFIG_GLOBAL = os.devNull;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  try {
    assert.equal((await resolveProject(repo)).isTopLevel, false);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.ok(globalThis.__piProjectCache.has(repo));
  assert.equal(errors.mock.callCount(), 0);
});

async function gitOut(cwd, args) {
  return (await execFileAsync("git", ["-C", cwd, ...args])).stdout.trim();
}

test("New worktree checks out an existing branch, and names the checkout that already has it (#1431)", async (t) => {
  const { tempRoot, repo, linked } = await linkedWorktree(t, "pi-web-worktree-existing-");
  const origin = path.join(tempRoot, "origin");
  const clone = path.join(tempRoot, "clone");
  await git(tempRoot, ["clone", "--bare", repo, origin]);
  await git(origin, ["branch", "remote-only"]);
  await git(tempRoot, ["clone", origin, clone]);
  await git(clone, ["branch", "free"]);
  const { addWorktree, WorktreeBranchInUseError } = await loadSubject();

  // A local branch nobody has checked out: into the new worktree, not recreated.
  const free = await addWorktree(clone, "free");
  assert.equal(free.path, path.join(`${clone}-worktrees`, "free"));
  assert.equal(await gitOut(free.path, ["symbolic-ref", "HEAD"]), "refs/heads/free");
  // A branch only the remote has: a local one tracking it.
  const remote = await addWorktree(clone, "remote-only");
  assert.equal(await gitOut(remote.path, ["rev-parse", "--abbrev-ref", "@{upstream}"]), "origin/remote-only");

  const refusal = async (cwd, branch, worktreePath, missing = false) => {
    await assert.rejects(addWorktree(cwd, branch), (error) => {
      assert.ok(error instanceof WorktreeBranchInUseError, String(error));
      assert.equal(error.branch, branch);
      assert.equal(error.worktreePath, worktreePath);
      assert.equal(error.missing, missing);
      return true;
    });
  };
  // Checked out elsewhere: the main checkout, a worktree made by hand, one
  // made here (its folder is the new one's, so that is not what is reported).
  await refusal(repo, "feature/phantom", linked);
  await refusal(clone, await gitOut(clone, ["symbolic-ref", "--short", "HEAD"]), clone);
  await refusal(clone, "free", free.path);
  // A worktree whose folder is gone is not listed, and still holds its branch.
  await rm(linked, { recursive: true, force: true });
  await refusal(repo, "feature/phantom", linked, true);
});

test("New worktree again after its folder was deleted says so, not git's missing-worktree refusal (#1431)", async (t) => {
  const { repo } = await linkedWorktree(t, "pi-web-worktree-deleted-");
  const { addWorktree, listWorktrees, WorktreeBranchInUseError } = await loadSubject();
  const created = await addWorktree(repo, "foo");
  await rm(created.path, { recursive: true, force: true });
  assert.equal((await listWorktrees(repo)).some((worktree) => worktree.branch === "foo"), false);

  await assert.rejects(addWorktree(repo, "foo"), (error) => {
    assert.ok(error instanceof WorktreeBranchInUseError, String(error));
    assert.equal(error.worktreePath, created.path);
    assert.equal(error.missing, true);
    assert.match(error.message, /git worktree prune/);
    return true;
  });
  // Nothing was pruned: the entry is the user's to clear.
  assert.match(await gitOut(repo, ["worktree", "list", "--porcelain"]), /prunable/);
  await git(repo, ["worktree", "prune"]);
  assert.equal((await addWorktree(repo, "foo")).path, created.path);
});


test("worktrees of a submodule group under its checkout, not its git dir in .git/modules", async (t) => {
  const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "pi-web-worktree-submodule-")));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const identity = ["-c", "user.name=Pi Web Test", "-c", "user.email=pi-web-test@example.invalid", "-c", "commit.gpgsign=false"];
  const source = path.join(tempRoot, "source");
  await execFileAsync("git", ["init", source]);
  await git(source, [...identity, "commit", "--allow-empty", "-m", "initial"]);
  const parent = path.join(tempRoot, "parent");
  await execFileAsync("git", ["init", parent]);
  await git(parent, ["-c", "protocol.file.allow=always", ...identity, "submodule", "add", source, "sm"]);
  const checkout = path.join(parent, "sm");
  const linked = path.join(tempRoot, "linked");
  await git(checkout, ["worktree", "add", "-b", "feature", linked]);

  const { addWorktree, listWorktrees, resolveProject } = await loadSubject();
  assert.equal((await resolveProject(checkout)).projectRoot, checkout);
  assert.equal((await resolveProject(linked)).projectRoot, checkout);

  const listed = await listWorktrees(linked);
  assert.equal(listed.find((worktree) => worktree.isMain)?.path, checkout);

  const created = await addWorktree(linked, "created");
  assert.equal(created.path, path.join(`${checkout}-worktrees`, "created"));

  // A bare clone whose config names some other folder as core.worktree stays its
  // own root: that folder holds no `.git` pointing back, and would become a file root.
  const other = path.join(tempRoot, "other");
  await mkdir(other);
  const clone = path.join(tempRoot, "clones", "repo.git");
  await git(tempRoot, ["clone", "--bare", source, clone]);
  await git(clone, ["worktree", "add", "-b", "feature", path.join(tempRoot, "clones", "wt")]);
  await git(clone, ["config", "core.worktree", other]);
  assert.equal((await resolveProject(path.join(tempRoot, "clones", "wt"))).projectRoot, clone);
});
