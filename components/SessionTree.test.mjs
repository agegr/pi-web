import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { SessionTree, sessionRowTitle } = await jiti.import("./SessionTree.tsx");
const { buildSessionTree, SIDEBAR_ROW_HEIGHTS } = await jiti.import("@/lib/session-tree.ts");
const source = await readFile(new URL("./SessionTree.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/sidebar.css", import.meta.url), "utf8");

const h = React.createElement;
const MINUTE = 60_000;
const NOW = Date.now();

function decode(html) {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, "\n");
}

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
  assert.ok(match, `${selector} rule not found`);
  return match[1];
}

const noop = () => {};
const defaults = {
  rows: [],
  layout: "desktop",
  emptyLabel: null,
  loading: false,
  error: null,
  renamingRootId: null,
  confirmDeleteRootId: null,
  activeMenuRowKey: null,
  onSelectFamily: noop,
  onToggleGroup: noop,
  onShowMore: noop,
  onShowLess: noop,
  onTogglePinned: noop,
  onArchiveFamily: noop,
  onRestoreFamily: noop,
  onOpenRowMenu: noop,
  onRowContextMenu: noop,
  onRenameCommit: noop,
  onRenameCancel: noop,
  onDeleteConfirm: noop,
  onDeleteCancel: noop,
  onGroupNew: noop,
  onGroupMenu: noop,
  onOpenOtherProject: noop,
  onOpenArchive: noop,
};

function render(props) {
  return decode(renderToStaticMarkup(h(I18nProvider, null, h(SessionTree, { ...defaults, ...props }))));
}

