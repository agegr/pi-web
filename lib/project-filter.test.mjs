import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { filterRowsByProject, setProjectFilterMode, projectFilterInternals } = await jiti.import("./project-filter.ts");

function project(key, extra = {}) {
  return { key, root: `/${key}`, name: key, customName: null, pinned: false, current: false, ...extra };
}

function group(key) {
  return { kind: "group", key: `group:${key}`, project: project(key), expanded: true, running: 0, unread: 0 };
}

function session(key) {
  return {
    kind: "session",
    key: `session:${key}`,
    family: { root: { id: key } },
    context: "group",
    project: project(key),
    status: { running: false, awaiting: false, unread: false, selected: false, transient: false },
    archivedAt: null,
  };
}

test("the filter keeps the picked project's group, rows and footer, and drops the rest", () => {
  const rows = [
    { kind: "pinned-header", key: "pinned-header", count: 1, collapsed: false, running: 0, unread: 0 },
    { kind: "session", key: "pinned:one", family: { root: { id: "one" } }, context: "pinned", project: project("a"), status: {}, archivedAt: null },
    { kind: "pinned-more", key: "pinned-more", hidden: 2, canShowLess: false, nextShown: 0 },
    { kind: "spacer", key: "pinned-spacer" },
    group("a"),
    session("a"),
    { kind: "group-more", key: "more:a", projectKey: "a", hidden: 2, canShowLess: false, nextShown: 0 },
    group("b"),
    session("b"),
    { kind: "group-empty", key: "empty:b", project: project("b") },
    { kind: "spacer", key: "footer-spacer" },
    { kind: "footer-open", key: "footer-open" },
    { kind: "footer-archived", key: "footer-archived", count: 3 },
  ];

  const kept = filterRowsByProject(rows, "a");
  assert.deepEqual(
    kept.map((row) => row.key),
    ["group:a", "session:a", "more:a", "footer-spacer", "footer-open", "footer-archived"],
  );

  // Another project: its own group, not the first one's.
  assert.deepEqual(
    filterRowsByProject(rows, "b").map((row) => row.key),
    ["group:b", "session:b", "empty:b", "footer-spacer", "footer-open", "footer-archived"],
  );
});

test("with no project picked the filter keeps only the footer links", () => {
  const rows = [group("a"), session("a"), group("b"), { kind: "spacer", key: "footer-spacer" }, { kind: "footer-open", key: "footer-open" }];
  assert.deepEqual(
    filterRowsByProject(rows, null).map((row) => row.key),
    ["footer-spacer", "footer-open"],
  );
});

test("filtering nothing is nothing", () => {
  assert.deepEqual(filterRowsByProject([], "a"), []);
});

test("the filter preference writes and parses back", () => {
  // A no-storage environment: the choice applies in memory only.
  setProjectFilterMode("on");
  assert.equal(projectFilterInternals.readStoredMode(), "off", "no window, nothing persisted");
  setProjectFilterMode("off");

  // The parser accepts the two states; anything else is unfiltered.
  assert.equal(projectFilterInternals.parseProjectFilterMode("on"), "on");
  assert.equal(projectFilterInternals.parseProjectFilterMode("off"), "off");
  assert.equal(projectFilterInternals.parseProjectFilterMode("nonsense"), "off");
  assert.equal(projectFilterInternals.parseProjectFilterMode(null), "off");
});
