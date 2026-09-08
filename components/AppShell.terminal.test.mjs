import assert from "node:assert/strict";
import test from "node:test";
import { newTerminalTab, restoreTerminalTabs } from "./terminal-tab-state.ts";

test("restored workspace tabs retain terminal identity and never request a new shell", () => {
  const first = newTerminalTab("/repo/worktree-a");
  const second = newTerminalTab("/repo/worktree-b");
  assert.notEqual(first.id, second.id);
  const saved = restoreTerminalTabs(JSON.stringify({ tabs: [first, second], activeId: second.id, open: true }));
  assert.deepEqual(saved, {
    tabs: [{ ...first, restored: true }, { ...second, restored: true }],
    activeId: second.id,
    open: true,
  });
});

test("storage corruption cannot create invalid or duplicate terminal tabs", () => {
  assert.deepEqual(restoreTerminalTabs("broken"), { tabs: [], activeId: null, open: false });
  assert.deepEqual(restoreTerminalTabs(null), { tabs: [], activeId: null, open: false });
  const tab = newTerminalTab("/repo");
  const saved = restoreTerminalTabs(JSON.stringify({
    tabs: [null, {}, tab, tab, { ...tab, id: "../../bad" }, { ...tab, cwd: null }],
    activeId: "missing",
  }));
  assert.deepEqual(saved, { tabs: [{ ...tab, restored: true }], activeId: null, open: false });
});
