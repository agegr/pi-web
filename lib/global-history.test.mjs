import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  GLOBAL_HISTORY_LIMIT,
  buildGlobalHistoryCandidates,
  buildGlobalHistorySessions,
  matchesGlobalSessionQuery,
} = await jiti.import("./global-history.ts");

function session(id, modified) {
  return {
    path: `E:/sessions/${id}.jsonl`,
    id,
    cwd: `E:/project-${id}`,
    created: modified,
    modified,
    messageCount: 1,
    firstMessage: `Message ${id}`,
  };
}

test("global history excludes running sessions and keeps the newest 30", () => {
  const sessions = Array.from({ length: 33 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return session(`s${index + 1}`, `2026-01-${day}T00:00:00.000Z`);
  });

  const history = buildGlobalHistorySessions(sessions, new Set(["s33", "s32"]));

  assert.equal(GLOBAL_HISTORY_LIMIT, 30);
  assert.equal(history.length, 30);
  assert.equal(history[0].id, "s31");
  assert.equal(history.at(-1)?.id, "s2");
  assert.ok(!history.some(({ id }) => id === "s32" || id === "s33"));
});

test("global history keeps the complete sorted candidate set for pagination", () => {
  const sessions = Array.from({ length: 33 }, (_, index) => (
    session(`s${index + 1}`, new Date(Date.UTC(2026, 0, index + 1)).toISOString())
  ));

  const candidates = buildGlobalHistoryCandidates(sessions, new Set(["s33"]));

  assert.equal(candidates.length, 32);
  assert.equal(candidates[0].id, "s32");
  assert.equal(candidates.at(-1)?.id, "s1");
});

test("global history search matches title, project name, and cwd", () => {
  const searchable = {
    name: "Deploy release",
    firstMessage: "Prepare the production rollout",
    projectRoot: "E:/projects/pi-web",
    cwd: "E:\\projects\\pi-web-worktrees\\release",
  };

  assert.equal(matchesGlobalSessionQuery(searchable, "deploy"), true);
  assert.equal(matchesGlobalSessionQuery(searchable, "pi-web"), true);
  assert.equal(matchesGlobalSessionQuery(searchable, "worktrees/release"), true);
  assert.equal(matchesGlobalSessionQuery(searchable, "unrelated"), false);
  assert.equal(matchesGlobalSessionQuery(searchable, "   "), true);
});

test("global history uses deterministic descending modification order", () => {
  const sessions = [
    session("older", "2026-01-01T00:00:00.000Z"),
    session("newer", "2026-03-01T00:00:00.000Z"),
    session("same-z", "2026-02-01T00:00:00.000Z"),
    session("same-a", "2026-02-01T00:00:00.000Z"),
  ];

  assert.deepEqual(
    buildGlobalHistorySessions(sessions, new Set(["missing"])).map(({ id }) => id),
    ["newer", "same-a", "same-z", "older"],
  );
});
