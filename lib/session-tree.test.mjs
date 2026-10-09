import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  GROUP_VISIBLE_LIMIT,
  PINNED_MORE_KEY,
  PINNED_VISIBLE_LIMIT,
  SHOW_MORE_STEP,
  SIDEBAR_ROW_HEIGHTS,
  adjacentProjectMove,
  autoScrollDelta,
  buildArchiveRows,
  buildSessionTree,
  familiesToArchive,
  familyIds,
  getRowOffsets,
  getVisibleRowIndices,
  ghostTopFor,
  groupBlocks,
  groupDropAt,
  isFamilyArchived,
  isFamilyPinned,
  isGroupExpanded,
  keepOutgoingGroupOpen,
  nextProjectKeysToRecord,
  REVEAL_EXPIRY_MS,
  REVEAL_MAX_MISSES,
  revealScrollTop,
  revealStep,
  showLessFamilies,
  showMoreFamilies,
  shownMoreFor,
  projectNameOf,
} = await jiti.import("./session-tree.ts");
const { listSessionFamilies } = await jiti.import("./session-family.ts");
const {
  MAX_PROJECT_ORDER_KEYS,
  MAX_SESSION_UI_IDS_PER_REQUEST,
  applySessionUiStateRequest,
} = await jiti.import("./session-ui-state-shared.ts");

const DAY = 86_400_000;
const BASE = Date.parse("2026-10-01T00:00:00.000Z");

function iso(ms) {
  return new Date(ms).toISOString();
}

function session(id, { project = "/work/alpha", cwd = project, modified = BASE, ...rest } = {}) {
  return {
    path: `${cwd}/${id}.jsonl`,
    id,
    cwd,
    projectRoot: project,
    projectKey: project,
    created: iso(modified),
    modified: iso(modified),
    messageCount: 1,
    firstMessage: id,
    ...rest,
  };
}

function subagent(id, parentSessionId, options = {}) {
  return session(id, {
    ...options,
    relation: { kind: "subagent", parentSessionId, profile: "explore", description: "Explore", status: "completed" },
  });
}

function uiState({ sessions = {}, projects = {}, projectOrder } = {}) {
  return { version: 1, revision: 0, sessions, projects, ...(projectOrder ? { projectOrder } : {}) };
}

function input(overrides = {}) {
  return {
    sessions: [],
    uiState: uiState(),
    runningIds: new Set(),
    awaitingIds: new Set(),
    unreadIds: new Set(),
    selectedSessionId: null,
    currentProject: null,
    groupExpansion: {},
    moreShown: {},
    pinnedCollapsed: false,
    ...overrides,
  };
}

function familyOf(sessions, rootId) {
  const family = listSessionFamilies(sessions).find((item) => item.root.id === rootId);
  assert.ok(family, `family ${rootId} not found`);
  return family;
}

function describeRows(rows) {
  return rows.map((row) => {
    switch (row.kind) {
      case "session": return `${row.context}:${row.family.root.id}`;
      case "group": return `group:${row.project.name}${row.expanded ? "" : " (collapsed)"}`;
      case "group-more": return `more:${row.hidden}${row.canShowLess ? " less" : ""}`;
      case "pinned-more": return `pinned-more:${row.hidden}${row.canShowLess ? " less" : ""}`;
      case "pinned-header": return `pinned:${row.count}`;
      case "group-empty": return "empty";
      case "spacer": return "-";
      case "footer-archived": return `archived:${row.count}`;
      case "archive-group": return `archive-group:${row.project.name}:${row.count}`;
      default: return row.kind;
    }
  });
}

test("an awaiting member marks its family; the tree's own counts stay the running ones", () => {
  const sessions = [session("root"), subagent("child", "root")];
  const currentProject = { key: "/work/alpha", root: "/work/alpha" };
  const viewing = (overrides) => buildSessionTree(input({ sessions, currentProject, ...overrides }));

  const awaiting = viewing({ runningIds: new Set(["child"]), awaitingIds: new Set(["child"]) });
  const row = awaiting.rows.find((item) => item.kind === "session");
  assert.equal(row.status.running, true, "an awaiting run is still running");
  assert.equal(row.status.awaiting, true);
  // Waiting is not a count of its own: the group header keeps counting runs.
  assert.equal(awaiting.rows.find((item) => item.kind === "group").running, 1);

  const running = viewing({ runningIds: new Set(["child"]) });
  assert.equal(running.rows.find((item) => item.kind === "session").status.awaiting, false);
});

test("family ids list the root first, then every subagent", () => {
  const sessions = [session("root"), subagent("child", "root"), subagent("grandchild", "child")];
  assert.deepEqual(familyIds(familyOf(sessions, "root")), ["root", "child", "grandchild"]);
});

test("forks stay separate rows while subagents fold into their root", () => {
  const sessions = [
    session("parent", { modified: BASE }),
    session("fork", { modified: BASE + 2, relation: { kind: "fork", originSessionId: "parent" } }),
    subagent("child", "parent", { modified: BASE + 1 }),
  ];
  const model = buildSessionTree(input({ sessions, currentProject: { key: "/work/alpha", root: "/work/alpha" } }));
  assert.deepEqual(describeRows(model.rows), ["group:alpha", "group:fork", "group:parent", "-", "footer-open"]);
  assert.deepEqual(model.rows[2].family.subagents.map((item) => item.id), ["child"]);
});

test("a family is archived until its root session gets a newer message", () => {
  const sessions = [session("root", { modified: BASE }), subagent("child", "root", { modified: BASE + 5 * DAY })];
  const family = familyOf(sessions, "root");
  const archivedLater = uiState({ sessions: { root: { archivedAt: BASE + DAY } } });
  const archivedBefore = uiState({ sessions: { root: { archivedAt: BASE - DAY } } });

  assert.equal(isFamilyArchived(family, archivedLater, new Set()), true, "subagent-only activity does not unarchive");
  assert.equal(isFamilyArchived(family, archivedBefore, new Set()), false, "a newer root message returns the family");
  assert.equal(isFamilyArchived(family, uiState({ sessions: { root: { archivedAt: BASE } } }), new Set()), true, "equal times stay archived");
  assert.equal(isFamilyArchived(family, uiState(), new Set()), false);
});

test("a running member keeps the family live; summary rows trust the flag", () => {
  const sessions = [session("root", { modified: BASE + 3 * DAY, detailsPending: true }), subagent("child", "root")];
  const family = familyOf(sessions, "root");
  const state = uiState({ sessions: { root: { archivedAt: BASE } } });

  assert.equal(isFamilyArchived(family, state, new Set()), true, "detailsPending ignores the stat time");
  assert.equal(isFamilyArchived(family, state, new Set(["child"])), false);
  assert.equal(isFamilyArchived(family, state, new Set(["root"])), false);
});

test("pinned requires a pin and a live family; prototype keys never match", () => {
  const sessions = [session("root"), session("constructor")];
  const family = familyOf(sessions, "root");
  assert.equal(isFamilyPinned(family, uiState({ sessions: { root: { pinnedAt: 1 } } }), new Set()), true);
  assert.equal(isFamilyPinned(family, uiState({ sessions: { root: { pinnedAt: 1, archivedAt: BASE + DAY } } }), new Set()), false);
  assert.equal(isFamilyPinned(family, uiState(), new Set()), false);
  const odd = familyOf(sessions, "constructor");
  assert.equal(isFamilyArchived(odd, uiState(), new Set()), false);
  assert.equal(isFamilyPinned(odd, uiState(), new Set()), false);
});

