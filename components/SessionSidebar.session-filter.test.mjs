import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

// Importing the module is a parse smoke test (same pattern as the other
// SessionSidebar suites).
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
await jiti.import("./SessionSidebar.tsx");

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const filterLib = await readFile(new URL("../lib/session-filter.ts", import.meta.url), "utf8");
const {
  DEFAULT_SESSION_FILTER_PATTERNS,
  loadSessionFilterPatterns,
  isSessionFiltered,
} = await jiti.import("../lib/session-filter.ts");

function memoryStorage(initial = new Map()) {
  return {
    getItem: (key) => (initial.has(key) ? initial.get(key) : null),
    setItem: (key, value) => { initial.set(key, String(value)); },
  };
}

function session(overrides = {}) {
  return {
    path: "/sessions/s.jsonl",
    id: "s1",
    cwd: "/work/project",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 2,
    firstMessage: "hello",
    ...overrides,
  };
}

test("the sidebar reads the filter through the shared lib and derives visibleSessions from allSessions", () => {
  // The wiring goes through the production store seam (review B1): a LIVE
  // useSyncExternalStore subscription so a Settings edit updates the rendered
  // sidebar in the same window — never a mount-time one-shot read.
  assert.match(source, /import \{\s*getServerSessionFilterState,\s*getSessionFilterState,\s*isSessionFiltered,\s*subscribeSessionFilter,(\s|\n)*\} from "@\/lib\/session-filter";/);
  // SSR: useSyncExternalStore carries a stable getServerSnapshot (React 19
  // server-rendered client components require it).
  assert.match(source, /useSyncExternalStore\(subscribeSessionFilter, getSessionFilterState, getServerSessionFilterState\)/);
  assert.doesNotMatch(source, /loadSessionFilterPatterns\(sessionFilterStorage\(\)\)/);
  assert.doesNotMatch(source, /loadShowFilteredSessions\(sessionFilterStorage\(\)\)/);
  // visibleSessions is derived ONCE from allSessions, before grouping.
  assert.match(
    source,
    /const visibleSessions = useMemo\(\s*\(\) => showFilteredSessions \|\| sessionFilterPatterns\.length === 0\s*\? allSessions\s*: allSessions\.filter\(\(session\) => !isSessionFiltered\(session, sessionFilterPatterns\)\),/,
  );
});

test("every rendered list is fed visibleSessions, never allSessions", () => {
  // Main list: the project-scope filter runs over the already-filtered set.
  assert.match(source, /sessionsForProject\(visibleSessions, selectedProject\.key\)/);
  assert.match(source, /: visibleSessions;/);
  // Pinned groups: the directory grouping runs over the filtered set too.
  assert.match(source, /sessionsForDirectory\(visibleSessions, project\.root\)/);
  // Non-render consumers deliberately keep allSessions: notifications and
  // unread/running bookkeeping must not lose hidden sessions.
  assert.match(source, /knownSubagentIds = new Set\(\s*\n?\s*allSessions\s*\n?\s*\.filter/);
  assert.match(source, /const projects = getRecentProjects\(allSessions\);/);
});

test("a worker session matching the default pattern is hidden while a non-matching sibling is not", () => {
  const patterns = loadSessionFilterPatterns(memoryStorage());
  assert.deepEqual(patterns, [...DEFAULT_SESSION_FILTER_PATTERNS]);
  const worker = session({ id: "w", firstMessage: "Execute the pinned skill entry below" });
  const chat = session({ id: "c", firstMessage: "Chat about the release" });
  assert.equal(isSessionFiltered(worker, patterns), true, "the worker session matches");
  assert.equal(isSessionFiltered(chat, patterns), false, "the sibling does not");
});

test("matching is case-insensitive on name and firstMessage", () => {
  const patterns = ["worker"];
  assert.equal(isSessionFiltered(session({ name: "My WORKER run" }), patterns), true);
  assert.equal(isSessionFiltered(session({ name: undefined, firstMessage: "starting WORKER step" }), patterns), true);
  assert.equal(isSessionFiltered(session({ name: "Deploy", firstMessage: "ship it" }), patterns), false);
});

test("an empty stored pattern array disables hiding; the toggle re-reveals with no visual difference", () => {
  const empty = loadSessionFilterPatterns(memoryStorage(new Map([
    ["pi-web:session-filter-patterns", "[]"],
  ])));
  assert.deepEqual(empty, []);
  const worker = session({ firstMessage: "Execute the pinned skill entry" });
  assert.equal(isSessionFiltered(worker, empty), false, "an empty list hides nothing");
  // The component-level contract: showFilteredSessions OR an empty pattern
  // list short-circuits to the unfiltered allSessions — the re-revealed rows
  // are byte-identical to the pre-feature rendering.
  assert.match(
    source,
    /showFilteredSessions \|\| sessionFilterPatterns\.length === 0\s*\n\s*\? allSessions/,
  );
});

test("the sidebar never reads the filter storage keys directly (only through the lib seam)", () => {
  assert.doesNotMatch(source, /pi-web:session-filter-patterns/);
  assert.doesNotMatch(source, /pi-web:show-filtered-sessions/);
  assert.match(filterLib, /export function sessionFilterStorage\(\)/);
});
