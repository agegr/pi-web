import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

function callbackBody(name, endAnchor) {
  const start = source.indexOf(`const ${name} = useCallback`);
  const end = source.indexOf(endAnchor, start);
  assert.notEqual(start, -1, `${name} callback not found`);
  assert.notEqual(end, -1, `end anchor not found after ${name}`);
  return source.slice(start, end);
}

function runHandleAgentEnd({ end, selectedSession, attention }) {
  const notifications = [];
  const context = vm.createContext({
    useCallback: (callback) => callback,
    setRefreshKey: () => {},
    setExplorerRefreshKey: () => {},
    selectedSession,
    shouldShowBrowserNotification: () => attention,
    deliverSessionNotification: (notice) => notifications.push(notice),
    translate: (key) => key,
    hiddenFinishedSessionIds: new Set(),
    setHiddenFinishedSessionIds: (updater) => {
      context.hiddenFinishedSessionIds = updater(context.hiddenFinishedSessionIds);
    },
  });
  vm.runInContext(
    stripTypeScriptTypes(`${callbackBody("handleAgentEnd", "\n  // The badge is for an unseen tab")}\nglobalThis.handleAgentEnd = handleAgentEnd;`),
    context,
  );
  context.handleAgentEnd(end);
  return { notifications, hiddenFinishedSessionIds: context.hiddenFinishedSessionIds };
}

test("a selected session that finishes while the tab is hidden badges the favicon (#1484)", () => {
  const selectedSession = { id: "open", name: "open" };
  const { notifications, hiddenFinishedSessionIds } = runHandleAgentEnd({
    end: { aborted: false },
    selectedSession,
    attention: true,
  });
  assert.equal(notifications.length, 1, "the browser Notification still fires");
  assert.deepEqual([...hiddenFinishedSessionIds], ["open"], "kept for the favicon until the tab opens");

  // The same finish while looking leaves no badge behind.
  const seen = runHandleAgentEnd({ end: { aborted: false }, selectedSession, attention: false });
  assert.equal(seen.notifications.length, 0);
  assert.deepEqual([...seen.hiddenFinishedSessionIds], []);
});

test("a stopped run, an unfinished task or a subagent never badges (#1484)", () => {
  const selectedSession = { id: "open", name: "open" };
  for (const [label, end, session] of [
    ["aborted", { aborted: true }, selectedSession],
    ["subagents active", { aborted: false, subagentsActive: true }, selectedSession],
    ["subagent session", { aborted: false }, { ...selectedSession, relation: { kind: "subagent" } }],
  ]) {
    const { hiddenFinishedSessionIds } = runHandleAgentEnd({ end, selectedSession: session, attention: true });
    assert.deepEqual([...hiddenFinishedSessionIds], [], label);
  }
});

test("opening the tab drops the hidden finishes (#1484)", () => {
  assert.match(source, /document\.addEventListener\("visibilitychange", clearIfSeen\);/);
  assert.match(source, /window\.addEventListener\("focus", clearIfSeen\);/);
  assert.match(source, /setHiddenFinishedSessionIds\(\(prev\) => \(prev\.size === 0 \? prev : new Set\(\)\)\);/);
});