test("project names use the last path segment on POSIX and Windows", () => {
  assert.equal(projectNameOf("/Users/alex/pi-web"), "pi-web");
  assert.equal(projectNameOf("/Users/alex/pi-web/"), "pi-web");
  assert.equal(projectNameOf("C:\\Users\\Alex\\Project\\"), "Project");
  assert.equal(projectNameOf("C:\\Users\\Alex\\Project"), "Project");
  assert.equal(projectNameOf("C:/mixed\\sep/name"), "name");
  assert.equal(projectNameOf("/"), "/");
  assert.equal(projectNameOf("relative"), "relative");
  assert.equal(projectNameOf(""), "");
});

test("groups list the current project first among unpinned projects, then by activity", () => {
  const sessions = [
    session("a1", { project: "/work/alpha", modified: BASE + 2 * DAY }),
    session("b1", { project: "/work/beta", modified: BASE + 3 * DAY }),
    subagent("a1-child", "a1", { project: "/work/alpha", modified: BASE + 4 * DAY }),
  ];
  const model = buildSessionTree(input({
    sessions,
    currentProject: { key: "/work/fresh", root: "/work/fresh" },
  }));

  assert.deepEqual(model.projects.map((project) => project.name), ["fresh", "alpha", "beta"]);
  assert.deepEqual(describeRows(model.rows), [
    "group:fresh", "empty", "-",
    "group:alpha (collapsed)", "-",
    "group:beta (collapsed)", "-",
    "footer-open",
  ]);
  assert.equal(model.projects[0].current, true);
  assert.equal(model.archivedCount, 0);
});

test("pinned projects come first in pin order and use the stored root without sessions", () => {
  const sessions = [
    session("a1", { project: "/work/alpha", modified: BASE + 9 * DAY }),
    session("b1", { project: "/work/beta", modified: BASE }),
  ];
  const state = uiState({
    projects: {
      "/work/gamma": { pinnedAt: 20, root: "/work/gamma" },
      "/work/beta": { pinnedAt: 10, root: "/stale/beta" },
    },
  });
  const model = buildSessionTree(input({ sessions, uiState: state }));

  assert.deepEqual(model.projects.map((project) => [project.name, project.root, project.pinned]), [
    ["beta", "/work/beta", true],
    ["gamma", "/work/gamma", true],
    ["alpha", "/work/alpha", false],
  ]);
  assert.deepEqual(describeRows(model.rows), [
    "group:beta", "group:b1", "-",
    "group:gamma", "empty", "-",
    "group:alpha (collapsed)", "-",
    "footer-open",
  ]);
});

test("a project root comes from its newest family", () => {
  const sessions = [
    session("old", { project: "C:\\Repo", modified: BASE }),
    { ...session("new", { project: "c:/repo", modified: BASE + DAY }), projectKey: "C:\\Repo" },
  ];
  const model = buildSessionTree(input({ sessions }));
  assert.equal(model.projects.length, 1);
  assert.equal(model.projects[0].root, "c:/repo");
  assert.equal(model.projects[0].key, "C:\\Repo");
});

test("a project's display name replaces its folder name everywhere, and changes nothing else", () => {
  const sessions = [
    session("a1", { project: "/work/alpha", modified: BASE + 2 * DAY }),
    session("a2", { project: "/work/alpha", modified: BASE + DAY }),
    session("b1", { project: "/work/beta", modified: BASE + 3 * DAY }),
    session("c1", { project: "/work/gamma", modified: BASE }),
  ];
  const plain = uiState({
    sessions: { a2: { pinnedAt: 1 }, c1: { archivedAt: BASE + DAY } },
    projects: { "/work/beta": { pinnedAt: 5, root: "/work/beta" } },
    projectOrder: ["/work/alpha"],
  });
  // Two projects may share a name: the path (the header's tooltip) tells them apart.
  const named = { ...plain, projectNames: { "/work/alpha": "Thermal Models", "/work/beta": "Thermal Models", "/work/gamma": "Old <b>sims</b>", "/work/gone": "Gone" } };
  const before = buildSessionTree(input({ sessions, uiState: plain, currentProject: { key: "/work/alpha", root: "/work/alpha" } }));
  const after = buildSessionTree(input({ sessions, uiState: named, currentProject: { key: "/work/alpha", root: "/work/alpha" } }));

  assert.deepEqual(after.projects.map((project) => [project.key, project.root, project.name, project.customName]), [
    ["/work/beta", "/work/beta", "Thermal Models", "Thermal Models"],
    ["/work/alpha", "/work/alpha", "Thermal Models", "Thermal Models"],
  ]);
  assert.deepEqual(before.projects.map((project) => [project.name, project.customName]), [["beta", null], ["alpha", null]]);
  // Group headers and a pinned row's project label; same rows, order, pins and expansion otherwise.
  assert.deepEqual(describeRows(after.rows), describeRows(before.rows).map((row) => row.replace(/^group:(alpha|beta)/, "group:Thermal Models")));
  const pinnedRow = after.rows.find((row) => row.kind === "session" && row.context === "pinned");
  assert.equal(pinnedRow.project.name, "Thermal Models");
  assert.equal(pinnedRow.project.root, "/work/alpha");
  assert.deepEqual(
    after.rows.filter((row) => row.kind === "group").map((row) => [row.project.key, row.expanded, row.project.pinned, row.project.current]),
    before.rows.filter((row) => row.kind === "group").map((row) => [row.project.key, row.expanded, row.project.pinned, row.project.current]),
  );
  assert.deepEqual(after.unorderedKeysByBand, before.unorderedKeysByBand);
  assert.deepEqual(after.projectKeysToRecord, before.projectKeysToRecord);
  // The archive view's group headers too; markup-like text is only text.
  const archive = buildArchiveRows({ sessions, uiState: named, runningIds: new Set(), unreadIds: new Set(), selectedSessionId: null, currentProject: null });
  assert.deepEqual(describeRows(archive), ["archive-group:Old <b>sims</b>:1", "archive:c1"]);
});

test("expanded groups show six families plus running, unread and selected ones", () => {
  const sessions = Array.from({ length: 10 }, (_, index) => session(`s${index}`, { modified: BASE - index * 1000 }));
  sessions.push(subagent("s8-child", "s8", { modified: BASE - 8 * 1000 - 1 }));
  const current = { key: "/work/alpha", root: "/work/alpha" };
  const model = buildSessionTree(input({
    sessions,
    currentProject: current,
    runningIds: new Set(["s8-child"]),
    unreadIds: new Set(["s7"]),
    selectedSessionId: "s9",
  }));

  assert.equal(GROUP_VISIBLE_LIMIT, 6);
  assert.deepEqual(describeRows(model.rows), [
    "group:alpha", "group:s0", "group:s1", "group:s2", "group:s3", "group:s4", "group:s5",
    "group:s7", "group:s8", "group:s9", "more:1", "-", "footer-open",
  ]);
  const group = model.rows[0];
  assert.equal(group.running, 1);
  assert.equal(group.unread, 1);
  const s8 = model.rows.find((row) => row.key === "session:group:s8");
  assert.deepEqual(s8.status, { running: true, awaiting: false, unread: false, selected: false, transient: false });
  assert.equal(model.rows.find((row) => row.key === "session:group:s9").status.selected, true);
});

