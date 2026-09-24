import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, interopDefault: true });
const {
  SESSION_FILTER_PATTERNS_STORAGE_KEY,
  SHOW_FILTERED_SESSIONS_STORAGE_KEY,
  DEFAULT_SESSION_FILTER_PATTERNS,
  sessionFilterStorage,
  loadSessionFilterPatterns,
  saveSessionFilterPatterns,
  loadShowFilteredSessions,
  saveShowFilteredSessions,
  isSessionFiltered,
} = await jiti.import("./session-filter.ts");

function memoryStorage(initial = new Map()) {
  return {
    getItem: (key) => (initial.has(key) ? initial.get(key) : null),
    setItem: (key, value) => { initial.set(key, String(value)); },
  };
}

/** A storage whose getItem throws — the browser storage-policy denial. */
function throwingStorage() {
  return {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
  };
}

test("storage keys and the default pattern list match the spec", () => {
  assert.equal(SESSION_FILTER_PATTERNS_STORAGE_KEY, "pi-web:session-filter-patterns");
  assert.equal(SHOW_FILTERED_SESSIONS_STORAGE_KEY, "pi-web:show-filtered-sessions");
  assert.deepEqual(DEFAULT_SESSION_FILTER_PATTERNS, ["Execute the pinned skill entry"]);
});

test("a missing key reads the default worker-session pattern", () => {
  assert.deepEqual(loadSessionFilterPatterns(memoryStorage()), ["Execute the pinned skill entry"]);
  assert.deepEqual(loadSessionFilterPatterns(null), ["Execute the pinned skill entry"]);
});

test("patterns round-trip through the storage key", () => {
  const storage = memoryStorage();
  saveSessionFilterPatterns(storage, ["worker", "Execute the pinned skill entry", "部署"]);
  assert.equal(
    storage.getItem(SESSION_FILTER_PATTERNS_STORAGE_KEY),
    JSON.stringify(["worker", "Execute the pinned skill entry", "部署"]),
  );
  assert.deepEqual(loadSessionFilterPatterns(storage), ["worker", "Execute the pinned skill entry", "部署"]);
});

test("a null storage never writes and never throws", () => {
  saveSessionFilterPatterns(null, ["a"]);
  saveShowFilteredSessions(null, true);
  assert.deepEqual(loadSessionFilterPatterns(null), ["Execute the pinned skill entry"]);
  assert.equal(loadShowFilteredSessions(null), false);
});

test("corrupt payloads fall back to the default list", () => {
  for (const raw of ["not json", "42", '"a string"', "{}", "[1, 2]", '["ok", 7]']) {
    const storage = memoryStorage(new Map([[SESSION_FILTER_PATTERNS_STORAGE_KEY, raw]]));
    assert.deepEqual(
      loadSessionFilterPatterns(storage),
      ["Execute the pinned skill entry"],
      `corrupt payload ${raw} must fall back to the defaults`,
    );
  }
});

test("a throwing storage read degrades to the defaults; writes are swallowed", () => {
  const storage = throwingStorage();
  assert.deepEqual(loadSessionFilterPatterns(storage), ["Execute the pinned skill entry"]);
  assert.equal(loadShowFilteredSessions(storage), false);
  // Persistence is best-effort: the throwing setItem must not propagate.
  saveSessionFilterPatterns(storage, ["x"]);
  saveShowFilteredSessions(storage, true);
});

test("whitespace-only lines are ignored and an empty stored list disables hiding", () => {
  const storage = memoryStorage(new Map([
    [SESSION_FILTER_PATTERNS_STORAGE_KEY, JSON.stringify(["  ", "\t", "worker"])],
  ]));
  assert.deepEqual(loadSessionFilterPatterns(storage), ["worker"]);
  const emptyStorage = memoryStorage(new Map([
    [SESSION_FILTER_PATTERNS_STORAGE_KEY, "[]"],
  ]));
  assert.deepEqual(loadSessionFilterPatterns(emptyStorage), []);
});

test("isSessionFiltered matches case-insensitively on name OR firstMessage", () => {
  const patterns = ["Execute THE pinned skill entry", "worker"];
  const byName = { name: "My WORKER session", firstMessage: "hello" };
  const byFirstMessage = { name: undefined, firstMessage: "execute the pinned skill entry below" };
  const unrelated = { name: "Chat about deployments", firstMessage: "hi" };
  assert.equal(isSessionFiltered(byName, patterns), true, "name matches case-insensitively");
  assert.equal(isSessionFiltered(byFirstMessage, patterns), true, "firstMessage matches case-insensitively");
  assert.equal(isSessionFiltered(unrelated, patterns), false);
});

test("an empty pattern list or whitespace-only patterns disable hiding entirely", () => {
  const session = { name: "Execute the pinned skill entry", firstMessage: "worker" };
  assert.equal(isSessionFiltered(session, []), false);
  assert.equal(isSessionFiltered(session, ["   ", "\t"]), false);
});

test("the show-filtered toggle persists under its own key, default false", () => {
  const storage = memoryStorage();
  assert.equal(loadShowFilteredSessions(storage), false);
  saveShowFilteredSessions(storage, true);
  assert.equal(storage.getItem(SHOW_FILTERED_SESSIONS_STORAGE_KEY), "true");
  assert.equal(loadShowFilteredSessions(storage), true);
  saveShowFilteredSessions(storage, false);
  assert.equal(loadShowFilteredSessions(storage), false);
});

test("sessionFilterStorage never throws and is null without a window", () => {
  assert.equal(sessionFilterStorage(), null, "no window in the node test env");
});
