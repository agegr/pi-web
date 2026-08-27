import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CHAT_PANES,
  addComposerPane,
  bumpPaneInstance,
  evictIdlePane,
  paneDraftKey,
  paneTitle,
  promoteComposerPane,
  replacePaneSession,
  upsertSessionPane,
} from "./chat-panes.ts";

function session(id, extras = {}) {
  return {
    id,
    path: `/tmp/${id}.jsonl`,
    cwd: "/tmp",
    created: "",
    modified: "",
    messageCount: 0,
    firstMessage: extras.firstMessage ?? "",
    name: extras.name,
  };
}

test("upsertSessionPane reuses an open conversation instead of duplicating it", () => {
  const first = upsertSessionPane([], session("a", { name: "One" }));
  assert.equal(first.created, true);
  const second = upsertSessionPane(first.panes, session("a", { name: "One renamed" }));
  assert.equal(second.created, false);
  assert.equal(second.panes.length, 1);
  assert.equal(second.paneId, "a");
  assert.equal(second.panes[0].session.name, "One renamed");
});

test("a second conversation is a separate pane", () => {
  const first = upsertSessionPane([], session("a"));
  const second = upsertSessionPane(first.panes, session("b"));
  assert.equal(second.created, true);
  assert.equal(second.panes.length, 2);
  assert.deepEqual(second.panes.map((pane) => pane.paneId), ["a", "b"]);
});

test("composer panes promote in place so the chat keeps running", () => {
  const added = addComposerPane([], "/work", "draft-1");
  assert.equal(paneDraftKey(added.panes[0]), "new:draft-1:/work");
  const promoted = promoteComposerPane(added.panes, "new:draft-1:/work", session("real"));
  assert.equal(promoted.length, 1);
  assert.equal(promoted[0].paneId, "new:draft-1");
  assert.equal(promoted[0].session.id, "real");
  assert.equal(paneDraftKey(promoted[0]), null);
});

test("evictIdlePane keeps the active and running conversations", () => {
  let panes = [];
  for (let i = 0; i < MAX_CHAT_PANES; i++) {
    panes = upsertSessionPane(panes, session(`s${i}`)).panes;
  }
  const running = new Set(["s0"]);
  const next = evictIdlePane(panes, "s0", running);
  assert.equal(next.length, MAX_CHAT_PANES - 1);
  assert.ok(next.some((pane) => pane.paneId === "s0"));
  assert.equal(next.some((pane) => pane.paneId === "s1"), false);
});

test("replacePaneSession remounts only that conversation", () => {
  const panes = upsertSessionPane([], session("old")).panes;
  const next = replacePaneSession(panes, "old", session("forked"));
  assert.equal(next[0].paneId, "forked");
  assert.equal(next[0].instanceKey, 1);
});

test("bumpPaneInstance is per-pane", () => {
  let panes = upsertSessionPane([], session("a")).panes;
  panes = upsertSessionPane(panes, session("b")).panes;
  const next = bumpPaneInstance(panes, "b");
  assert.equal(next[0].instanceKey, 0);
  assert.equal(next[1].instanceKey, 1);
});

test("paneTitle prefers the session name", () => {
  assert.equal(paneTitle({
    paneId: "a",
    session: session("a", { name: "Named", firstMessage: "hello" }),
    newSessionCwd: null,
    newSessionDraftId: null,
    instanceKey: 0,
  }, "New"), "Named");
  assert.equal(paneTitle({
    paneId: "new:1",
    session: null,
    newSessionCwd: "/work",
    newSessionDraftId: "1",
    instanceKey: 0,
  }, "New"), "New");
});