test("show more reveals 20 families a click and offers show less", () => {
  assert.equal(SHOW_MORE_STEP, 20);
  const key = "/work/alpha";
  const sessions = Array.from({ length: 50 }, (_, index) => session(`s${index}`, { modified: BASE - index }));
  const base = input({ sessions, currentProject: { key, root: key } });
  const sessionCount = (model) => model.rows.filter((row) => row.kind === "session").length;
  const moreRow = (model) => model.rows.find((row) => row.kind === "group-more");

  const collapsed = buildSessionTree(base);
  assert.equal(sessionCount(collapsed), 6);
  assert.deepEqual(moreRow(collapsed), { kind: "group-more", key: `more:${key}`, projectKey: key, hidden: 44, canShowLess: false });

  const once = showMoreFamilies({}, key);
  assert.deepEqual(once, { [key]: 20 });
  const first = buildSessionTree({ ...base, moreShown: once });
  assert.equal(sessionCount(first), 26, "one click adds 20, not the whole project");
  assert.deepEqual(moreRow(first), { kind: "group-more", key: `more:${key}`, projectKey: key, hidden: 24, canShowLess: true });

  const twice = showMoreFamilies(once, key);
  const second = buildSessionTree({ ...base, moreShown: twice });
  assert.equal(sessionCount(second), 46);
  assert.equal(moreRow(second).hidden, 4);

  const thrice = showMoreFamilies(twice, key);
  const all = buildSessionTree({ ...base, moreShown: thrice });
  assert.equal(sessionCount(all), 50, "the last click shows what is left");
  assert.deepEqual(moreRow(all), { kind: "group-more", key: `more:${key}`, projectKey: key, hidden: 0, canShowLess: true });

  const folded = showLessFamilies(thrice, key);
  assert.deepEqual(folded, {});
  assert.deepEqual(describeRows(buildSessionTree({ ...base, moreShown: folded }).rows), describeRows(collapsed.rows));

  // Revealed sessions stay in activity order and keep running/unread/selected extras.
  const withExtras = buildSessionTree({ ...base, moreShown: once, selectedSessionId: "s40", runningIds: new Set(["s45"]) });
  const ids = withExtras.rows.filter((row) => row.kind === "session").map((row) => row.family.root.id);
  assert.deepEqual(ids.slice(0, 26), sessions.slice(0, 26).map((item) => item.id));
  assert.deepEqual(ids.slice(26), ["s40", "s45"]);
  assert.equal(moreRow(withExtras).hidden, 22);

  // Nothing to reveal or fold: no row, even with a leftover count.
  const small = buildSessionTree({ ...base, sessions: sessions.slice(0, 3), moreShown: once });
  assert.equal(small.rows.some((row) => row.kind === "group-more"), false);
});

test("each click reveals 20 more even when running, unread or selected families sit in the next window", () => {
  const key = "/work/alpha";
  const sessions = Array.from({ length: 60 }, (_, index) => session(`s${index}`, { modified: BASE - index }));
  // Ten unread families just past the base limit already show; they must not use up a click.
  const unreadIds = new Set(sessions.slice(8, 18).map((item) => item.id));
  const base = input({ sessions, unreadIds, currentProject: { key, root: key } });
  const visibleCount = (model) => model.rows.filter((row) => row.kind === "session").length;
  const hiddenOf = (model) => model.rows.find((row) => row.kind === "group-more")?.hidden;

  let moreShown = {};
  let model = buildSessionTree({ ...base, moreShown });
  assert.equal(visibleCount(model), 16);
  assert.equal(hiddenOf(model), 44);
  for (const [added, hidden] of [[20, 24], [20, 4], [4, 0]]) {
    const before = visibleCount(model);
    moreShown = showMoreFamilies(moreShown, key);
    model = buildSessionTree({ ...base, moreShown });
    assert.equal(visibleCount(model) - before, added);
    assert.equal(hiddenOf(model), hidden);
  }
});

test("show less appears only when it would fold rows back", () => {
  const key = "/work/alpha";
  // Seven families, the seventh running: it shows anyway, so nothing was revealed.
  const sessions = Array.from({ length: 7 }, (_, index) => session(`s${index}`, { modified: BASE - index }));
  const model = buildSessionTree(input({
    sessions,
    runningIds: new Set(["s6"]),
    currentProject: { key, root: key },
    moreShown: { [key]: 20 },
  }));
  assert.equal(model.rows.filter((row) => row.kind === "session").length, 7);
  assert.equal(model.rows.some((row) => row.kind === "group-more"), false, "no show less that would hide nothing");
});

test("show more counts are per key, ignore malformed values and leave other keys alone", () => {
  assert.equal(shownMoreFor({}, "a"), 0);
  assert.equal(shownMoreFor({ a: 20 }, "a"), 20);
  for (const bad of [-5, 0, Number.NaN, Infinity, "20", null]) assert.equal(shownMoreFor({ a: bad }, "a"), 0, String(bad));
  assert.equal(shownMoreFor({ a: 20.7 }, "a"), 20);
  assert.equal(shownMoreFor({}, "constructor"), 0, "inherited keys are not counts");
  assert.deepEqual(showMoreFamilies({ a: 20, b: 40 }, "b"), { a: 20, b: 60 });
  assert.deepEqual(showMoreFamilies({ a: Number.NaN }, "a"), { a: 20 });
  const untouched = { a: 20 };
  assert.equal(showLessFamilies(untouched, "b"), untouched, "show less on another key keeps the same object");
  assert.deepEqual(showLessFamilies({ a: 20, b: 40 }, "a"), { b: 40 });
});

test("explicit group choices win over the current/pinned default", () => {
  const project = { key: "k", root: "/k", name: "k", pinned: false, current: true };
  assert.equal(isGroupExpanded(project, {}), true);
  assert.equal(isGroupExpanded(project, { k: false }), false);
  assert.equal(isGroupExpanded({ ...project, current: false }, {}), false);
  assert.equal(isGroupExpanded({ ...project, current: false, pinned: true }, {}), true);
  assert.equal(isGroupExpanded({ ...project, current: false }, { k: true }), true);
  assert.equal(isGroupExpanded({ ...project, key: "constructor", current: false }, {}), false);

  const sessions = [session("a1")];
  const model = buildSessionTree(input({ sessions, groupExpansion: { "/work/alpha": true } }));
  assert.deepEqual(describeRows(model.rows), ["group:alpha", "group:a1", "-", "footer-open"]);
});

test("a group open only because it was current stays open when another project becomes current", () => {
  const sessions = [
    session("a1", { project: "/work/alpha", modified: BASE + 2 }),
    session("b1", { project: "/work/beta", modified: BASE + 1 }),
  ];
  const alpha = { key: "/work/alpha", root: "/work/alpha" };
  const beta = { key: "/work/beta", root: "/work/beta" };
  // beta opened with its chevron, alpha open by the default; then a session of beta is picked.
  const before = buildSessionTree(input({ sessions, currentProject: alpha, groupExpansion: { "/work/beta": true } }));
  assert.deepEqual(describeRows(before.rows), ["group:alpha", "group:a1", "-", "group:beta", "group:b1", "-", "footer-open"]);
  const after = buildSessionTree(input({ sessions, currentProject: beta, groupExpansion: { "/work/beta": true } }));
  const outgoing = after.projects.find((project) => project.key === alpha.key);
  const kept = keepOutgoingGroupOpen({ "/work/beta": true }, outgoing);
  assert.deepEqual(kept, { "/work/beta": true, "/work/alpha": true });
  const settled = buildSessionTree(input({ sessions, currentProject: beta, groupExpansion: kept }));
  assert.deepEqual(describeRows(settled.rows), describeRows(before.rows), "no row moves");

  // Nothing to keep: an explicit choice (open or closed), a pinned project, the
  // project still being current, or a project whose group is gone.
  const explicit = { "/work/alpha": false };
  assert.equal(keepOutgoingGroupOpen(explicit, outgoing), explicit);
  const choices = {};
  assert.equal(keepOutgoingGroupOpen(choices, { ...outgoing, pinned: true }), choices);
  assert.equal(keepOutgoingGroupOpen(choices, { ...outgoing, current: true }), choices);
  assert.equal(keepOutgoingGroupOpen(choices, undefined), choices);
  // A raw cwd key replaced by the real project key (identity hydration) had only an empty group.
  const hydrated = buildSessionTree(input({ sessions, currentProject: alpha }));
  assert.equal(keepOutgoingGroupOpen(choices, hydrated.projects.find((project) => project.key === "/work/alpha/sub")), choices);
});

