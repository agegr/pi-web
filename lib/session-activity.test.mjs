import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildSessionActivityRows, countCompletedUnread, newlyObservedCompletions } = await createJiti(import.meta.url).import("./session-activity.ts");
const now = new Date(2026, 10, 3, 16, 0);
const time = (days, hour = 12) => new Date(2026, 10, 3 - days, hour, 0).toISOString();
function session(id, days = 0, extra = {}) {
  return { id, path: `/work/${id}.jsonl`, cwd: "/work/project", projectRoot: "/work/project", projectKey: "/work/project", created: time(days), modified: time(days), firstMessage: id, messageCount: 1, ...extra };
}
function input(overrides = {}) {
  return { sessions: [], uiState: { version: 1, revision: 0, sessions: {}, projects: {} }, runningIds: new Set(), awaitingIds: new Set(), unreadIds: new Set(), selectedSessionId: null, retainedUnreadRootId: null, now, ...overrides };
}
function grouped(rows) {
  const groups = {};
  let current;
  for (const row of rows) {
    if (row.kind === "header") groups[current = row.group] = [];
    else groups[current].push(row.family.root.id);
  }
  return groups;
}

test("attention comes first, each group sorts by activity, and archived families are excluded", () => {
  const sessions = [
    session("waiting", 0, { modified: time(0, 9) }), session("running", 0, { modified: time(0, 15) }),
    session("unread", 1), session("today", 0, { modified: time(0, 14) }), session("yesterday", 1),
    session("week", 4), session("old", 9), session("archived", 0),
  ];
  const rows = buildSessionActivityRows(input({
    sessions,
    uiState: { version: 1, revision: 0, sessions: { archived: { archivedAt: now.getTime() } }, projects: {} },
    runningIds: new Set(["waiting", "running"]), awaitingIds: new Set(["waiting"]), unreadIds: new Set(["unread"]),
  }));
  assert.deepEqual(grouped(rows), { priority: ["running", "waiting", "unread"], today: ["today"], yesterday: ["yesterday"], week: ["week"], earlier: ["old"] });
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
  assert.equal(rows.find((row) => row.kind === "session" && row.family.root.id === "waiting").awaiting, true);
});

test("family activity, custom project name, retained read and invalid dates", () => {
  const child = session("child", 0, { relation: { kind: "subagent", parentSessionId: "parent", profile: "explore", description: "", status: "running" } });
  const rows = buildSessionActivityRows(input({
    sessions: [session("parent", 2), child, session("retained", 1), session("invalid", 3, { modified: "invalid" })],
    runningIds: new Set(["child"]), selectedSessionId: "retained", retainedUnreadRootId: "retained",
    uiState: { version: 1, revision: 0, sessions: {}, projects: {}, projectNames: { "/work/project": "Named project" } },
  }));
  assert.deepEqual(grouped(rows), { priority: ["parent", "retained"], earlier: ["invalid"] });
  assert.equal(rows.find((row) => row.kind === "session" && row.family.root.id === "parent").projectName, "Named project");
  assert.equal(rows.find((row) => row.kind === "session" && row.family.root.id === "retained").retained, true);
  const withoutRetention = buildSessionActivityRows(input({ sessions: [session("retained", 1)], selectedSessionId: "another", retainedUnreadRootId: "retained" }));
  assert.deepEqual(grouped(withoutRetention), { yesterday: ["retained"] });
});

test("calendar groups use local day boundaries rather than elapsed 24-hour windows", () => {
  const shortlyAfterMidnight = new Date(2026, 10, 3, 0, 5);
  const previousNight = new Date(2026, 10, 2, 23, 59).toISOString();
  const rows = buildSessionActivityRows(input({ sessions: [session("near-midnight", 0, { modified: previousNight })], now: shortlyAfterMidnight }));
  assert.deepEqual(grouped(rows), { yesterday: ["near-midnight"] });
});

test("another tab's observed completion does not recreate an already-read marker", () => {
  assert.deepEqual(newlyObservedCompletions(["already-seen", "new"], new Set(["already-seen"])), ["new"]);
});

test("the bell counts completed unread sessions in visible, unarchived families", () => {
  const sessions = [session("a"), session("b"), session("manual"), session("archived")];
  const uiState = input().uiState;
  uiState.sessions.archived = { archivedAt: now.getTime() };
  const count = (completed, unread) => countCompletedUnread(new Set(completed), new Set(unread), sessions, uiState, new Set());
  assert.equal(count(["a", "b", "archived"], ["b", "manual", "archived"]), 1);
  assert.equal(count(["a"], []), 0);
  assert.equal(count([], ["manual"]), 0);
  assert.equal(count(["archived"], ["archived"]), 0);
});
