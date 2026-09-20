import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { projectIdentityKey } = await jiti.import("./project-identity.ts");
const {
  getProjectActivity,
  getRecentProjects,
  isPseudoProjectSession,
  partitionProjectsByPseudo,
  sessionsForProject,
} = await jiti.import("./project-groups.ts");

function session(id, projectRoot, modified) {
  return {
    id,
    path: `${id}.jsonl`,
    cwd: projectRoot,
    projectRoot,
    projectKey: projectIdentityKey(projectRoot, "win32"),
    created: modified,
    modified,
    messageCount: 1,
    firstMessage: id,
  };
}

test("Windows path variants form one recent project using the newest display path", () => {
  const older = session("older", "C:\\Users\\Alex\\Project\\Study\\ELM", "2026-08-12T00:00:00.000Z");
  const newer = session("newer", "c:/users/ALEX/project/study/elm", "2026-08-13T00:00:00.000Z");

  assert.deepEqual(getRecentProjects([older, newer]), [{
    key: older.projectKey,
    root: newer.projectRoot,
  }]);
});

test("project filtering includes every session with the stable identity", () => {
  const first = session("first", "C:\\Users\\Alex\\Project", "2026-08-12T00:00:00.000Z");
  const second = session("second", "c:/users/alex/project/", "2026-08-13T00:00:00.000Z");
  const other = session("other", "D:\\Elsewhere", "2026-08-13T01:00:00.000Z");

  assert.deepEqual(
    sessionsForProject([first, second, other], first.projectKey).map((item) => item.id),
    ["first", "second"],
  );
});

test("running and unread counts aggregate under the stable project identity", () => {
  const first = session("first", "C:\\Users\\Alex\\Project", "2026-08-12T00:00:00.000Z");
  const second = session("second", "c:/users/alex/project/", "2026-08-13T00:00:00.000Z");

  const activity = getProjectActivity(
    [first, second],
    new Set(["first", "second"]),
    new Set(["second"]),
  );

  assert.deepEqual(activity.get(first.projectKey), { running: 2, unread: 1 });
  assert.equal(activity.size, 1);
});

function worktreeSession(id, cwd, repoRoot, modified, extra = {}) {
  return {
    id,
    path: `${id}.jsonl`,
    cwd,
    projectRoot: repoRoot,
    projectKey: projectIdentityKey(repoRoot, "win32"),
    created: modified,
    modified,
    messageCount: 1,
    firstMessage: id,
    isWorktree: true,
    ...extra,
  };
}

test("worktree sessions merge under the parent repo's project row", () => {
  const repo = "C:\\Users\\Alex\\Project";
  const main = session("main", repo, repo, "2026-08-12T00:00:00.000Z");
  const liveWorktree = worktreeSession("live", `${repo}-worktrees\\feature`, repo, "2026-08-13T00:00:00.000Z");
  const removedWorktree = worktreeSession("gone", `${repo}-worktrees\\deleted`, repo, "2026-08-14T00:00:00.000Z");

  const projects = getRecentProjects([main, liveWorktree, removedWorktree]);
  assert.deepEqual(projects.map((project) => project.key), [main.projectKey]);
});

test("removed-worktree activity counts merge under the parent repo key", () => {
  const repo = "C:\\Users\\Alex\\Project";
  const main = session("main", repo, repo, "2026-08-12T00:00:00.000Z");
  const removedWorktree = worktreeSession("gone", `${repo}-worktrees\\deleted`, repo, "2026-08-14T00:00:00.000Z");

  const activity = getProjectActivity(
    [main, removedWorktree],
    new Set(["gone"]),
    new Set(["gone"]),
  );

  assert.equal(activity.size, 1);
  assert.deepEqual(activity.get(main.projectKey), { running: 1, unread: 1 });
});

test("unmergeable pseudo sessions partition into their own rows", () => {
  const repo = "C:\\Users\\Alex\\Project";
  const main = session("main", repo, repo, "2026-08-12T00:00:00.000Z");
  const danglingCwd = "D:\\Elsewhere\\some-worktrees\\gone-branch";
  const dangling = {
    ...session("dangling", danglingCwd, danglingCwd, "2026-08-13T00:00:00.000Z"),
    pseudoProject: true,
  };

  assert.equal(isPseudoProjectSession(dangling), true);
  assert.equal(isPseudoProjectSession(main), false);
  // No flag on a plain cwd-equals-root session — ordinary non-git projects
  // must never be treated as pseudo.
  assert.equal(isPseudoProjectSession({ ...main, projectRoot: main.cwd }), false);

  const projects = getRecentProjects([main, dangling]);
  const partition = partitionProjectsByPseudo(projects, [main, dangling]);
  assert.deepEqual(partition.ordinary.map((project) => project.key), [main.projectKey]);
  assert.deepEqual(partition.pseudo.map((project) => project.key), [dangling.projectKey]);
});

test("partition keeps every row exactly once", () => {
  const a = session("a", "C:\\A", "C:\\A", "2026-08-12T00:00:00.000Z");
  const b = session("b", "D:\\B", "D:\\B", "2026-08-13T00:00:00.000Z", { pseudoProject: true });
  const projects = getRecentProjects([a, b]);
  const partition = partitionProjectsByPseudo(projects, [a, b]);
  assert.equal(partition.ordinary.length + partition.pseudo.length, projects.length);
});