test("pinned families move to the global section, newest pin first", () => {
  const sessions = [
    session("a1", { project: "/work/alpha", modified: BASE + 3 }),
    session("a2", { project: "/work/alpha", modified: BASE + 2 }),
    session("b1", { project: "/work/beta", modified: BASE + 1 }),
  ];
  const state = uiState({ sessions: { a2: { pinnedAt: 100 }, b1: { pinnedAt: 200 } } });
  const model = buildSessionTree(input({
    sessions,
    uiState: state,
    unreadIds: new Set(["a2"]),
    groupExpansion: { "/work/alpha": true },
  }));

  assert.deepEqual(describeRows(model.rows), [
    "pinned:2", "pinned:b1", "pinned:a2", "-",
    "group:alpha", "group:a1", "-",
    "footer-open",
  ]);
  assert.deepEqual(model.rows[0], { kind: "pinned-header", key: "pinned-header", count: 2, collapsed: false, running: 0, unread: 1 });
  const pinnedRow = model.rows[1];
  assert.equal(pinnedRow.project.name, "beta", "pinned rows carry their own project");
  assert.equal(model.projects.some((project) => project.key === "/work/beta"), false, "a project with only pinned families has no group");
  assert.equal(model.rows.find((row) => row.kind === "group").unread, 0, "group summaries exclude pinned families");

  const collapsed = buildSessionTree(input({ sessions, uiState: state, pinnedCollapsed: true, currentProject: { key: "/work/beta", root: "/work/beta" } }));
  assert.deepEqual(describeRows(collapsed.rows).slice(0, 2), ["pinned:2", "-"]);
  assert.equal(collapsed.rows[0].collapsed, true);
  // beta's activity comes from its pinned family, so the newer alpha leads.
  assert.deepEqual(describeRows(collapsed.rows).slice(2), ["group:alpha (collapsed)", "-", "group:beta", "empty", "-", "footer-open"]);
});

test("the pinned section shows eight families, then more or less", () => {
  const sessions = Array.from({ length: 10 }, (_, index) => session(`p${index}`, { modified: BASE - index }));
  const pins = Object.fromEntries(sessions.map((item, index) => [item.id, { pinnedAt: 1000 - index }]));
  const base = input({ sessions, uiState: uiState({ sessions: pins }) });

  assert.equal(PINNED_VISIBLE_LIMIT, 8);
  const limited = buildSessionTree(base);
  assert.equal(limited.rows.filter((row) => row.kind === "session").length, 8);
  assert.deepEqual(limited.rows.find((row) => row.kind === "pinned-more"), { kind: "pinned-more", key: "pinned-more", hidden: 2, canShowLess: false });

  const selected = buildSessionTree({ ...base, selectedSessionId: "p9" });
  assert.equal(selected.rows.some((row) => row.key === "session:pinned:p9"), true, "the selected pinned family stays visible");
  assert.equal(selected.rows.find((row) => row.kind === "pinned-more").hidden, 1);

  const all = buildSessionTree({ ...base, moreShown: showMoreFamilies({}, PINNED_MORE_KEY) });
  assert.equal(all.rows.filter((row) => row.kind === "session").length, 10);
  assert.deepEqual(all.rows.find((row) => row.kind === "pinned-more"), { kind: "pinned-more", key: "pinned-more", hidden: 0, canShowLess: true });

  // The pinned section pages by 20 as well.
  const many = Array.from({ length: 40 }, (_, index) => session(`q${index}`, { modified: BASE - index }));
  const manyPins = Object.fromEntries(many.map((item, index) => [item.id, { pinnedAt: 1000 - index }]));
  const paged = buildSessionTree(input({ sessions: many, uiState: uiState({ sessions: manyPins }), moreShown: { [PINNED_MORE_KEY]: 20 } }));
  assert.equal(paged.rows.filter((row) => row.kind === "session").length, 28);
  assert.deepEqual(paged.rows.find((row) => row.kind === "pinned-more"), { kind: "pinned-more", key: "pinned-more", hidden: 12, canShowLess: true });
});

test("archived families leave the tree and are counted across projects", () => {
  const sessions = [
    session("a1", { project: "/work/alpha", modified: BASE }),
    session("a2", { project: "/work/alpha", modified: BASE - 1 }),
    session("b1", { project: "/work/beta", modified: BASE }),
  ];
  const state = uiState({ sessions: { a2: { archivedAt: BASE + DAY }, b1: { archivedAt: BASE + DAY } } });
  const model = buildSessionTree(input({ sessions, uiState: state, groupExpansion: { "/work/alpha": true } }));

  assert.deepEqual(describeRows(model.rows), ["group:alpha", "group:a1", "-", "footer-open", "archived:2"]);
  assert.equal(model.archivedCount, 2);
});

test("with no sessions and no current or pinned project only the footer remains", () => {
  assert.deepEqual(describeRows(buildSessionTree(input()).rows), ["footer-open"]);
  const allArchived = buildSessionTree(input({
    sessions: [session("a1")],
    uiState: uiState({ sessions: { a1: { archivedAt: BASE + DAY } } }),
  }));
  assert.deepEqual(describeRows(allArchived.rows), ["footer-open", "archived:1"]);
});

test("row keys are unique and session rows carry transient status", () => {
  const sessions = [
    session("a1", { project: "/work/alpha" }),
    session("a2", { project: "/work/alpha", transient: true }),
    session("b1", { project: "/work/beta" }),
    session("c1", { project: "/work/gamma" }),
  ];
  const model = buildSessionTree(input({
    sessions,
    uiState: uiState({ sessions: { b1: { pinnedAt: 1 } }, projects: { "/work/gamma": { pinnedAt: 1, root: "/work/gamma" } } }),
    currentProject: { key: "/work/alpha", root: "/work/alpha" },
  }));
  const keys = model.rows.map((row) => row.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes("session:pinned:b1"));
  assert.ok(keys.includes("session:group:a1"));
  assert.ok(keys.includes("group:/work/gamma"));
  assert.ok(keys.includes("spacer:/work/alpha"));
  assert.equal(model.rows.find((row) => row.key === "session:group:a2").status.transient, true);
  assert.equal(model.rows.find((row) => row.key === "session:group:a1").archivedAt, null);
});

test("archive rows group by project, newest archive first", () => {
  const sessions = [
    session("a1", { project: "/work/alpha" }),
    session("a2", { project: "/work/alpha" }),
    session("b1", { project: "/work/beta" }),
    session("live", { project: "/work/beta" }),
  ];
  const state = uiState({
    sessions: {
      a1: { archivedAt: BASE + 1 * DAY },
      a2: { archivedAt: BASE + 3 * DAY },
      b1: { archivedAt: BASE + 2 * DAY },
    },
  });
  const rows = buildArchiveRows({
    sessions,
    uiState: state,
    runningIds: new Set(),
    awaitingIds: new Set(),
    unreadIds: new Set(["a1"]),
    selectedSessionId: "b1",
    currentProject: { key: "/work/beta", root: "/work/beta" },
  });

  assert.deepEqual(describeRows(rows), [
    "archive-group:alpha:2", "archive:a2", "archive:a1",
    "archive-group:beta:1", "archive:b1",
  ]);
  assert.equal(rows[1].archivedAt, BASE + 3 * DAY);
  assert.equal(rows[2].status.unread, true);
  assert.equal(rows[4].status.selected, true);
  assert.equal(rows[3].project.current, true);
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
});

