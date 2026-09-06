import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  compareSessionRootOrder,
  movePinnedSession,
  normalizeSessionOrderPreferences,
  setSessionPinned,
} = await import("./session-order.ts");
const {
  readSessionOrderPreferences,
  sessionOrderPreferencesPath,
  writeProjectSessionOrder,
} = await import("./session-order-store.ts");

test("normalizes duplicate and malformed pinned session ids", () => {
  const preferences = normalizeSessionOrderPreferences({
    version: 1,
    projects: {
      project: ["one", "one", 42, "two", ""],
    },
  });
  assert.deepEqual(preferences.projects.project, ["one", "two"]);
  assert.equal(preferences.version, 1);
  assert.deepEqual(
    Object.keys(normalizeSessionOrderPreferences({ version: 2, projects: { project: ["one"] } }).projects),
    [],
  );
});

test("orders pinned roots manually and leaves ordinary roots activity-sorted", () => {
  const sessions = [
    { id: "recent", modified: "2026-03-03T00:00:00.000Z" },
    { id: "pin-b", modified: "2025-01-01T00:00:00.000Z" },
    { id: "older", modified: "2026-03-01T00:00:00.000Z" },
    { id: "pin-a", modified: "2024-01-01T00:00:00.000Z" },
  ];
  const indexes = new Map([["pin-a", 0], ["pin-b", 1]]);
  sessions.sort((a, b) => compareSessionRootOrder(a, b, indexes));
  assert.deepEqual(sessions.map((session) => session.id), ["pin-a", "pin-b", "recent", "older"]);
});

test("pins at the top and moves a pinned session before or after a target", () => {
  assert.deepEqual(setSessionPinned(["a", "b"], "c", true), ["c", "a", "b"]);
  assert.deepEqual(setSessionPinned(["a", "b"], "a", false), ["b"]);
  assert.deepEqual(movePinnedSession(["a", "b", "c"], "a", "b", true), ["b", "a", "c"]);
  assert.deepEqual(movePinnedSession(["a", "b", "c"], "c", "a", false), ["c", "a", "b"]);
});

test("persists project-scoped order privately without losing other projects", (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-session-order-"));
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));

  writeProjectSessionOrder(agentDir, "project-a", ["a", "b"]);
  writeProjectSessionOrder(agentDir, "project-b", ["c"]);

  const preferences = readSessionOrderPreferences(agentDir);
  assert.deepEqual(preferences.projects["project-a"], ["a", "b"]);
  assert.deepEqual(preferences.projects["project-b"], ["c"]);
  const filePath = sessionOrderPreferencesPath(agentDir);
  assert.doesNotThrow(() => JSON.parse(readFileSync(filePath, "utf8")));
  if (process.platform !== "win32") {
    assert.equal(statSync(filePath).mode & 0o777, 0o600);
  }
});

test("treats a corrupt preferences file as empty", (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-session-order-corrupt-"));
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));
  const filePath = sessionOrderPreferencesPath(agentDir);
  writeProjectSessionOrder(agentDir, "project", ["a"]);
  writeFileSync(filePath, "{broken", "utf8");
  chmodSync(filePath, 0o600);
  assert.deepEqual(Object.keys(readSessionOrderPreferences(agentDir).projects), []);
});
