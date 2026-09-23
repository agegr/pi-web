import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  buildSidebarRows,
  getWindowedRows,
  scrollTargetForSession,
  GROUP_HEADER_HEIGHT,
  SESSION_LIST_ITEM_HEIGHT,
  sidebarRowsHeight,
} = await jiti.import("./sidebar-rows.ts");

function family(id, modified = `2026-01-${(10 + Number(id)).toString().padStart(2, "0")}T00:00:00.000Z`) {
  return {
    root: { id, modified },
    subagents: [],
    latestModified: modified,
  };
}

test("pinned groups render in pin order with cumulative offsets above the main list", () => {
  const rows = buildSidebarRows({
    pinnedProjects: [
      { key: "/repo-a", root: "/repo-a" },
      { key: "/repo-b", root: "/repo-b" },
    ],
    familiesByProject: new Map([
      ["/repo-a", [family("a1"), family("a2")]],
      ["/repo-b", [family("b1")]],
    ]),
    expandedKeys: new Set(["/repo-a", "/repo-b"]),
    mainFamilies: [family("m1")],
  });

  assert.deepEqual(
    rows.map((row) => [row.kind, row.key, row.offset, row.height]),
    [
      ["groupHeader", "group:/repo-a", 0, GROUP_HEADER_HEIGHT],
      ["session", "a1", GROUP_HEADER_HEIGHT, SESSION_LIST_ITEM_HEIGHT],
      ["session", "a2", GROUP_HEADER_HEIGHT + SESSION_LIST_ITEM_HEIGHT, SESSION_LIST_ITEM_HEIGHT],
      ["groupHeader", "group:/repo-b", GROUP_HEADER_HEIGHT + 2 * SESSION_LIST_ITEM_HEIGHT, GROUP_HEADER_HEIGHT],
      ["session", "b1", 2 * GROUP_HEADER_HEIGHT + 2 * SESSION_LIST_ITEM_HEIGHT, SESSION_LIST_ITEM_HEIGHT],
      ["session", "m1", 2 * GROUP_HEADER_HEIGHT + 3 * SESSION_LIST_ITEM_HEIGHT, SESSION_LIST_ITEM_HEIGHT],
    ],
  );
  assert.equal(
    sidebarRowsHeight(rows),
    2 * GROUP_HEADER_HEIGHT + 4 * SESSION_LIST_ITEM_HEIGHT,
  );
  // Session rows of a group carry their group key; main rows do not.
  assert.equal(rows[1].kind, "session");
  if (rows[1].kind === "session") assert.equal(rows[1].groupKey, "/repo-a");
  assert.equal(rows[5].kind, "session");
  if (rows[5].kind === "session") assert.equal(rows[5].groupKey, null);
});

test("expanding one group leaves the other groups collapsed", () => {
  const expandedA = buildSidebarRows({
    pinnedProjects: [{ key: "/a", root: "/a" }, { key: "/b", root: "/b" }],
    familiesByProject: new Map([
      ["/a", [family("a1")]],
      ["/b", [family("b1")]],
    ]),
    expandedKeys: new Set(["/a"]),
    mainFamilies: [],
  });
  assert.deepEqual(expandedA.map((row) => row.kind), ["groupHeader", "session", "groupHeader"]);
  assert.ok(expandedA.some((row) => row.kind === "session" && row.key === "a1"));
  assert.ok(!expandedA.some((row) => row.kind === "session" && row.key === "b1"));
  assert.ok(!expandedA.some((row) => row.kind === "groupEmpty"));
});

test("an expanded pinned project with zero sessions shows one empty-group hint row", () => {
  const rows = buildSidebarRows({
    pinnedProjects: [{ key: "/empty", root: "/empty" }],
    familiesByProject: new Map(),
    expandedKeys: new Set(["/empty"]),
    mainFamilies: [family("m1")],
  });
  assert.deepEqual(rows.map((row) => [row.kind, row.key]), [
    ["groupHeader", "group:/empty"],
    ["groupEmpty", "group-empty:/empty"],
    ["session", "m1"],
  ]);
  assert.equal(rows[1].kind, "groupEmpty");
  if (rows[1].kind === "groupEmpty") {
    assert.equal(rows[1].groupKey, "/empty");
    assert.equal(rows[1].offset, GROUP_HEADER_HEIGHT);
  }
  // A collapsed empty group contributes only its header.
  const collapsed = buildSidebarRows({
    pinnedProjects: [{ key: "/empty", root: "/empty" }],
    familiesByProject: new Map(),
    expandedKeys: new Set(),
    mainFamilies: [],
  });
  assert.deepEqual(collapsed.map((row) => row.kind), ["groupHeader"]);
});

