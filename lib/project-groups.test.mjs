import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { projectIdentityKey } = await jiti.import("./project-identity.ts");
const {
  getProjectActivity,
  getRecentProjects,
  partitionRecentProjects,
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

test("hiding a project moves its row out of the picker and into the restorable list", () => {
  const kept = session("kept", "D:\\Elsewhere", "2026-08-13T00:00:00.000Z");
  const hidden = session("hidden", "C:\\Users\\Alex\\Temp", "2026-08-12T00:00:00.000Z");

  const { visible, hidden: restorable } = partitionRecentProjects(
    getRecentProjects([kept, hidden]),
    new Set([hidden.projectKey]),
  );

  assert.deepEqual(visible, [{ key: kept.projectKey, root: kept.projectRoot }]);
  assert.deepEqual(restorable, [{ key: hidden.projectKey, root: hidden.projectRoot }]);
});

test("hiding a project hides every worktree of that repository at once", () => {
  const repo = "C:\\Users\\Alex\\Project";
  const projectKey = projectIdentityKey(repo, "win32");
  const main = { ...session("main", repo, "2026-08-13T00:00:00.000Z"), projectKey };
  const worktree = {
    ...session("worktree", `${repo}-worktrees\\topic`, "2026-08-14T00:00:00.000Z"),
    projectRoot: repo,
    projectKey,
  };

  const projects = getRecentProjects([main, worktree]);
  assert.deepEqual(projects, [{ key: projectKey, root: repo }]);
  assert.deepEqual(partitionRecentProjects(projects, new Set([projectKey])), {
    visible: [],
    hidden: projects,
  });
});

test("nothing is hidden when no project key is hidden", () => {
  const only = session("only", "C:\\Users\\Alex\\Project", "2026-08-12T00:00:00.000Z");

  assert.deepEqual(partitionRecentProjects(getRecentProjects([only]), new Set()), {
    visible: [{ key: only.projectKey, root: only.projectRoot }],
    hidden: [],
  });
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