test("bulk archive candidates skip pinned, running, unread, selected, transient and recent families", () => {
  const now = BASE + 30 * DAY;
  const old = BASE;
  const sessions = [
    session("old", { modified: old }),
    session("pinned", { modified: old }),
    session("running", { modified: old }),
    subagent("running-child", "running", { modified: old }),
    session("unread", { modified: old }),
    session("selected", { modified: old }),
    session("transient", { modified: old, transient: true }),
    session("recent", { modified: now - DAY }),
    session("archived", { modified: old }),
    session("other", { project: "/work/beta", modified: old }),
    session("busy-family", { modified: old }),
    subagent("busy-child", "busy-family", { modified: now - DAY }),
  ];
  const ids = familiesToArchive({
    sessions,
    uiState: uiState({ sessions: { pinned: { pinnedAt: 1 }, archived: { archivedAt: now } } }),
    runningIds: new Set(["running-child"]),
    awaitingIds: new Set(),
    unreadIds: new Set(["unread"]),
    selectedSessionId: "selected",
  }, "/work/alpha", 7 * DAY, now);

  assert.deepEqual(ids, ["old"]);
});

test("row offsets follow each kind's height for the layout", () => {
  const rows = [
    { kind: "group", key: "group:a" },
    { kind: "session", key: "session:group:a" },
    { kind: "spacer", key: "spacer:a" },
    { kind: "footer-open", key: "footer-open" },
  ];
  assert.deepEqual(getRowOffsets(rows, "desktop"), [0, 28, 60, 68, 98]);
  assert.deepEqual(getRowOffsets(rows, "mobile"), [0, 40, 84, 92, 136]);
  assert.deepEqual(getRowOffsets([], "desktop"), [0]);
  assert.equal(SIDEBAR_ROW_HEIGHTS.mobile.session, 44);
});

test("visible indices cover the viewport and overscan, sorted and unique", () => {
  const offsets = Array.from({ length: 2001 }, (_, index) => index * 32);
  const visible = getVisibleRowIndices(offsets, 3200, 320, 64);
  // Rows 98..111 intersect [3136, 3584).
  assert.deepEqual(visible, Array.from({ length: 14 }, (_, index) => 98 + index));

  const withFocus = getVisibleRowIndices(offsets, 3200, 320, 64, [5, 1500, 100, 5, -1, 2000, 1.5]);
  assert.deepEqual(withFocus, [5, ...visible, 1500]);

  assert.deepEqual(getVisibleRowIndices(offsets, 0, 64, 0), [0, 1]);
  assert.deepEqual(getVisibleRowIndices(offsets, 10, 32, 0), [0, 1]);
});

test("visible indices stay valid for short, empty and unmeasured lists", () => {
  const short = [0, 32, 64, 96, 128, 160];
  assert.deepEqual(getVisibleRowIndices(short, 5000, 320, 240), [], "scrolled past a list that shrank");
  assert.deepEqual(getVisibleRowIndices(short, 0, 320, 240), [0, 1, 2, 3, 4]);
  assert.deepEqual(getVisibleRowIndices([0], 0, 320, 240, [0]), []);
  const long = Array.from({ length: 101 }, (_, index) => index * 32);
  assert.equal(getVisibleRowIndices(long, 0, 0, 0).length, 19, "viewport 0 assumes 600px");
  assert.deepEqual(getVisibleRowIndices(long, Number.NaN, 0, 0), getVisibleRowIndices(long, 0, 600, 0));
});

test("a row out of view is scrolled to the middle; one in view stays put", () => {
  // Rows of 32px: row 10 spans 320-352.
  const offsets = Array.from({ length: 101 }, (_, index) => index * 32);
  assert.equal(revealScrollTop(offsets, 10, 0, 400), null, "wholly in view");
  assert.equal(revealScrollTop(offsets, 10, 300, 400), null);
  assert.equal(revealScrollTop(offsets, 10, 330, 400), 136, "partly above: centred");
  assert.equal(revealScrollTop(offsets, 10, 0, 340), 166, "partly below: centred");
  assert.equal(revealScrollTop(offsets, 1, 3000, 400), 0, "never above the top");
  assert.equal(revealScrollTop(offsets, 99, 0, 20), 3168, "a viewport smaller than the row puts its top first");
  for (const index of [-1, 100, 1.5, Number.NaN]) assert.equal(revealScrollTop(offsets, index, 0, 400), null);
});

test("a reveal request is shown while fresh, waits a few rows updates for its row, and is dropped when old", () => {
  const at = 1_000_000;
  const request = { id: 7, at };
  assert.deepEqual(revealStep(null, request, true, at), { misses: { id: 7, misses: 0 }, action: "reveal" });

  // Missing rows: wait, then drop on the REVEAL_MAX_MISSES-th miss.
  let misses = null;
  for (let look = 1; look < REVEAL_MAX_MISSES; look++) {
    const step = revealStep(misses, request, false, at + look);
    assert.equal(step.action, "wait");
    assert.equal(step.misses.misses, look);
    misses = step.misses;
  }
  assert.equal(revealStep(misses, request, false, at + 10).action, "drop");
  // Found after a miss or two, while fresh: shown.
  assert.equal(revealStep(misses, request, true, at + 10).action, "reveal");

  // Too old, found or not: a row that turns up minutes later (its group
  // expanded), or a tree mounted again after the request went stale, never
  // scrolls to it.
  assert.equal(revealStep({ id: 7, misses: 1 }, request, true, at + REVEAL_EXPIRY_MS + 1).action, "drop");
  assert.equal(revealStep(null, request, true, at + 5 * 60_000).action, "drop");
  assert.equal(revealStep(null, request, false, at + REVEAL_EXPIRY_MS + 1).action, "drop");
  assert.equal(revealStep(null, request, true, at + REVEAL_EXPIRY_MS).action, "reveal", "the limit itself still counts");
  assert.equal(revealStep(null, { id: 7, at: Number.NaN }, true, at).action, "drop");

  // Another request starts its own count.
  assert.deepEqual(revealStep({ id: 7, misses: 2 }, { id: 8, at }, false, at), { misses: { id: 8, misses: 1 }, action: "wait" });
});

const names = (model) => model.projects.map((project) => project.name);
const keysOf = (projects) => projects.map((project) => project.key);
const pinnedProject = (pinnedAt, root) => ({ pinnedAt, root });

test("a project with a place keeps it when another project gets newer activity", () => {
  const sessions = [
    session("a1", { project: "/work/alpha", modified: BASE + DAY }),
    session("b1", { project: "/work/beta", modified: BASE + 2 * DAY }),
    session("c1", { project: "/work/gamma", modified: BASE + 3 * DAY }),
  ];
  assert.deepEqual(names(buildSessionTree(input({ sessions }))), ["gamma", "beta", "alpha"], "no order: by activity");
  const state = uiState({ projectOrder: ["/work/alpha", "/work/beta", "/work/gamma"] });
  assert.deepEqual(names(buildSessionTree(input({ sessions, uiState: state }))), ["alpha", "beta", "gamma"]);
  // A new message, a run, a selection or an unread marker in the last project moves nothing.
  const busy = buildSessionTree(input({
    sessions: [...sessions, session("c2", { project: "/work/gamma", modified: BASE + 9 * DAY })],
    uiState: state,
    runningIds: new Set(["c2"]),
    unreadIds: new Set(["c1"]),
    selectedSessionId: "c2",
    currentProject: { key: "/work/gamma", root: "/work/gamma" },
  }));
  assert.deepEqual(names(busy), ["alpha", "beta", "gamma"]);
  assert.deepEqual(busy.projectKeysToRecord, []);
  assert.deepEqual(busy.unorderedKeysByBand, { pinned: [], other: [] });
});

