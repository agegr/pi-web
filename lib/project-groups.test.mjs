import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { projectIdentityKey } = await jiti.import("./project-identity.ts");
const {
  getProjectActivity,
  getRecentProjects,
  isPathInsideDirectory,
  sessionsForDirectory,
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

// --- sessionsForDirectory (custom directory list membership) ---

test("directory membership groups non-git cwds inside the listed root", () => {
  const root = session("root", "/data/scratch", "/data/scratch", "2026-08-12T00:00:00.000Z");
  const nested = session("nested", "/data/scratch/deep/nested", "/data/scratch/deep/nested", "2026-08-13T00:00:00.000Z");
  const sibling = session("sibling", "/data/other", "/data/other", "2026-08-13T00:00:00.000Z");

  assert.deepEqual(
    sessionsForDirectory([root, nested, sibling], "/data/scratch").map((item) => item.id),
    ["root", "nested"],
  );
});

test("directory membership groups worktree sessions via the resolved project root", () => {
  // Linked worktrees live OUTSIDE the repo directory, so cwd containment
  // alone cannot see them — the server-resolved projectRoot must.
  const repo = "C:\\Users\\Alex\\Project";
  const main = session("main", repo, repo, "2026-08-12T00:00:00.000Z");
  const liveWorktree = worktreeSession("live", `${repo}-worktrees\\feature`, repo, "2026-08-13T00:00:00.000Z");
  const elsewhere = session("elsewhere", "D:\\Elsewhere", "D:\\Elsewhere", "2026-08-14T00:00:00.000Z");

  assert.deepEqual(
    sessionsForDirectory([main, liveWorktree, elsewhere], repo).map((item) => item.id),
    ["main", "live"],
  );
});

test("directory membership compares paths loosely (case, separators, trailing slash)", () => {
  const main = session("main", "C:\\Users\\Alex\\Project", "C:\\Users\\Alex\\Project", "2026-08-12T00:00:00.000Z");
  assert.deepEqual(
    sessionsForDirectory([main], "c:/users/alex/project/").map((item) => item.id),
    ["main"],
  );
  assert.equal(isPathInsideDirectory("/A/B", "/a/b/c"), true);
  assert.equal(isPathInsideDirectory("/a/b", "/a/bc"), false);
});

test("directory membership never matches siblings or prefix-lookalikes", () => {
  const a = session("a", "/repos/alpha", "/repos/alpha", "2026-08-12T00:00:00.000Z");
  const b = session("b", "/repos/alpha-x", "/repos/alpha-x", "2026-08-13T00:00:00.000Z");
  assert.deepEqual(
    sessionsForDirectory([a, b], "/repos/alpha").map((item) => item.id),
    ["a"],
  );
  assert.equal(isPathInsideDirectory("/repos/alpha", "/repos/alpha-x"), false);
});

test("a nested git project inside a listed directory groups under it too", () => {
  const inside = session("inside", "/data/repos/x", "/data/repos/x", "2026-08-12T00:00:00.000Z");
  const itsWorktree = worktreeSession("wt", "/data/repos/x-worktrees/br", "/data/repos/x", "2026-08-13T00:00:00.000Z");
  const outside = session("outside", "/elsewhere", "/elsewhere", "2026-08-14T00:00:00.000Z");
  assert.deepEqual(
    sessionsForDirectory([inside, itsWorktree, outside], "/data").map((item) => item.id),
    ["inside", "wt"],
  );
});
