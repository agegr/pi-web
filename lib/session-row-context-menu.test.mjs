import assert from "node:assert/strict";
import test from "node:test";

const {
  SESSION_ROW_CONTEXT_MENU_EVENT,
  dispatchSessionRowContextMenu,
} = await import("./session-row-context-menu.ts");

function createDetail() {
  return {
    id: "session-1",
    path: "/tmp/session-1.jsonl",
    cwd: "/tmp/project",
    name: "Example session",
    clientX: 120,
    clientY: 80,
    refresh: () => {},
  };
}

test("leaves the native context menu unclaimed when no listener is installed", () => {
  const target = new EventTarget();
  assert.equal(dispatchSessionRowContextMenu(createDetail(), target), false);
});

test("delivers the stable session-row detail without requiring a listener to claim it", () => {
  const target = new EventTarget();
  const detail = createDetail();
  let received;
  target.addEventListener(SESSION_ROW_CONTEXT_MENU_EVENT, (event) => {
    received = event;
  });

  assert.equal(dispatchSessionRowContextMenu(detail, target), false);
  assert.equal(received.cancelable, true);
  assert.equal(received.detail, detail);
});

test("reports the menu as handled when a listener cancels the extension event", () => {
  const target = new EventTarget();
  target.addEventListener(SESSION_ROW_CONTEXT_MENU_EVENT, (event) => {
    event.preventDefault();
  });

  assert.equal(dispatchSessionRowContextMenu(createDetail(), target), true);
});