test("projects without a place come first in their band, those not saved on their own first of all", () => {
  const sessions = [
    session("a1", { project: "/work/alpha", modified: BASE + 8 * DAY }),
    session("b1", { project: "/work/beta", modified: BASE + 9 * DAY }),
    session("d1", { project: "/work/delta", modified: BASE + DAY }),
    session("e1", { project: "/work/epsilon", modified: BASE + 5 * DAY }),
    session("t1", { project: "/work/temp", modified: BASE + 2 * DAY, transient: true }),
    session("x1", { project: "/work/hidden", modified: BASE }),
  ];
  const model = buildSessionTree(input({
    sessions,
    uiState: uiState({ sessions: { x1: { archivedAt: BASE + DAY } }, projectOrder: ["/gone", "/work/alpha", "/work/hidden", "/work/beta"] }),
    currentProject: { key: "/work/fresh", root: "/work/fresh" },
  }));
  // The empty current project and a project of transient sessions only, then
  // the new ones by activity, then the saved ones; saved keys not shown are skipped.
  assert.deepEqual(names(model), ["fresh", "temp", "epsilon", "delta", "alpha", "beta"]);
  assert.deepEqual(model.unorderedKeysByBand, { pinned: [], other: ["/work/fresh", "/work/temp", "/work/epsilon", "/work/delta"] });
  assert.deepEqual(model.projectKeysToRecord, ["/work/epsilon", "/work/delta"], "never the empty current project or a transient-only one");
});

test("the pinned band follows the stored order and stays above the others", () => {
  const sessions = [
    session("a1", { project: "/work/alpha", modified: BASE + 9 * DAY }),
    session("p1s", { project: "/work/p1", modified: BASE }),
  ];
  const projects = {
    "/work/p1": pinnedProject(10, "/work/p1"),
    "/work/p2": pinnedProject(20, "/work/p2"),
    "/work/p3": pinnedProject(30, "/work/p3"),
    "/work/p4": pinnedProject(5, "/work/p4"),
  };
  const model = buildSessionTree(input({
    sessions,
    uiState: uiState({ projects, projectOrder: ["/work/p2", "/work/alpha", "/work/p1"] }),
  }));
  // Pinned without a place, in pin order (p4, p3), then the saved ones (p2, p1); then the others.
  assert.deepEqual(names(model), ["p4", "p3", "p2", "p1", "alpha"]);
  assert.deepEqual(model.unorderedKeysByBand, { pinned: ["/work/p4", "/work/p3"], other: [] });
  assert.deepEqual(model.projectKeysToRecord, ["/work/p4", "/work/p3"], "pinned projects are saved even without sessions");
});

test("a current project with a place keeps it while it has no sessions", () => {
  const model = buildSessionTree(input({
    sessions: [session("a1", { project: "/work/alpha" })],
    uiState: uiState({ projectOrder: ["/work/alpha", "/work/fresh"] }),
    currentProject: { key: "/work/fresh", root: "/work/fresh" },
  }));
  assert.deepEqual(names(model), ["alpha", "fresh"]);
});

/** Saving what the model asks to save never moves a group on screen. */
function assertSavingKeepsOrder(treeInput) {
  const before = buildSessionTree(treeInput);
  assert.ok(before.projectKeysToRecord.length > 0, "the case saves something");
  const saved = applySessionUiStateRequest(treeInput.uiState, { action: "add-projects", keys: before.projectKeysToRecord }, 0).state;
  const after = buildSessionTree({ ...treeInput, uiState: saved });
  assert.deepEqual(keysOf(after.projects), keysOf(before.projects));
  assert.deepEqual(after.projectKeysToRecord, []);
  return { before, after, saved };
}

test("saving new projects changes nothing on screen", () => {
  const sessions = [
    session("a1", { project: "/work/alpha", modified: BASE + 3 * DAY }),
    session("b1", { project: "/work/beta", modified: BASE + DAY }),
    session("c1", { project: "/work/gamma", modified: BASE + 2 * DAY }),
  ];
  // No order yet: the first save records the activity order.
  const seed = assertSavingKeepsOrder(input({ sessions }));
  assert.deepEqual(seed.saved.projectOrder, ["/work/alpha", "/work/gamma", "/work/beta"]);
  // A transient-only project between two new ones, with a partial order.
  assertSavingKeepsOrder(input({
    sessions: [
      ...sessions,
      session("u1", { project: "/work/u1", modified: BASE + 9 * DAY }),
      session("t1", { project: "/work/temp", modified: BASE + 8 * DAY, transient: true }),
      session("u2", { project: "/work/u2", modified: BASE + 7 * DAY }),
    ],
    uiState: uiState({ projectOrder: ["/work/beta"] }),
  }));
  // Pinned projects without sessions, and the empty current project.
  const pinned = assertSavingKeepsOrder(input({
    sessions,
    uiState: uiState({
      projects: { "/work/p1": pinnedProject(20, "/work/p1"), "/work/p2": pinnedProject(10, "/work/p2") },
      projectOrder: ["/work/gamma"],
    }),
    currentProject: { key: "/work/fresh", root: "/work/fresh" },
  }));
  assert.deepEqual(names(pinned.after), ["p2", "p1", "fresh", "alpha", "beta", "gamma"]);
  assert.equal(pinned.saved.projectOrder.includes("/work/fresh"), false);
});

/** Projects "/work/d0000".."/work/d<count-1>", one session each, d0000 the newest. */
function manyProjects(count) {
  return Array.from({ length: count }, (_, index) => {
    const name = `d${String(index).padStart(4, "0")}`;
    return session(name, { project: `/work/${name}`, modified: BASE - index * 60_000 });
  });
}

test("saving more new projects than one request holds goes bottom first, so nothing moves on screen", () => {
  // As the sidebar does it: one request at a time, each key sent once,
  // until nothing is left or the list is full. Pinned projects without
  // sessions sit above the others, in the same list.
  for (const count of [600, 1200]) {
    const treeInput = input({
      sessions: manyProjects(count),
      uiState: uiState({ projects: { "/work/p1": pinnedProject(1, "/work/p1"), "/work/p2": pinnedProject(2, "/work/p2") } }),
    });
    const shown = keysOf(buildSessionTree(treeInput).projects);
    const sent = new Set();
    let state = treeInput.uiState;
    let requests = 0;
    for (;;) {
      if ((state.projectOrder?.length ?? 0) >= MAX_PROJECT_ORDER_KEYS) break;
      const model = buildSessionTree({ ...treeInput, uiState: state });
      const keys = nextProjectKeysToRecord(model.projectKeysToRecord, sent, MAX_SESSION_UI_IDS_PER_REQUEST);
      if (keys.length === 0) break;
      if (requests === 0) assert.deepEqual(keys, model.projectKeysToRecord.slice(-MAX_SESSION_UI_IDS_PER_REQUEST), "the bottom ones first");
      for (const key of keys) sent.add(key);
      state = applySessionUiStateRequest(state, { action: "add-projects", keys }, 0).state;
      requests++;
      assert.deepEqual(keysOf(buildSessionTree({ ...treeInput, uiState: state }).projects), shown, `${count} projects, after request ${requests}`);
    }
    const after = buildSessionTree({ ...treeInput, uiState: state });
    if (count === 600) {
      assert.equal(requests, 2);
      assert.deepEqual(after.projectKeysToRecord, []);
      assert.deepEqual(state.projectOrder, shown);
    } else {
      // Full: the newest 202 stay unsaved, at the top where they were.
      assert.equal(requests, 2);
      assert.equal(state.projectOrder.length, MAX_PROJECT_ORDER_KEYS);
      assert.deepEqual(after.projectKeysToRecord, shown.slice(0, count + 2 - MAX_PROJECT_ORDER_KEYS));
    }
  }
});

