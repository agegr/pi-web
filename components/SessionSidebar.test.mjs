import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { ARCHIVED_CHAT_PROJECT_ID, SessionSidebar, filterSessionsForChatProject, getFocusedSessionRowIndex, getSessionListIndices, getSessionRows, isSessionRowSelected } = await jiti.import("./SessionSidebar.tsx");
const { listSessionFamilies } = await jiti.import("../lib/session-family.ts");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("the default sidebar renders only the All chats and Archived chat folders", () => {
  const html = renderToStaticMarkup(createElement(
    I18nProvider,
    null,
    createElement(SessionSidebar, {
      selectedSessionId: null,
      onSelectSession: () => {},
    }),
  ));
  assert.match(html, />All chats</);
  assert.match(html, />Archived</);
  assert.doesNotMatch(html, /Product launch|Research notes|Bug triage/);
});

test("scrolling keeps the focused session and the viewport mounted without expanding the whole window", () => {
  for (const [scrollTop, focusedIndex] of [[0, 1999], [10000, 0]]) {
    const indices = getSessionListIndices(2000, scrollTop, 335, focusedIndex);
    const firstVisible = Math.floor(scrollTop / 54);
    const lastVisible = Math.ceil((scrollTop + 335) / 54) - 1;
    for (let index = firstVisible; index <= lastVisible; index++) assert.ok(indices.includes(index));
    assert.ok(indices.includes(focusedIndex));
    assert.equal(indices.length, 24);
    assert.equal(new Set(indices).size, indices.length);
    assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
  }
  assert.equal(getSessionListIndices(2000, 0, 335, 3).length, 23);
  const blurred = getSessionListIndices(2000, 10000, 335);
  assert.equal(blurred.length, 23);
  assert.ok(!blurred.includes(0));
});

test("session windows stay valid after a project shrinks and before the viewport is measured", () => {
  assert.deepEqual(getSessionListIndices(5, 80000, 335, 1999), [0, 1, 2, 3, 4]);
  assert.deepEqual(getSessionListIndices(0, 80000, 335, 1999), []);
  assert.equal(getSessionListIndices(2000, 0, 0).length, 28);
});

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("exposes the polled running-session set to the shell", () => {
  assert.match(source, /onRunningSessionIdsChange\?: \(ids: Set<string>\) => void/);
  assert.match(source, /onRunningSessionIdsChange\?\.\(runningSessionIds\)/);
});

test("exposes the loaded session catalog to the shell", () => {
  assert.match(source, /onSessionsChange\?: \(sessions: SessionInfo\[\]\) => void/);
  assert.match(source, /onSessionsChange\?\.\(allSessions\)/);
});