test("zero pins reproduces the plain fixed-height main list", () => {
  const mainFamilies = Array.from({ length: 3 }, (_, i) => family(`m${i}`));
  const rows = buildSidebarRows({
    pinnedProjects: [],
    familiesByProject: new Map(),
    expandedKeys: new Set(),
    mainFamilies,
  });
  assert.deepEqual(
    rows.map((row) => [row.key, row.offset]),
    mainFamilies.map((f, i) => [f.root.id, i * SESSION_LIST_ITEM_HEIGHT]),
  );
  assert.equal(sidebarRowsHeight(rows), 3 * SESSION_LIST_ITEM_HEIGHT);
});

test("windowing covers the viewport at scroll extremes and clamps short lists", () => {
  const rows = buildSidebarRows({
    pinnedProjects: [{ key: "/a", root: "/a" }],
    familiesByProject: new Map([["/a", Array.from({ length: 50 }, (_, i) => family(`a${i}`))]]),
    expandedKeys: new Set(["/a"]),
    mainFamilies: Array.from({ length: 50 }, (_, i) => family(`m${i}`)),
  });
  const height = sidebarRowsHeight(rows);
  assert.ok(height > 2000);

  const atTop = getWindowedRows(rows, 0, 335);
  assert.deepEqual(atTop, rows.slice(0, atTop.length));
  assert.ok(atTop.length > 0);
  // Every row intersecting the viewport is mounted at the top.
  for (const row of rows) {
    if (row.offset + row.height > 0 && row.offset < 335) assert.ok(atTop.includes(row));
  }

  const atBottom = getWindowedRows(rows, height, 335);
  assert.deepEqual(atBottom, rows.slice(rows.length - atBottom.length));
  // No gaps or overlaps: each windowed row is distinct and in order.
  const order = atBottom.map((row) => rows.indexOf(row));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.equal(new Set(atBottom).size, atBottom.length);

  const short = buildSidebarRows({
    pinnedProjects: [],
    familiesByProject: new Map(),
    expandedKeys: new Set(),
    mainFamilies: [family("m0"), family("m1")],
  });
  assert.deepEqual(getWindowedRows(short, 80000, 335), short);
  assert.deepEqual(getWindowedRows([], 0, 335), []);
  // An unmeasured viewport (0) still yields a sane window.
  assert.ok(getWindowedRows(rows, 0, 0).length > 0);
});

test("the focused session row stays mounted outside the window", () => {
  const rows = buildSidebarRows({
    pinnedProjects: [],
    familiesByProject: new Map(),
    expandedKeys: new Set(),
    mainFamilies: Array.from({ length: 100 }, (_, i) => family(`m${i}`)),
  });
  const scrolledDown = getWindowedRows(rows, 100 * SESSION_LIST_ITEM_HEIGHT - 300, 335, "m0");
  assert.ok(scrolledDown.some((row) => row.kind === "session" && row.key === "m0"));
  assert.ok(scrolledDown.some((row) => row.kind === "session" && row.key === "m99"));

  const scrolledUp = getWindowedRows(rows, 0, 335, "m99");
  assert.ok(scrolledUp.some((row) => row.kind === "session" && row.key === "m99"));

  // A focused row inside the window is not duplicated.
  const inside = getWindowedRows(rows, 0, 335, "m5");
  assert.equal(inside.filter((row) => row.key === "m5").length, 1);

  // A focused row that does not exist changes nothing.
  const missing = getWindowedRows(rows, 0, 335, "nope");
  assert.equal(missing.length, getWindowedRows(rows, 0, 335).length);
});

// --- scrollTargetForSession (split-view sidebar follow) ---

