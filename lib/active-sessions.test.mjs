import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getActiveProjects } = await jiti.import("./active-sessions.ts");
const { listSessionFamilies } = await jiti.import("./session-family.ts");
const { sessionsForProject } = await jiti.import("./project-groups.ts");
const now = Date.parse("2026-09-27T12:00:00.000Z");
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
function session(id, project, minutesAgo, extra = {}) {
  return { id, path: `${id}.jsonl`, cwd: project, projectRoot: project, projectKey: project,
    created: at(minutesAgo), modified: at(minutesAgo), messageCount: 1, firstMessage: id, ...extra };
}

test("Active groups running, recent and selected families across projects; Projects remains scoped", () => {
  const sessions = [
    session("old-running", "/a", 120),
    session("recent-a", "/a", 10),
    session("recent-b", "/b", 5),
    session("selected", "/c", 180),
    session("stale", "/b", 90),
    session("child", "/a", 1, { relation: { kind: "subagent", parentSessionId: "old-running", profile: "x", description: "x", status: "running" } }),
    ...Array.from({ length: 12 }, (_, i) => session(`extra-${i}`, "/b", 11 + i)),
  ];
  const groups = getActiveProjects(sessions, new Set(["child"]), new Set(["recent-b"]), "selected", now);
  const rows = groups.flatMap((group) => group.families);
  assert.deepEqual(groups.map((group) => group.key), ["/a", "/b", "/c"]);
  assert.equal(rows.length, 13, "cap only recent families; selected, running and unread must stay visible");
  assert.ok(rows.some((row) => row.root.id === "old-running"));
  assert.ok(rows.some((row) => row.root.id === "selected"));
  assert.ok(rows.some((row) => row.root.id === "recent-b"));
  assert.ok(rows.some((row) => row.root.id === "extra-8"));
  assert.ok(!rows.some((row) => row.root.id === "extra-9"));
  assert.ok(!rows.some((row) => row.root.id === "stale"));
  assert.deepEqual(listSessionFamilies(sessionsForProject(sessions, "/a")).map((row) => row.root.id), ["old-running", "recent-a"]);
});

test("Active never drops running families when more than ten are active", () => {
  const sessions = Array.from({ length: 12 }, (_, i) => session(`running-${i}`, "/a", 120 + i));
  const runningIds = new Set(sessions.map((item) => item.id));
  assert.equal(getActiveProjects(sessions, runningIds, new Set(), null, now)[0].families.length, 12);
});

test("Active falls back to cwd and never promotes orphan subagents", () => {
  const orphan = session("orphan", "/z", 0, { relation: { kind: "subagent", parentSessionId: "missing", profile: "x", description: "x", status: "running" } });
  assert.deepEqual(getActiveProjects([orphan], new Set(["orphan"]), new Set(), null, now), []);
  const cwdOnly = session("cwd-only", "/z", 0, { projectKey: undefined, projectRoot: undefined });
  assert.deepEqual(getActiveProjects([cwdOnly], new Set(), new Set(), null, now).map((group) => group.key), ["/z"]);
  const parent = session("parent", "/a", 120);
  const child = session("child", "/a", 90, { relation: { kind: "subagent", parentSessionId: "parent", profile: "x", description: "x", status: "completed" } });
  assert.deepEqual(getActiveProjects([parent, child], new Set(), new Set(), "child", now)[0].families.map((family) => family.root.id), ["parent"]);
});