test("a key sent but still unsaved ends the next batch: nothing is saved above it", () => {
  const toRecord = ["/a", "/b", "/c", "/d", "/e"];
  assert.deepEqual(nextProjectKeysToRecord(toRecord, new Set(), 10), toRecord);
  assert.deepEqual(nextProjectKeysToRecord(toRecord, new Set(), 2), ["/d", "/e"]);
  // "/c" was refused or did not fit: "/a" and "/b" would land below it.
  assert.deepEqual(nextProjectKeysToRecord(toRecord, new Set(["/c"]), 10), ["/d", "/e"]);
  assert.deepEqual(nextProjectKeysToRecord(toRecord, new Set(["/e"]), 10), []);
  assert.deepEqual(nextProjectKeysToRecord([], new Set(), 10), []);

  // A refused first save, then a new project: it stays unsaved, at the top.
  const sessions = [
    session("a1", { project: "/work/alpha", modified: BASE + 2 * DAY }),
    session("b1", { project: "/work/beta", modified: BASE + DAY }),
  ];
  const first = buildSessionTree(input({ sessions }));
  const sent = new Set(nextProjectKeysToRecord(first.projectKeysToRecord, new Set(), MAX_SESSION_UI_IDS_PER_REQUEST));
  const later = buildSessionTree(input({ sessions: [...sessions, session("n1", { project: "/work/new", modified: BASE + 3 * DAY })] }));
  assert.deepEqual(names(later), ["new", "alpha", "beta"]);
  assert.deepEqual(nextProjectKeysToRecord(later.projectKeysToRecord, sent, MAX_SESSION_UI_IDS_PER_REQUEST), []);
});

test("a move with more unsaved projects in its band than one request holds saves the bottom ones", () => {
  // Before the first save: 700 projects, none with a place.
  const treeInput = input({ sessions: manyProjects(700) });
  const model = buildSessionTree(treeInput);
  const shown = keysOf(model.projects);
  const add = model.unorderedKeysByBand.other.slice(-MAX_SESSION_UI_IDS_PER_REQUEST);
  // d0650 dragged right after d0600, both among the bottom 500.
  const moved = applySessionUiStateRequest(treeInput.uiState, {
    action: "move-project", projectKey: "/work/d0650", anchorKey: "/work/d0600", position: "after", add,
  }, 0);
  const expected = shown.filter((key) => key !== "/work/d0650");
  expected.splice(expected.indexOf("/work/d0600") + 1, 0, "/work/d0650");
  assert.deepEqual(keysOf(buildSessionTree({ ...treeInput, uiState: moved.state }).projects), expected);
});

test("every drop target, applied with its band's unsaved keys, puts the group where it was dropped", () => {
  const sessions = [
    session("p1s", { project: "/work/p1", modified: BASE }),
    session("a1", { project: "/work/alpha", modified: BASE + DAY }),
    session("a2", { project: "/work/alpha", modified: BASE + 2 * DAY }),
    session("b1", { project: "/work/beta", modified: BASE + 3 * DAY }),
    session("u1", { project: "/work/u1", modified: BASE + 9 * DAY }),
    session("t1", { project: "/work/temp", modified: BASE + 8 * DAY, transient: true }),
    session("u2", { project: "/work/u2", modified: BASE + 7 * DAY }),
  ];
  const treeInput = input({
    sessions,
    uiState: uiState({
      projects: { "/work/p1": pinnedProject(1, "/work/p1"), "/work/p2": pinnedProject(2, "/work/p2"), "/work/p3": pinnedProject(3, "/work/p3") },
      projectOrder: ["/work/p2", "/gone", "/work/beta", "/work/hidden", "/work/alpha", "/work/p1"],
    }),
    groupExpansion: { "/work/alpha": true, "/work/u1": true, "/work/p2": false },
  });
  const model = buildSessionTree(treeInput);
  assert.deepEqual(names(model), ["p3", "p2", "p1", "temp", "u1", "u2", "beta", "alpha"]);
  const offsets = getRowOffsets(model.rows, "desktop");
  const blocks = groupBlocks(model.rows, offsets);
  const height = offsets[offsets.length - 1];
  let drops = 0;
  for (const dragged of model.projects) {
    const band = (projects) => keysOf(projects.filter((project) => project.pinned === dragged.pinned));
    const otherBand = (projects) => keysOf(projects.filter((project) => project.pinned !== dragged.pinned));
    const others = blocks.filter((block) => block.pinned === dragged.pinned && block.key !== dragged.key);
    for (let y = -20; y <= height + 20; y += 3) {
      const drop = groupDropAt(blocks, dragged.key, y);
      // Expected: after every other block of its band whose middle is above the pointer.
      const slot = others.filter((block) => (block.top + block.bottom) / 2 < y).length;
      const expected = others.map((block) => block.key);
      expected.splice(slot, 0, dragged.key);
      if (!drop) {
        assert.deepEqual(band(model.projects), expected, `${dragged.name} at ${y}: null only where it already is`);
        continue;
      }
      drops++;
      const add = model.unorderedKeysByBand[dragged.pinned ? "pinned" : "other"];
      const moved = applySessionUiStateRequest(treeInput.uiState, {
        action: "move-project", projectKey: dragged.key, anchorKey: drop.anchorKey, position: drop.position, add,
      }, 0);
      const after = buildSessionTree({ ...treeInput, uiState: moved.state });
      assert.deepEqual(band(after.projects), expected, `${dragged.name} dropped at ${y}`);
      assert.deepEqual(otherBand(after.projects), otherBand(model.projects), "the other band stays as it was");
    }
  }
  assert.ok(drops > 20);
});

test("group blocks run from each header to the bottom of its spacer", () => {
  const sessions = [
    session("pin", { project: "/work/alpha", modified: BASE + 9 * DAY }),
    ...Array.from({ length: 8 }, (_, index) => session(`a${index}`, { project: "/work/alpha", modified: BASE + index })),
    session("b1", { project: "/work/beta" }),
  ];
  const model = buildSessionTree(input({
    sessions,
    uiState: uiState({ sessions: { pin: { pinnedAt: 1 } }, projects: { "/work/gamma": pinnedProject(1, "/work/gamma") } }),
    groupExpansion: { "/work/alpha": true },
  }));
  assert.deepEqual(describeRows(model.rows), [
    "pinned:1", "pinned:pin", "-",
    "group:gamma", "empty", "-",
    "group:alpha", "group:a7", "group:a6", "group:a5", "group:a4", "group:a3", "group:a2", "more:2", "-",
    "group:beta (collapsed)", "-",
    "footer-open",
  ]);
  const offsets = getRowOffsets(model.rows, "desktop");
  assert.deepEqual(groupBlocks(model.rows, offsets), [
    { key: "/work/gamma", pinned: true, top: 66, bottom: 132 },
    { key: "/work/alpha", pinned: false, top: 132, bottom: 386 },
    { key: "/work/beta", pinned: false, top: 386, bottom: 422 },
  ]);
  assert.deepEqual(groupBlocks([], [0]), []);
});