function longListRows() {
  return buildSidebarRows({
    pinnedProjects: [],
    familiesByProject: new Map(),
    expandedKeys: new Set(),
    mainFamilies: Array.from({ length: 100 }, (_, i) => family(`m${i}`)),
  });
}

test("scrollTargetForSession top-aligns a row above the viewport and bottom-aligns one below", () => {
  const rows = longListRows();
  const vh = 335; // ~6 rows visible

  // Row m50 sits far below: reveal its bottom edge with minimal scroll.
  const m50 = rows[50];
  assert.equal(
    scrollTargetForSession(rows, "m50", vh, 0),
    m50.offset + m50.height - vh,
  );
  // Row m2 sits above the scrolled viewport: align its top edge.
  const scrolledPast = 20 * SESSION_LIST_ITEM_HEIGHT;
  assert.equal(
    scrollTargetForSession(rows, "m2", vh, scrolledPast),
    rows[2].offset,
  );
  // A row straddling the bottom edge scrolls the minimal amount too.
  const straddling = scrollTargetForSession(rows, "m7", vh, 0);
  assert.equal(straddling, rows[7].offset + rows[7].height - vh);
  // Targets never go negative: a row near the top pins to 0.
  assert.equal(scrollTargetForSession(rows, "m0", vh, scrolledPast), 0);
});

test("scrollTargetForSession returns null for visible rows, unknown viewports and missing rows", () => {
  const rows = longListRows();
  // Fully inside the viewport: nothing to do — the effect must not fight the
  // user's manual scrolling by re-writing an unchanged scrollTop.
  assert.equal(scrollTargetForSession(rows, "m0", 335, 0), null);
  assert.equal(scrollTargetForSession(rows, "m3", 335, SESSION_LIST_ITEM_HEIGHT), null);
  // Unknown viewport (unmeasured / hidden pane): no honest target exists.
  assert.equal(scrollTargetForSession(rows, "m50", 0, 0), null);
  assert.equal(scrollTargetForSession(rows, "m50", Number.NaN, 0), null);
  assert.equal(scrollTargetForSession(rows, "m50", -10, 0), null);
  // A row absent from the array (collapsed pinned group, unknown session).
  assert.equal(scrollTargetForSession(rows, "nope", 335, 0), null);
  assert.equal(scrollTargetForSession([], "m0", 335, 0), null);
  // A non-finite scrollTop is as unknown as the viewport.
  assert.equal(scrollTargetForSession(rows, "m50", 335, Number.NaN), null);
});

test("scrollTargetForSession addresses rows inside pinned groups by their group offsets", () => {
  const rows = buildSidebarRows({
    pinnedProjects: [
      { key: "/a", root: "/a" },
      { key: "/b", root: "/b" },
    ],
    familiesByProject: new Map([
      ["/a", Array.from({ length: 10 }, (_, i) => family(`a${i}`))],
      ["/b", [family("b0")]],
    ]),
    expandedKeys: new Set(["/a", "/b"]),
    mainFamilies: [family("m0")],
  });
  const vh = GROUP_HEADER_HEIGHT + 2 * SESSION_LIST_ITEM_HEIGHT;
  // A deep row of group /a, scrolled to the very top: its target accounts
  // for the group header above it.
  const a5 = rows.find((row) => row.kind === "session" && row.key === "a5");
  assert.equal(
    scrollTargetForSession(rows, "a5", vh, 0),
    a5.offset + a5.height - vh,
  );
  // The main-list row below both groups targets past all group rows.
  const collapsedB = buildSidebarRows({
    pinnedProjects: [{ key: "/b", root: "/b" }],
    familiesByProject: new Map([["/b", [family("b0")]]]),
    expandedKeys: new Set(),
    mainFamilies: [family("m0")],
  });
  // b0 has no row while its group is collapsed — the caller expands first.
  assert.equal(scrollTargetForSession(collapsedB, "b0", vh, 0), null);
  // The main-list row below the collapsed group still targets by offset.
  const tightVh = GROUP_HEADER_HEIGHT + SESSION_LIST_ITEM_HEIGHT - 10;
  const m0 = collapsedB.find((row) => row.kind === "session" && row.key === "m0");
  assert.equal(
    scrollTargetForSession(collapsedB, "m0", tightVh, 0),
    m0.offset + m0.height - tightVh,
  );
});
