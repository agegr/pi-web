import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildRecentSessions } = await createJiti(import.meta.url).import("./recent-sessions.ts");

const projects = [
  { path: "/repos/a", name: "Alpha", archived: false, removed: false },
  { path: "/repos/b", archived: false, removed: false },
];

function session(id, modified, extra = {}) {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: extra.cwd ?? "/repos/a",
    projectRoot: extra.projectRoot ?? extra.cwd ?? "/repos/a",
    name: extra.name,
    firstMessage: extra.firstMessage ?? id,
    created: modified,
    modified,
    messageCount: 1,
    sessionRole: extra.sessionRole ?? "primary",
  };
}

test("returns the eight newest primary sessions with project labels", () => {
  const sessions = Array.from({ length: 10 }, (_, i) => session(`s${i}`, `2026-08-13T00:${String(i).padStart(2, "0")}:00Z`));
  const rows = buildRecentSessions(sessions, projects, new Set());
  assert.equal(rows.length, 8);
  assert.equal(rows[0].session.id, "s9");
  assert.equal(rows[0].projectLabel, "Alpha");
});

test("excludes archived, subagent, removed-project, and archived-project sessions", () => {
  const rows = buildRecentSessions([
    session("good", "2026-08-13T04:00:00Z"),
    session("archived", "2026-08-13T05:00:00Z"),
    session("child", "2026-08-13T06:00:00Z", { sessionRole: "subagent" }),
    session("removed", "2026-08-13T07:00:00Z", { cwd: "/repos/removed" }),
  ], [...projects, { path: "/repos/removed", archived: false, removed: true }], new Set(["archived"]));
  assert.deepEqual(rows.map((row) => row.session.id), ["good"]);
});

test("falls back to the project directory name", () => {
  const [row] = buildRecentSessions([
    session("b", "2026-08-13T04:00:00Z", { cwd: "/repos/b" }),
  ], projects, new Set());
  assert.equal(row.projectLabel, "b");
});