test("subagent completion stays silent and never becomes unread", () => {
  assert.match(source, /completionNotificationSuppressedSessionIds\?: string\[\]/);
  assert.match(
    source,
    /completedWithNotifications = completedInBackground\.filter\([\s\S]*?!previousSuppressedCompletionSessionIdsRef\.current\.has\(id\)[\s\S]*?!knownSubagentIds\.has\(id\)/,
  );
  assert.match(source, /completedWithNotifications\.forEach\(\(id\) => next\.add\(id\)\)/);
  assert.match(source, /if \(completedWithNotifications\.length > 0\) \{\s*onBackgroundTaskDone\?\.\(\)/);
  assert.match(
    source,
    /filter\(\(session\) => session\.relation\?\.kind !== "subagent"\)[\s\S]*?unreadEligibleIds\.has\(id\)/,
  );
});

test("includes project activity counts in accessible labels", () => {
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.agentRunning"\)\} \(\$\{activity\.running\}\)`\}/,
  );
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{activity\.unread\}\)`\}/,
  );
});

test("formats session timestamps with the active locale", () => {
  assert.match(source, /import \{ formatRelativeTime \} from "@\/lib\/i18n\/format"/);
  assert.match(sessionItemSource, /const \{ locale, t \} = useI18n\(\)/);
  assert.match(sessionItemSource, /formatRelativeTime\(session\.modified, locale\)/);
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
});

test("nested session rows expand, collapse, and keep focused subagents mounted", () => {
  const sessions = [
    makeSession("main", "2026-01-01T00:00:00.000Z"),
    makeSession("agent-1", "2026-01-01T00:01:00.000Z", "main"),
    makeSession("agent-2", "2026-01-01T00:02:00.000Z", "main"),
  ];
  const [family] = listSessionFamilies(sessions);

  const expandedRows = getSessionRows([family], new Set());
  assert.deepEqual(expandedRows.map((row) => row.kind), ["main", "subagent", "subagent"]);
  assert.deepEqual(expandedRows.map((row) => row.kind === "subagent" ? row.session.id : row.family.root.id), ["main", "agent-1", "agent-2"]);
  assert.equal(getFocusedSessionRowIndex(expandedRows, "agent-2"), 2);
  assert.ok(getSessionListIndices(200, 0, 54, 199).includes(199));

  const collapsedRows = getSessionRows([family], new Set(["main"]));
  assert.deepEqual(collapsedRows.map((row) => row.kind), ["main"]);
  assert.equal(getFocusedSessionRowIndex(collapsedRows, "agent-2"), -1);
});

test("offers the downstream context-menu hook only on a normal session row", () => {
  assert.match(sessionItemSource, /const handleContextMenu[\s\S]*?dispatchSessionRowContextMenu\(\{/);
  assert.match(
    sessionItemSource,
    /onContextMenu=\{confirmDelete \|\| renaming \? undefined : handleContextMenu\}/,
  );
});

test("chat projects span filesystem directories and apply to a session family", () => {
  const sessions = [
    makeSession("chat-a", "2026-01-01T00:00:00.000Z", undefined, "/tmp/project-a"),
    makeSession("agent-a", "2026-01-01T00:01:00.000Z", "chat-a", "/tmp/project-a"),
    makeSession("chat-b", "2026-01-01T00:02:00.000Z", undefined, "/tmp/project-b"),
  ];
  const assignments = { "chat-a": "release", "chat-b": "release" };

  assert.deepEqual(
    filterSessionsForChatProject(sessions, "release", assignments, new Set()).map(({ id }) => id),
    ["chat-a", "agent-a", "chat-b"],
  );
  assert.deepEqual(
    filterSessionsForChatProject(sessions, null, assignments, new Set(["chat-a"])).map(({ id }) => id),
    ["chat-b"],
  );
  assert.deepEqual(
    filterSessionsForChatProject(sessions, ARCHIVED_CHAT_PROJECT_ID, assignments, new Set(["chat-a"])).map(({ id }) => id),
    ["chat-a", "agent-a"],
  );
});
test("lifecycle refreshes bypass the cache while cross-window polling reuses it", () => {
  assert.match(source, /force \? "\/api\/sessions\?force=1" : "\/api\/sessions"/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /loadSessions\(isFirst, !isFirst\)/);
  assert.match(source, /data\.sessionListVersion !== sessionListVersionRef\.current[\s\S]*?await loadSessions\(\)/);
  assert.doesNotMatch(source, /sessionRefreshDone|sessionRefreshTimerRef|title=\{t\("sidebar\.refresh"\)\}/);
  assert.match(source, /loadSessions\(false, true\);[\s\S]*?onBackgroundTaskDone/);
});

test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(sessionItemSource, /if \(session\.transient\) return;/);
  assert.match(sessionItemSource, /\{!session\.transient && \(/);
});

test("visible nested session rows own selection until the family is collapsed", () => {
  const [family] = listSessionFamilies([
    makeSession("main", "2026-01-01T00:00:00.000Z"),
    makeSession("agent", "2026-01-01T00:01:00.000Z", "main"),
  ]);
  const expandedRows = getSessionRows([family], new Set());
  assert.equal(isSessionRowSelected(expandedRows[0], "agent", new Set()), false);
  assert.equal(isSessionRowSelected(expandedRows[1], "agent", new Set()), true);

  const collapsedRows = getSessionRows([family], new Set(["main"]));
  assert.equal(isSessionRowSelected(collapsedRows[0], "agent", new Set(["main"])), true);
});

function makeSession(id, modified, parentSessionId, cwd = "/tmp/pi-web") {
  return {
    path: `/tmp/${id}.jsonl`,
    id,
    cwd,
    created: "2026-01-01T00:00:00.000Z",
    modified,
    messageCount: 1,
    firstMessage: id,
    relation: parentSessionId
      ? {
          kind: "subagent",
          parentSessionId,
          profile: "review",
          description: "Review",
          status: "completed",
        }
      : undefined,
  };
}
