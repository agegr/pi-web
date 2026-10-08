import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  contextForCwd,
  currentWorktreeOf,
  describeProjectChoices,
  mergeProjectChoices,
  newSessionContextKey,
  projectChoices,
} = await jiti.import("./new-session-context.ts");

const main = { path: "/work/app", branch: "main", isMain: true };
const feature = { path: "/work/app-worktrees/feature", branch: "feature", isMain: false };
const context = {
  cwd: "/work/app",
  project: { key: "app-key", root: "/work/app" },
  worktrees: [main, feature],
  currentWorktreePath: "/work/app",
  projects: [{ key: "app-key", root: "/work/app" }, { key: "other-key", root: "/work/other" }],
};

test("the context follows the composer's cwd while the sidebar's report lags", () => {
  assert.equal(contextForCwd(context, "/work/app"), context);
  // A sibling worktree: same project and list, that checkout current.
  assert.deepEqual(contextForCwd(context, feature.path), { ...context, cwd: feature.path, currentWorktreePath: feature.path });
  // Another known project: its key, no worktree list until the sidebar fetched it.
  assert.deepEqual(contextForCwd(context, "/work/other"), {
    cwd: "/work/other",
    project: { key: "other-key", root: "/work/other" },
    worktrees: null,
    currentWorktreePath: null,
    projects: context.projects,
  });
  // A folder nobody listed, or no report at all: a project of its own.
  assert.deepEqual(contextForCwd(context, "/tmp/new").project, { key: "/tmp/new", root: "/tmp/new" });
  assert.deepEqual(contextForCwd(null, "/tmp/new"), {
    cwd: "/tmp/new",
    project: { key: "/tmp/new", root: "/tmp/new" },
    worktrees: null,
    currentWorktreePath: null,
    projects: [],
  });
});

test("the bar's own move is right from the first frame, before the sidebar reports it", () => {
  const before = { ...context, worktrees: [main], currentWorktreePath: main.path };
  // "New worktree…": no report lists it yet. It joins the project's list, current, with its branch.
  const created = { cwd: "/work/app-worktrees/fix", project: { key: "app-key", root: "/work/app" }, branch: "fix/login" };
  assert.deepEqual(contextForCwd(before, created.cwd, created), {
    ...before,
    cwd: created.cwd,
    worktrees: [main, { path: created.cwd, branch: "fix/login", isMain: false }],
    currentWorktreePath: created.cwd,
  });
  // "Open another project…" on a checkout of a project nobody listed: its project, not a folder of its own.
  const opened = { cwd: "/elsewhere/lib-worktrees/next", project: { key: "lib-key", root: "/elsewhere/lib" }, branch: null };
  assert.deepEqual(contextForCwd(before, opened.cwd, opened), {
    cwd: opened.cwd,
    project: opened.project,
    worktrees: null,
    currentWorktreePath: null,
    projects: before.projects,
  });
  assert.deepEqual(contextForCwd(null, opened.cwd, opened).project, opened.project);
  // A move to somewhere else, or a report that caught up, changes nothing.
  assert.deepEqual(contextForCwd(before, "/tmp/new", created).project, { key: "/tmp/new", root: "/tmp/new" });
  assert.equal(contextForCwd(context, context.cwd, created), context);
  assert.deepEqual(contextForCwd(before, main.path, { ...created, cwd: main.path }), { ...before, cwd: main.path, currentWorktreePath: main.path });
});

test("the project list has the current project once", () => {
  assert.deepEqual(projectChoices(context), context.projects);
  assert.notEqual(projectChoices(context), context.projects, "a copy, never the reported array");
  const opened = { ...context, project: { key: "/tmp/new", root: "/tmp/new" } };
  assert.deepEqual(projectChoices(opened), [{ key: "/tmp/new", root: "/tmp/new" }, ...context.projects]);
  // A sidebar with no cwd yet still lists every project.
  const none = { project: null, worktrees: null, currentWorktreePath: null, projects: context.projects };
  assert.deepEqual(projectChoices(none), context.projects);
  assert.equal(currentWorktreeOf(none), null);
});

test("the sidebar's groups come first, then projects only its sessions know", () => {
  assert.deepEqual(
    mergeProjectChoices(
      [{ key: "b", root: "/b", name: "b", pinned: true }, { key: "a", root: "/a" }],
      [{ key: "a", root: "/a" }, { key: "c", root: "/c" }],
    ),
    [{ key: "b", root: "/b" }, { key: "a", root: "/a" }, { key: "c", root: "/c" }],
  );
});

test("project names get their parent folder only when two of them collide", () => {
  assert.deepEqual(
    describeProjectChoices([
      { key: "1", root: "/work/client/app" },
      { key: "2", root: "/work/server/app/" },
      { key: "3", root: "C:\\code\\tools" },
      { key: "4", root: "/app" },
    ]).map(({ name, note }) => [name, note]),
    [["app", "client"], ["app", "server"], ["tools", null], ["app", null]],
  );
});

test("the current worktree is the reported one, else main", () => {
  assert.equal(currentWorktreeOf({ ...context, currentWorktreePath: feature.path }), feature);
  assert.equal(currentWorktreeOf({ ...context, currentWorktreePath: null }), main);
  assert.equal(currentWorktreeOf({ ...context, currentWorktreePath: "/elsewhere" }), main);
  assert.equal(currentWorktreeOf({ ...context, worktrees: [] }), null);
  assert.equal(currentWorktreeOf({ ...context, worktrees: null }), null);
});

test("contexts that show the same have the same key", () => {
  const rebuilt = {
    ...context,
    project: { ...context.project },
    worktrees: context.worktrees.map((worktree) => ({ ...worktree })),
    projects: context.projects.map((project) => ({ ...project })),
  };
  assert.equal(newSessionContextKey(rebuilt), newSessionContextKey(context));
  assert.notEqual(newSessionContextKey({ ...context, currentWorktreePath: feature.path }), newSessionContextKey(context));
  assert.notEqual(newSessionContextKey({ ...context, worktrees: [main] }), newSessionContextKey(context));
  assert.notEqual(newSessionContextKey({ ...context, worktrees: null }), newSessionContextKey(context));
  assert.notEqual(newSessionContextKey({ ...context, projects: context.projects.slice(1) }), newSessionContextKey(context));
  assert.equal(newSessionContextKey(null), "");
});