/** The markup of one rendered row, from its opening tag to the next row. */
function rowMarkup(html, key) {
  const part = html.split(/(?=<div class="session-tree-row )/).find((chunk) => chunk.includes(`data-row-key="${key}"`));
  assert.ok(part, `row ${key} not rendered`);
  return part;
}

function renderedKeys(html) {
  return [...html.matchAll(/data-row-key="([^"]+)"/g)].map((match) => match[1]);
}

function session(id, extra = {}) {
  const modified = new Date(NOW - 5 * MINUTE).toISOString();
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/work/app",
    projectRoot: "/work/app",
    projectKey: "/work/app",
    created: modified,
    modified,
    messageCount: 3,
    firstMessage: `first ${id}`,
    ...extra,
  };
}

const project = { key: "/work/app", root: "/work/app", name: "app", pinned: false, current: true };

function sessionRow(root, { context = "group", status = {}, rowProject = project } = {}) {
  return {
    kind: "session",
    key: `session:${context}:${root.id}`,
    family: { root, subagents: [], latestModified: root.modified },
    context,
    project: rowProject,
    status: { running: false, awaiting: false, unread: false, selected: false, transient: false, ...status },
  };
}

function groupRow(extra = {}, projectExtra = {}) {
  const groupProject = { ...project, ...projectExtra };
  return { kind: "group", key: `group:${groupProject.key}`, project: groupProject, expanded: true, running: 0, awaiting: 0, unread: 0, ...extra };
}

const footer = [{ kind: "footer-open", key: "footer-open" }];

test("the pinned header toggles the section and shows activity dots only while collapsed", () => {
  const collapsed = rowMarkup(render({
    rows: [{ kind: "pinned-header", key: "pinned-header", count: 3, collapsed: true, running: 1, awaiting: 0, unread: 2 }],
  }), "pinned-header");
  // A group header's height: both are section headers.
  assert.match(collapsed, /^<div class="session-tree-row session-tree-pinned-header" style="top:0;height:28px" data-row-key="pinned-header">/);
  assert.match(collapsed, /<button type="button" class="session-tree-pinned-toggle" aria-expanded="false">/);
  // Its chevron leads, in the chevron column, decoration only; no pin icon.
  assert.match(collapsed, /aria-expanded="false"><svg width="12" height="12"[^>]*stroke-width="3"[^>]*class="session-tree-chevron" aria-hidden="true">[\s\S]*?<\/svg><span class="session-tree-pinned-label">Pinned<\/span><span class="session-tree-pinned-count">· 3<\/span><span class="session-tree-pinned-dot is-running"/);
  assert.doesNotMatch(collapsed, /session-tree-group-icon/);
  assert.match(collapsed, /class="session-tree-pinned-dot is-running" role="img" title="Agent running…" aria-label="Agent running… \(1\)"/);
  assert.match(collapsed, /class="session-tree-pinned-dot is-unread" role="img" title="New session activity" aria-label="New session activity \(2\)"/);
  assert.doesNotMatch(collapsed, /session-tree-pinned-dot is-awaiting/);
  assert.doesNotMatch(collapsed, /session-tree-chevron is-open/);

  const expanded = rowMarkup(render({
    rows: [{ kind: "pinned-header", key: "pinned-header", count: 3, collapsed: false, running: 1, awaiting: 1, unread: 2 }],
  }), "pinned-header");
  assert.match(expanded, /aria-expanded="true"/);
  assert.match(expanded, /session-tree-chevron is-open/);
  assert.doesNotMatch(expanded, /session-tree-pinned-dot/);
});

test("a collapsed pinned header shows an awaiting dot of its own, without the running one", () => {
  const collapsed = rowMarkup(render({
    rows: [{ kind: "pinned-header", key: "pinned-header", count: 2, collapsed: true, running: 0, awaiting: 2, unread: 0 }],
  }), "pinned-header");
  assert.match(collapsed, /class="session-tree-pinned-dot is-awaiting" role="img" title="Agent waiting for your input" aria-label="Agent waiting for your input \(2\)"/);
  assert.doesNotMatch(collapsed, /session-tree-pinned-dot is-running/);
});

test("a collapsed group shows awaiting families apart from running ones", () => {
  const mixed = rowMarkup(render({ rows: [groupRow({ expanded: false, running: 1, awaiting: 2, unread: 0 })] }), "group:/work/app");
  assert.match(mixed, /aria-label="Agent running… \(1\)"/);
  assert.match(mixed, /<span class="session-tree-summary-awaiting" role="img" title="Agent waiting for your input" aria-label="Agent waiting for your input \(2\)"><span class="session-tree-summary-dot is-awaiting"><\/span>2<\/span>/);

  // Only awaiting: the amber count, no spinner.
  const awaiting = rowMarkup(render({ rows: [groupRow({ expanded: false, running: 0, awaiting: 1, unread: 0 })] }), "group:/work/app");
  assert.match(awaiting, /session-tree-summary-awaiting/);
  assert.doesNotMatch(awaiting, /session-tree-summary-running/);
  assert.doesNotMatch(awaiting, /sidebar-spin/);
});

test("a collapsed group shows its running and unread counts and labelled actions", () => {
  const html = rowMarkup(render({
    rows: [groupRow({ expanded: false, running: 2, unread: 1 }, { pinned: true, current: false })],
  }), "group:/work/app");
  assert.match(html, /^<div class="session-tree-row session-tree-group" style="top:0;height:28px"/);
  assert.match(html, /<button type="button" class="session-tree-group-toggle" aria-expanded="false" title="\/work\/app">/);
  // The chevron leads, inside the toggle (the whole header still toggles)
  // and hidden from its accessible name; then the name, its pin, the summary.
  assert.match(html, /title="\/work\/app"><svg width="12" height="12"[^>]*stroke-width="3"[^>]*class="session-tree-chevron" aria-hidden="true"><path[^>]*><\/path><\/svg><span class="session-tree-group-name">app<\/span>/, "the chevron precedes the name");
  assert.match(html, /<span class="session-tree-group-name">app<\/span><svg[^>]*class="session-tree-group-pin"[\s\S]*?<\/svg><span class="session-tree-summary">/);
  // No folder: a project group is no second file tree.
  assert.doesNotMatch(html, /session-tree-group-icon/);
  assert.match(html, /<svg[^>]*class="session-tree-group-pin" role="img" aria-label="Pinned"/);
  assert.match(html, /aria-label="Agent running… \(2\)"/);
  assert.match(html, /aria-label="New session activity \(1\)"/);
  assert.match(html, /aria-label="New session in app" title="New session in app"/);
  assert.match(html, /aria-label="app actions" title="app actions" aria-haspopup="menu" aria-expanded="false"/);

  const expanded = rowMarkup(render({ rows: [groupRow({ expanded: true, running: 2, unread: 1 })] }), "group:/work/app");
  assert.match(expanded, /session-tree-group is-current/);
  assert.match(expanded, /aria-expanded="true" title="\/work\/app"/);
  assert.doesNotMatch(expanded, /session-tree-summary/);
  assert.doesNotMatch(expanded, /session-tree-group-pin/);
});

test("a group's ⋯ shows its open menu; its + starts a session at once", () => {
  const more = rowMarkup(render({ rows: [groupRow()], activeMenuRowKey: "group:/work/app" }), "group:/work/app");
  assert.match(more, /session-tree-group is-current is-active/);
  assert.match(more, /class="session-tree-group-action is-active" aria-label="app actions"[^>]*aria-expanded="true"/);

  // The + opens nothing and never waits: no popup, busy or disabled state.
  const plus = rowMarkup(render({ rows: [groupRow()] }), "group:/work/app").match(/<button[^>]*aria-label="New session in app"[^>]*>/)[0];
  assert.equal(plus, '<button type="button" class="session-tree-group-action" aria-label="New session in app" title="New session in app">');
});

test("an idle session row shows its short time, branch and both actions", () => {
  const root = session("idle", { isWorktree: true, branch: "feat/rows" });
  const html = rowMarkup(render({ rows: [sessionRow(root)] }), "session:group:idle");
  assert.match(html, /^<div class="session-tree-row session-tree-session" style="top:0;height:28px" data-row-key="session:group:idle">/);
  // Nothing before the title: it gets the room; the time sits at the right.
  // A saved session's title is a real link to it (middle-click, Ctrl/Cmd-click).
  // The branch keeps the upstream icon and type; the tooltip keeps the ⑂ glyph.
  assert.match(html, /<a class="session-tree-main" href="\?session=idle" title="[^"]*"><span class="session-tree-title">first idle<\/span><span class="session-tree-branch"><svg width="10" height="10"[^>]*class="session-tree-branch-icon" aria-hidden="true">[\s\S]*?<\/svg>feat\/rows<\/span><span class="session-tree-meta">5m<\/span><\/a>/);
  assert.match(html, /title="first idle\n3 msgs · 5 minutes ago · ⑂ feat\/rows"/);
  assert.match(html, /class="session-tree-action session-tree-quick-action" aria-label="Archive" title="Archive"/);
  assert.match(html, /class="session-tree-action session-tree-more-action" aria-label="More actions" title="More actions" aria-haspopup="menu" aria-expanded="false"/);
  assert.doesNotMatch(html, /aria-current/);
});

test("a branch chip needs a linked worktree", () => {
  const html = render({ rows: [sessionRow(session("main", { branch: "main" }))] });
  assert.doesNotMatch(html, /session-tree-branch/);
  assert.doesNotMatch(html, /⑂/);
});

test("a fork's row keeps its name's suffix in view; other titles stay one span", () => {
  const fork = { kind: "fork", originSessionId: "src" };
  const named = rowMarkup(render({ rows: [sessionRow(session("copy", { name: "PR#1030 状态栏命令按钮 · 3f9a", relation: fork }))] }), "session:group:copy");
  assert.match(named, /<span class="session-tree-title has-fork-suffix"><span class="session-tree-title-base">PR#1030 状态栏命令按钮<\/span><span class="session-tree-title-suffix"> · 3f9a<\/span><\/span><span class="session-tree-meta">/);
  assert.match(named, /title="PR#1030 状态栏命令按钮 · 3f9a\n/, "the tooltip has the whole name");
  // Not a fork, no suffix, or no name: the title is cut as a whole.
  for (const extra of [
    { name: "Weekly sync · 2024" },
    { name: "Plan · beta", relation: fork },
    { firstMessage: "ask · 3f9a", relation: fork },
  ]) {
    const html = render({ rows: [sessionRow(session("other", extra))] });
    assert.doesNotMatch(html, /has-fork-suffix|session-tree-title-(base|suffix)/);
    assert.match(html, /<span class="session-tree-title">[^<]+<\/span>/);
  }
});

test("a running row shows the labelled spinner and cannot be archived from the row", () => {
  const html = rowMarkup(render({ rows: [sessionRow(session("run"), { status: { running: true, unread: true } })] }), "session:group:run");
  // The spinner takes the time's place at the right, and the row says it is running.
  assert.match(html, /class="session-tree-row session-tree-session is-running"/);
  assert.match(html, /<span class="session-tree-title">first run<\/span><span class="session-tree-meta is-running" title="Agent running…"><svg[^>]*class="sidebar-spin" role="img" aria-label="Agent running…"/);
  assert.doesNotMatch(html, /session-tree-slot/);
  assert.doesNotMatch(html, /session-tree-unread/);
  assert.doesNotMatch(html, /aria-label="Archive"/);
  assert.match(html, /aria-label="More actions"/);
});

test("an unread row shows the labelled unread dot", () => {
  const html = rowMarkup(render({ rows: [sessionRow(session("new"), { status: { unread: true } })] }), "session:group:new");
  assert.match(html, /<span class="session-tree-meta is-unread" title="New activity"><span class="session-tree-unread" role="img" aria-label="New session activity"><\/span><\/span>/);
});

test("an awaiting row shows the amber dot in the spinner's slot", () => {
  const html = rowMarkup(render({
    rows: [sessionRow(session("ask"), { status: { running: true, awaiting: true, unread: true } })],
  }), "session:group:ask");
  // Awaiting wins the slot (it is the one thing worth knowing), and the row is
  // still the running row it is: same class, same actions, no archive button.
  assert.match(html, /class="session-tree-row session-tree-session is-running"/);
  assert.match(html, /<span class="session-tree-title">first ask<\/span><span class="session-tree-meta is-awaiting" title="Agent waiting for your input"><span class="session-tree-awaiting" role="img" aria-label="Agent waiting for your input"><\/span><\/span>/);
  assert.doesNotMatch(html, /sidebar-spin/);
  assert.doesNotMatch(html, /session-tree-unread/);
  assert.doesNotMatch(html, /aria-label="Archive"/);
  assert.match(html, /aria-label="More actions"/);
});

test("the selected row is marked and its menu button reports an open menu", () => {
  const row = sessionRow(session("sel"), { status: { selected: true } });
  const html = rowMarkup(render({ rows: [row], activeMenuRowKey: row.key }), row.key);
  assert.match(html, /class="session-tree-row session-tree-session is-selected is-menu-open"/);
  assert.match(html, /<a class="session-tree-main" href="\?session=sel" title="[^"]*" aria-current="true">/);
  assert.match(html, /class="session-tree-action session-tree-more-action is-active"[^>]*aria-expanded="true"/);
});

test("a transient row offers no actions at all", () => {
  const html = rowMarkup(render({ rows: [sessionRow(session("tmp"), { status: { transient: true } })] }), "session:group:tmp");
  assert.doesNotMatch(html, /session-tree-actions/);
  assert.doesNotMatch(html, /More actions/);
  assert.doesNotMatch(html, /aria-label="Archive"/);
  assert.match(html, /session-tree-title">first tmp</);
  // No file yet, so no link another tab could not load: still a button.
  assert.match(html, /<button type="button" class="session-tree-main" title="[^"]*"><span class="session-tree-title">first tmp<\/span>/);
  assert.doesNotMatch(html, /<a |href=/);
  const selected = rowMarkup(render({ rows: [sessionRow(session("tmp"), { status: { transient: true, selected: true } })] }), "session:group:tmp");
  assert.match(selected, /<button type="button" class="session-tree-main" title="[^"]*" aria-current="true">/);
});

test("every saved row's title links to its session, encoded, in every context and state", () => {
  const cases = [
    [sessionRow(session("a/b?c&d #%")), "?session=a%2Fb%3Fc%26d%20%23%25"],
    [sessionRow(session("pin"), { context: "pinned" }), "?session=pin"],
    [sessionRow(session("old"), { context: "archive" }), "?session=old"],
    [sessionRow(session("run"), { status: { running: true } }), "?session=run"],
    [sessionRow(session("ask"), { status: { running: true, awaiting: true } }), "?session=ask"],
    [sessionRow(session("new"), { status: { unread: true } }), "?session=new"],
  ];
  for (const [row, href] of cases) {
    const html = rowMarkup(render({ rows: [row] }), row.key);
    const link = html.match(/<a [^>]*>/)?.[0] ?? "";
    assert.equal(link.match(/href="([^"]*)"/)?.[1], href, row.key);
    assert.match(link, /^<a class="session-tree-main" href=/, row.key);
    // Never target: a plain click would leave this tab too.
    assert.doesNotMatch(link, /target=|rel=/, row.key);
    // The link holds the title, branch and meta only; the row's buttons stay outside it.
    const inside = html.slice(html.indexOf(link), html.indexOf("</a>"));
    assert.doesNotMatch(inside, /<button|<a [\s\S]*<a /, `${row.key}: no control nested in the link`);
    assert.match(html, /<\/a>(<span class="session-tree-actions">|<\/div>)/, row.key);
  }
  // A fork's two-span title sits inside the link the same way.
  const fork = rowMarkup(render({ rows: [sessionRow(session("copy", { name: "Plan · 3f9a", relation: { kind: "fork", originSessionId: "src" } }))] }), "session:group:copy");
  assert.match(fork, /<a class="session-tree-main" href="\?session=copy" title="[^"]*"><span class="session-tree-title has-fork-suffix">/);
  // Rename and delete-confirm rows have no link.
  assert.doesNotMatch(rowMarkup(render({ rows: [sessionRow(session("r"))], renamingRootId: "r" }), "session:group:r"), /<a /);
  assert.doesNotMatch(rowMarkup(render({ rows: [sessionRow(session("d"))], confirmDeleteRootId: "d" }), "session:group:d"), /<a /);
});

test("pinned rows name their project and archived rows offer restore with the family's time", () => {
  const pinned = rowMarkup(render({ rows: [sessionRow(session("pin"), { context: "pinned" })] }), "session:pinned:pin");
  assert.match(pinned, /<span class="session-tree-meta"><span class="session-tree-project">app<\/span><\/span>/);
  assert.match(pinned, /aria-label="Archive"/);

  // Never the archive time: a session whose last message was two hours ago
  // says 2h however recently it was archived (#1351).
  const archived = rowMarkup(render({
    rows: [sessionRow(session("old", { modified: new Date(NOW - 2 * 60 * MINUTE).toISOString() }), { context: "archive" })],
  }), "session:archive:old");
  assert.match(archived, /class="session-tree-row session-tree-session is-archived"/);
  assert.doesNotMatch(archived, /session-tree-slot/);
  assert.match(archived, /<span class="session-tree-meta">2h<\/span>/);
  assert.match(archived, /aria-label="Restore" title="Restore"/);
  assert.doesNotMatch(archived, /aria-label="Archive"/);
});

test("the phone layout uses tall rows, keeps ⋯ and drops the archive quick button", () => {
  const html = render({ layout: "mobile", rows: [groupRow(), sessionRow(session("m"))] });
  assert.match(html, /^<div class="session-tree is-mobile">/);
  assert.match(rowMarkup(html, "group:/work/app"), /style="top:0;height:44px"/);
  const row = rowMarkup(html, "session:group:m");
  assert.match(row, /style="top:44px;height:44px"/);
  assert.match(row, /aria-label="More actions"/);
  assert.doesNotMatch(row, /aria-label="Archive"/);
});

test("a summary row without details shows an ellipsis instead of a message count", () => {
  const html = render({ rows: [sessionRow(session("p", { detailsPending: true, name: "Named" }))] });
  assert.match(html, /title="Named\n… · 5 minutes ago"/);
});

test("rename mode swaps the row for a field seeded with the title", () => {
  const html = rowMarkup(render({ rows: [sessionRow(session("r", { name: "Old name" }))], renamingRootId: "r" }), "session:group:r");
  assert.match(html, /class="session-tree-row session-tree-session is-renaming"/);
  assert.match(html, /<input class="session-tree-rename" aria-label="Rename" value="Old name"\/>/);
  assert.doesNotMatch(html, /session-tree-actions/);
});

test("a named project shows its name as plain text in its header, the path as the tooltip", () => {
  const named = { name: "Thermal <b>Models</b>", customName: "Thermal <b>Models</b>" };
  const raw = renderToStaticMarkup(h(I18nProvider, null, h(SessionTree, { ...defaults, rows: [groupRow({}, named)] })));
  assert.match(raw, /title="\/work\/app"><svg[^>]*class="session-tree-chevron is-open"[\s\S]*?<\/svg><span class="session-tree-group-name">Thermal &lt;b&gt;Models&lt;\/b&gt;<\/span>/);
  assert.doesNotMatch(raw, /<b>/, "never markup");
  const html = render({ rows: [groupRow({}, named)] });
  assert.match(html, /aria-label="New session in Thermal <b>Models<\/b>"/);
  assert.match(html, /aria-label="Thermal <b>Models<\/b> actions"/);
});

test("a project's rename swaps its header for a name field seeded with the name shown", () => {
  const html = rowMarkup(render({ rows: [groupRow({}, { name: "Thermal Models", customName: "Thermal Models" })], renamingProjectKey: "/work/app" }), "group:/work/app");
  assert.match(html, /^<div class="session-tree-row session-tree-group is-current is-renaming" style="top:0;height:28px" data-row-key="group:\/work\/app">/);
  assert.match(html, /<input class="session-tree-rename" aria-label="Project name" maxLength="80" value="Thermal Models"\/>/);
  assert.doesNotMatch(html, /session-tree-group-toggle|session-tree-group-actions/);
  // Another group, or none being renamed: the header as usual.
  assert.match(rowMarkup(render({ rows: [groupRow()], renamingProjectKey: "/elsewhere" }), "group:/work/app"), /session-tree-group-toggle/);
});

test("delete confirmation shows a shortened title and both answers", () => {
  const html = rowMarkup(render({
    rows: [sessionRow(session("d", { name: "A very long session title that keeps going" }))],
    confirmDeleteRootId: "d",
  }), "session:group:d");
  assert.match(html, /class="session-tree-row session-tree-session is-confirming"/);
  assert.match(html, /<span class="session-tree-confirm-text">Delete A very long session ti…\?<\/span>/);
  assert.match(html, /<button type="button" class="session-tree-confirm-delete"><svg[^>]*><path[\s\S]*?<\/svg>Delete<\/button>/);
  assert.match(html, /<button type="button" class="session-tree-confirm-cancel">Cancel<\/button>/);
  assert.doesNotMatch(html, /More actions/);
});

test("show more, empty groups, footer links and archive groups", () => {
  const html = render({
    rows: [
      { kind: "pinned-more", key: "pinned-more", hidden: 0, canShowLess: true },
      { kind: "group-more", key: "more:/work/app", projectKey: "/work/app", hidden: 3, canShowLess: false },
      { kind: "group-more", key: "more:/work/big", projectKey: "/work/big", hidden: 24, canShowLess: true },
      { kind: "group-empty", key: "empty:/work/app", project },
      { kind: "spacer", key: "footer-spacer" },
      { kind: "archive-group", key: "archive:/work/app", project, count: 2, expanded: true },
      { kind: "archive-group", key: "archive:/work/old", project: { ...project, key: "/work/old", root: "/work/old", name: "old" }, count: 5, expanded: false },
      { kind: "footer-open", key: "footer-open" },
      { kind: "footer-archived", key: "footer-archived", count: 4 },
    ],
  });
  assert.match(rowMarkup(html, "pinned-more"), /<button type="button" class="session-tree-more-toggle" data-more-action="less">Show less<\/button><\/div>/);
  assert.doesNotMatch(rowMarkup(html, "pinned-more"), /data-more-action="more"/);
  assert.match(rowMarkup(html, "more:/work/app"), /<button type="button" class="session-tree-more-toggle" data-more-action="more">Show more · 3<\/button><\/div>/);
  assert.doesNotMatch(rowMarkup(html, "more:/work/app"), /data-more-action="less"/);
  assert.match(
    rowMarkup(html, "more:/work/big"),
    /data-more-action="more">Show more · 24<\/button><button type="button" class="session-tree-more-toggle" data-more-action="less">Show less<\/button>/,
  );
  assert.match(rowMarkup(html, "empty:/work/app"), /style="top:78px;height:28px" data-row-key="empty:\/work\/app">No sessions yet<\/div>/);
  assert.doesNotMatch(html, /footer-spacer/);
  // The archive's project header is a group header that folds its rows: the
  // chevron, the name, the count; ⋯ for its archived sessions, no "+".
  const archiveHeader = rowMarkup(html, "archive:/work/app");
  assert.match(archiveHeader, /class="session-tree-row session-tree-group session-tree-archive-group is-current"/);
  assert.match(archiveHeader, /<button type="button" class="session-tree-group-toggle" aria-expanded="true" title="\/work\/app"><svg[^>]*class="session-tree-chevron is-open"[\s\S]*?<span class="session-tree-group-name">app<\/span><span class="session-tree-archive-group-count">· 2<\/span><\/button>/);
  assert.match(archiveHeader, /aria-label="Archived sessions of app"[^>]*aria-haspopup="menu" aria-expanded="false"/);
  assert.doesNotMatch(archiveHeader, /New session/);
  assert.match(rowMarkup(html, "archive:/work/old"), /aria-expanded="false" title="\/work\/old"><svg[^>]*class="session-tree-chevron"/);
  assert.match(rowMarkup(html, "footer-open"), /<button type="button" class="session-tree-footer-button"><svg[^>]*>[\s\S]*?<\/svg><span class="session-tree-footer-label">Open another project…<\/span><\/button>/);
  assert.match(rowMarkup(html, "footer-archived"), /<span class="session-tree-footer-label">Archived · 4<\/span><svg[^>]*class="session-tree-footer-chevron"/);
});

test("loading replaces the rows; the empty label shows only without session or group rows", () => {
  const loading = render({ loading: true, rows: [groupRow(), ...footer], emptyLabel: "No sessions found" });
  assert.match(loading, /<div class="session-tree-message">Loading...<\/div>/);
  assert.deepEqual(renderedKeys(loading), []);
  assert.doesNotMatch(loading, /No sessions found/);

  const empty = render({ rows: footer, emptyLabel: "No sessions found" });
  assert.match(empty, /<div class="session-tree-message">No sessions found<\/div><div class="session-tree-scroll scrollbar-subtle">/);
  assert.deepEqual(renderedKeys(empty), ["footer-open"]);

  assert.doesNotMatch(render({ rows: [groupRow(), ...footer], emptyLabel: "No sessions found" }), /No sessions found/);
  assert.doesNotMatch(render({ rows: footer, emptyLabel: null }), /session-tree-message/);

  const failed = render({ rows: footer, emptyLabel: "No sessions found", error: "HTTP 500" });
  assert.match(failed, /<div class="session-tree-message is-error">HTTP 500<\/div>/);
  assert.doesNotMatch(failed, /No sessions found/);
});

test("only rows near the viewport are mounted, plus the ones that must stay", () => {
  const rows = Array.from({ length: 200 }, (_, index) => sessionRow(session(`s${index}`)));
  const plain = render({ rows });
  assert.match(plain, /<div class="session-tree-inner" style="height:5600px">/);
  const keys = renderedKeys(plain);
  // An unmeasured viewport counts as 600px, plus 240px of overscan below.
  assert.equal(keys.length, Math.ceil((600 + 240) / 28));
  assert.equal(keys[0], "session:group:s0");

  const kept = renderedKeys(render({
    rows,
    activeMenuRowKey: "session:group:s150",
    renamingRootId: "s120",
    confirmDeleteRootId: "s180",
  }));
  assert.deepEqual(kept.slice(-3), ["session:group:s120", "session:group:s150", "session:group:s180"]);
  assert.match(render({ rows, renamingRootId: "s120" }), /style="top:3360px;height:28px" data-row-key="session:group:s120"/);
});

test("a reveal request keeps its row mounted", () => {
  const rows = Array.from({ length: 200 }, (_, index) => sessionRow(session(`s${index}`)));
  const at = Date.now();
  // Mounted before the scroll, so focus can go to it in the commit that scrolls.
  const kept = renderedKeys(render({ rows, reveal: { id: 1, at, rowKey: "session:group:s150" } }));
  assert.equal(kept.at(-1), "session:group:s150");
  assert.deepEqual(renderedKeys(render({ rows, reveal: { id: 1, at, rowKey: "group:missing" } })), renderedKeys(render({ rows })));
});

test("renders the model built from a catalog with unique row keys", () => {
  const sessions = [
    session("a", { modified: new Date(NOW - MINUTE).toISOString() }),
    session("b", { cwd: "/work/other", projectRoot: "/work/other", projectKey: "/work/other" }),
    session("sub", { relation: { kind: "subagent", parentSessionId: "a", profile: "x", description: "", status: "running" } }),
  ];
  const model = buildSessionTree({
    sessions,
    uiState: { version: 1, revision: 0, sessions: { b: { pinnedAt: NOW } }, projects: {} },
    runningIds: new Set(["sub"]),
    unreadIds: new Set(),
    selectedSessionId: "a",
    currentProject: { key: "/work/app", root: "/work/app" },
    groupExpansion: {},
    moreShown: {},
    pinnedCollapsed: false,
  });
  const html = render({ rows: model.rows });
  const keys = renderedKeys(html);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(keys, ["pinned-header", "session:pinned:b", "group:/work/app", "session:group:a", "footer-open"]);
  const familyRow = rowMarkup(html, "session:group:a");
  assert.match(familyRow, /is-selected/);
  assert.match(familyRow, /aria-label="Agent running…"/);
  assert.match(rowMarkup(html, "session:pinned:b"), /<span class="session-tree-project">other<\/span>/);
});

test("row titles fall back from the name to the first message to the id", () => {
  assert.equal(sessionRowTitle(session("x", { name: "Named" })), "Named");
  assert.equal(sessionRowTitle(session("x", { firstMessage: "y".repeat(80) })), "y".repeat(50));
  assert.equal(sessionRowTitle(session("abcdefghijklmnop", { firstMessage: "" })), "abcdefghijkl");
  const skill = '<skill name="review" location="/skills/review/SKILL.md">\nReferences are relative to /skills/review.\n\nbody\n</skill>\n\nthe diff';
  assert.equal(sessionRowTitle(session("x", { firstMessage: skill })), "/skill:review the diff");
});

test("row CSS stays flat, themed and quiet", () => {
  assert.doesNotMatch(css, /&/, "no CSS nesting");
  assert.doesNotMatch(css, /@starting-style|prefers-color-scheme/);
  const colors = new Set((css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((color) => color.toLowerCase()));
  for (const color of colors) assert.ok(["#ef4444", "#0891b2", "#d97706", "#f87171", "#fff"].includes(color), `unexpected color ${color}`);
  // Three text colors: content, labels, meta (plus the accent for states,
  // the errors' red and the delete button's white). No mixes of their own.
  const textColors = new Set([...css.matchAll(/(?:^|[\s;{])color: ([^;]+);/g)].map((match) => match[1]));
  for (const color of textColors) {
    assert.ok(["var(--text)", "var(--text-muted)", "var(--text-dim)", "var(--accent)", "inherit", "#f87171", "#fff"].includes(color), `unexpected text color ${color}`);
  }
  assert.doesNotMatch(css, /color: color-mix\(in srgb, var\(--text\)/);
});

test("a row's controls fit its height with room to spare: 28px rows on a desktop, 44px on a phone", () => {
  /** The height of the first rule whose selector list starts with `selector`. */
  const heightOf = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp(`(?:^|\\n)${escaped}[^{]*\\{[^}]*?\\sheight: (\\d+)px;`));
    assert.ok(match, `${selector} has a height`);
    return Number(match[1]);
  };
  // A session row's ⋯ and archive, its rename field, its delete
  // confirmation's buttons; a group header's + and ⋯ (its rename field is
  // the session row's). At least 2px clear above and below.
  const desktop = SIDEBAR_ROW_HEIGHTS.desktop;
  for (const selector of [".session-tree-action", ".session-tree-rename", ".session-tree .session-tree-confirm-delete"]) {
    assert.ok(heightOf(selector) + 4 <= desktop.session, selector);
  }
  assert.ok(heightOf(".session-tree .session-tree-group-action") + 4 <= desktop.group);
  const mobile = SIDEBAR_ROW_HEIGHTS.mobile;
  for (const selector of [".session-tree.is-mobile .session-tree-more-action", ".session-tree.is-mobile .session-tree-group-action", ".session-tree.is-mobile .session-tree-rename", ".session-tree.is-mobile .session-tree-confirm-delete"]) {
    assert.ok(heightOf(selector) + 4 <= Math.min(mobile.session, mobile.group), selector);
  }
});

test("headers lead with their chevron, and every row's text starts in one column", () => {
  // The left inset is 6px in every browser, the grid the brand, the files'
  // header, the picker and the file tree keep; a classic scrollbar takes its
  // room from the right only.
  assert.match(cssRule(".session-tree-scroll"), /--session-tree-inset-left: 6px;\s*--session-tree-inset-right: max\(0px, calc\(6px - var\(--session-tree-scrollbar, 0px\)\)\);/);

  // The text column: the toggle's left padding, the 12px chevron and the
  // gap. Session titles, "show more", the empty group's note, the archive's
  // project names and the footer's labels (their 12px icons in the
  // chevron column) start there too. The last length of a padding
  // shorthand is its left side.
  const lastPx = (rule, property) => {
    const value = cssRule(rule).match(new RegExp(`(?:^|\\n)\\s*${property}: ([^;]+);`))[1];
    return Number(value.trim().split(/\s+/).at(-1).replace(/px\)?$/, ""));
  };
  const textStart = lastPx(".session-tree-group-toggle", "padding") + 12 + lastPx(".session-tree-group-toggle", "gap");
  assert.equal(textStart, 20);
  assert.equal(lastPx(".session-tree-session", "padding"), textStart);
  // A group header's toggle starts at the row's own left edge.
  assert.match(cssRule(".session-tree-group"), /padding: 0 4px 0 0;/);
  assert.equal(lastPx(".session-tree-footer-button", "padding") + 12 + lastPx(".session-tree-footer-button", "gap"), textStart);
  assert.deepEqual([...source.matchAll(/<(?:FolderPlus|Archive)Icon size=\{(\d+)\} \/>\s*<span className="session-tree-footer-label">/g)].map((match) => Number(match[1])), [12, 12]);
  // These rows span the whole width, so their padding adds the rows' inset.
  assert.match(css, /\.session-tree-group-empty,\s*\.session-tree-more \{\s*padding-left: calc\(var\(--session-tree-inset-left\) \+ 20px\);/);
  // The pinned section's chevron in the same column (its row spans the
  // whole width, a group's sits at the inset).
  assert.match(cssRule(".session-tree-pinned-toggle"), /padding: 0 8px 0 calc\(var\(--session-tree-inset-left\) \+ 5px\);/);

  // No layout overrides these paddings, so phones line up the same way.
  assert.doesNotMatch(css, /\.is-mobile \.session-tree-(?:session|group-toggle|group-empty|more|pinned-toggle|archive-group|footer-button) \{[^}]*padding/);
  // One rhythm: session rows, every header (a project's, the pinned
  // section's, the archive's projects), the empty note and the footer are
  // one height, 28px (44px on a phone); only "show more" is shorter.
  assert.deepEqual(SIDEBAR_ROW_HEIGHTS.desktop, { "pinned-header": 28, session: 28, "pinned-more": 26, group: 28, "group-more": 26, "group-empty": 28, spacer: 8, "footer-open": 28, "footer-archived": 28, "archive-group": 28 });
  for (const [layout, height] of [["desktop", 28], ["mobile", 44]]) {
    for (const kind of ["session", "group", "pinned-header", "group-empty", "footer-open", "footer-archived", "archive-group"]) {
      assert.equal(SIDEBAR_ROW_HEIGHTS[layout][kind], height, `${layout} ${kind}`);
    }
  }
});

test("group headers draw nothing for a drag while idle", () => {
  // Three groups (the spacers between them render nothing), then the footer.
  const rows = [
    groupRow({}, { key: "/work/a", name: "a", pinned: true }),
    groupRow({}, { key: "/work/b", name: "b" }),
    groupRow({}, { key: "/work/c", name: "c", current: false }),
    { kind: "spacer", key: "footer-spacer" },
    ...footer,
  ];
  const html = render({ rows, onMoveGroup: noop });
  assert.match(html, /^<div class="session-tree">/);
  assert.doesNotMatch(html, /session-tree-drag-|session-tree-drop-line|is-group-dragging|is-drag-armed/);
  // Headers keep their markup: the drag adds listeners, no attributes (and never draggable="true").
  assert.match(rowMarkup(html, "group:/work/b"), /^<div class="session-tree-row session-tree-group is-current" style="top:28px;height:28px" data-row-key="group:\/work\/b">/);
  assert.doesNotMatch(html, /draggable/);
});

test("SessionTree.tsx has no RegExp lookbehind (Safari 16.2)", () => {
  assert.doesNotMatch(source, /\(\?<[=!]/, "no RegExp lookbehind (Safari 16.2)");
});

test("the drag ghost is shorter than a header", () => {
  // The ghost is a one-line pill shorter than a header (useGroupDrag reads
  // its height to keep it clear of the pointer and the line).
  assert.match(cssRule(".session-tree-drag-ghost"), /\n\s*height: 22px;/);
  assert.ok(22 < SIDEBAR_ROW_HEIGHTS.desktop.group, "shorter than a header");
});