test("a drop target stays in the dragged group's band and is null where the group already is", () => {
  const blocks = [
    { key: "P1", pinned: true, top: 0, bottom: 36 },
    { key: "P2", pinned: true, top: 36, bottom: 72 },
    { key: "A", pinned: false, top: 72, bottom: 150 },
    { key: "B", pinned: false, top: 150, bottom: 186 },
    { key: "C", pinned: false, top: 186, bottom: 300 },
  ];
  assert.equal(groupDropAt(blocks, "A", 100), null, "over itself");
  assert.equal(groupDropAt(blocks, "A", 10), null, "above the band is its top, where A is");
  assert.deepEqual(groupDropAt(blocks, "B", 10), { anchorKey: "A", position: "before", lineY: 68 }, "the pinned section maps to the band's top");
  assert.deepEqual(groupDropAt(blocks, "A", 1000), { anchorKey: "C", position: "after", lineY: 296 }, "the footer maps to its bottom");
  assert.deepEqual(groupDropAt(blocks, "A", 170), { anchorKey: "B", position: "after", lineY: 182 });
  assert.equal(groupDropAt(blocks, "A", 167), null, "not yet past B's middle");
  assert.deepEqual(groupDropAt(blocks, "C", 160), { anchorKey: "A", position: "after", lineY: 146 });
  assert.deepEqual(groupDropAt(blocks, "C", 0), { anchorKey: "A", position: "before", lineY: 68 });
  assert.deepEqual(groupDropAt(blocks, "P1", 500), { anchorKey: "P2", position: "after", lineY: 68 }, "never into the other band");
  assert.deepEqual(groupDropAt(blocks, "P2", -50), { anchorKey: "P1", position: "before", lineY: 3 }, "the line and its 6px dot stay on the list");
  assert.equal(groupDropAt(blocks, "P2", 500), null);
  assert.equal(groupDropAt(blocks.slice(1), "P2", 500), null, "alone in its band");
  assert.equal(groupDropAt(blocks, "missing", 10), null);
});

test("Move up and Move down swap with the neighbour in the band, and stop at its edges", () => {
  const projects = [
    { key: "P1", pinned: true }, { key: "P2", pinned: true },
    { key: "A", pinned: false }, { key: "B", pinned: false }, { key: "C", pinned: false },
  ];
  assert.equal(adjacentProjectMove(projects, "P1", "up"), null);
  assert.deepEqual(adjacentProjectMove(projects, "P1", "down"), { anchorKey: "P2", position: "after" });
  assert.equal(adjacentProjectMove(projects, "P2", "down"), null, "the pinned band ends here");
  assert.equal(adjacentProjectMove(projects, "A", "up"), null, "the others start here");
  assert.deepEqual(adjacentProjectMove(projects, "B", "up"), { anchorKey: "A", position: "before" });
  assert.deepEqual(adjacentProjectMove(projects, "B", "down"), { anchorKey: "C", position: "after" });
  assert.equal(adjacentProjectMove(projects, "C", "down"), null);
  assert.equal(adjacentProjectMove(projects, "missing", "up"), null);
});

test("auto-scroll speeds up toward an edge and is still in the middle", () => {
  assert.equal(autoScrollDelta(300, 100, 500, 32, 14), 0);
  assert.equal(autoScrollDelta(132, 100, 500, 32, 14), 0, "the band's inner edge");
  assert.equal(autoScrollDelta(120, 100, 500, 32, 14), -6);
  assert.equal(autoScrollDelta(100, 100, 500, 32, 14), -14);
  assert.equal(autoScrollDelta(20, 100, 500, 32, 14), -14, "full speed above the list");
  assert.equal(autoScrollDelta(480, 100, 500, 32, 14), 6);
  assert.equal(autoScrollDelta(900, 100, 500, 32, 14), 14, "full speed below it");
  assert.equal(autoScrollDelta(20, 0, 40, 32, 14), 0, "a short list's bands share its middle");
  assert.equal(autoScrollDelta(1, 0, 40, 32, 14), -14);
  assert.equal(autoScrollDelta(Number.NaN, 100, 500, 32, 14), 0);
  assert.equal(autoScrollDelta(120, 100, 100, 32, 14), 0, "no box");
});

test("the drag ghost follows the pointer and moves only to keep clear of it and of the drop line", () => {
  // A list visible from 100 to 500, a 22px ghost, 8px from the line.
  const place = (pointerY, lineY, pointerGap = 8) => ghostTopFor({ pointerY, lineY, ghostHeight: 22, pointerGap, lineGap: 8, minTop: 100, maxTop: 478 });
  assert.equal(place(300, null), 270, "no drop target: its bottom 8px above the pointer");
  assert.equal(place(300, 310), 270, "a line below the pointer is never in the way above it");
  // A line far from the pointer, above or below, leaves the ghost by the pointer.
  for (const lineY of [110, 150, 230, 400, 470]) assert.equal(place(300, lineY), 270, `line at ${lineY}`);
  for (let pointerY = 170; pointerY <= 300; pointerY += 10) {
    assert.equal(place(pointerY, 132), pointerY - 30, `pointer at ${pointerY}, the line well above it`);
  }
  // A line just above the pointer: above the line, the nearest top clear of it.
  assert.equal(place(300, 290), 260);
  assert.equal(place(140, 132), 102, "as close above the line as it gets");
  assert.equal(place(300, 290, 28), 250, "a finger's larger gap already clears it");
  assert.equal(place(300, 260, 28), 230);
  // Near the top there is no room above: below the pointer, and below a line just under it.
  assert.equal(place(120, 104), 128, "below the pointer");
  assert.equal(place(110, 126), 134, "below the line just under the pointer");
  assert.equal(place(130, 100), 138, "no room above a line at the very top");
  assert.equal(place(130, null), 100, "exactly enough room above");
  assert.equal(place(129, null), 137);
  // A line scrolled out of view cannot be covered: the pointer alone counts.
  assert.equal(place(150, 60), 120, "a line above the visible top");
  assert.equal(place(450, 560), 420, "a line below the visible bottom");
  // Kept in the list: a pointer past either end of it.
  assert.equal(place(620, null), 478, "the pointer past the bottom");
  assert.equal(place(490, 497), 460, "a line at the bottom still has the ghost above it");
  assert.equal(place(80, 103), 111, "the pointer over the pinned section: under the band's first line");
  assert.equal(place(40, null), 100, "the pointer above the list");
});

test("the drag ghost uses the room beside the pointer before covering anything", () => {
  const place = (pointerY, lineY, minTop, maxTop) => ghostTopFor({ pointerY, lineY, ghostHeight: 22, pointerGap: 8, lineGap: 8, minTop, maxTop });
  // A short list (100..320) and a tall block: below the pointer, far from the line at its bottom.
  assert.equal(place(110, 300, 100, 298), 118);
  // The pointer near the bottom, the line near the top (a block past "show more"): above the pointer.
  assert.equal(place(790, 110, 100, 778), 760);
  // Too short for both: over the pointer rather than the line.
  assert.equal(place(105, 140, 100, 130), 100);
  // Nothing in the list clear of the line: kept in it, by the pointer.
  assert.equal(place(105, 112, 100, 110), 100);
  assert.equal(place(105, null, 100, 90), 100, "a list shorter than the ghost keeps its top");
});
