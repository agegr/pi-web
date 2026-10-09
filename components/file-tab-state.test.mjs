import assert from "node:assert/strict";
import test from "node:test";

import { openFileTab, saveFileViewerState, saveParkedFileViewerState, switchFileWorkspace } from "./file-tab-state.ts";

const tabA = {
  id: "file:/repo/a.ts",
  label: "a.ts",
  filePath: "/repo/a.ts",
  viewerRevision: 0,
  viewerState: {
    displayMode: "source",
    wrapLines: true,
    scrollTop: 240,
    scrollLeft: 16,
  },
};

const tabB = {
  id: "file:/repo/b.ts",
  label: "b.ts",
  filePath: "/repo/b.ts",
  viewerRevision: 0,
};

const openA = {
  fileName: "a.ts",
  filePath: "/repo/a.ts",
  tabId: "file:/repo/a.ts",
};

test("file tabs are parked and restored per workspace", () => {
  const states = new Map();
  const projectA = { tabs: [tabA], activeTabId: tabA.id, open: true };
  const projectB = switchFileWorkspace(states, "project-a", "project-b", projectA, 0);

  assert.deepEqual(projectB, { tabs: [], activeTabId: null, open: false });
  // The viewer of A's active tab reports as it unmounts, under A's generation.
  const previewState = { ...tabA.viewerState, displayMode: "preview" };
  saveParkedFileViewerState(states, 0, tabA.id, 0, previewState);
  const restored = switchFileWorkspace(states, "project-b", "project-a", {
    tabs: [tabB],
    activeTabId: tabB.id,
    open: false,
  }, 1);
  assert.deepEqual(restored.tabs[0].viewerState, previewState);
  assert.equal(restored.activeTabId, tabA.id);
  assert.equal(restored.open, true);
  assert.deepEqual(states.get("project-b")?.tabs, [tabB]);
  assert.equal(states.has("project-a"), false);
});

test("a viewer's report reaches only the workspace it rendered in", () => {
  const states = new Map();
  // Both projects have the same file open (a path outside either project).
  const sourceA = { ...tabA, viewerState: { ...tabA.viewerState, displayMode: "preview" } };
  switchFileWorkspace(states, "project-a", "project-b", { tabs: [sourceA], activeTabId: sourceA.id, open: true }, 0);
  const sourceB = { ...tabA, viewerState: { ...tabA.viewerState, scrollTop: 0 } };
  switchFileWorkspace(states, "project-b", "project-c", { tabs: [sourceB], activeTabId: sourceB.id, open: true }, 1);

  const scrolledB = { ...sourceB.viewerState, scrollTop: 900 };
  saveParkedFileViewerState(states, 1, tabA.id, 0, scrolledB);
  assert.deepEqual(states.get("project-a").tabs[0].viewerState, sourceA.viewerState);
  assert.deepEqual(states.get("project-b").tabs[0].viewerState, scrolledB);

  // A report from a generation that is no longer parked is dropped.
  saveParkedFileViewerState(states, 7, tabA.id, 0, tabA.viewerState);
  assert.deepEqual(states.get("project-b").tabs[0].viewerState, scrolledB);
});

test("saving viewer state updates only the matching revision", () => {
  const tabs = [tabA, tabB];
  const nextState = { ...tabA.viewerState, scrollTop: 480 };
  const saved = saveFileViewerState(tabs, tabA.id, 0, nextState);

  assert.notStrictEqual(saved, tabs);
  assert.deepEqual(saved[0].viewerState, nextState);
  assert.strictEqual(saved[1], tabB);

  const stale = saveFileViewerState(saved, tabA.id, 9, tabA.viewerState);
  assert.strictEqual(stale, saved);
});

test("opening an existing tab normally preserves its state and revision", () => {
  const tabs = [tabA, tabB];
  assert.strictEqual(openFileTab(tabs, openA), tabs);
});

test("changing the source session remounts the viewer without losing its state", () => {
  const [next] = openFileTab([tabA], { ...openA, sourceSessionId: "session-2" });
  assert.equal(next.sourceSessionId, "session-2");
  assert.equal(next.viewerRevision, 1);
  assert.strictEqual(next.viewerState, tabA.viewerState);
});

test("opening from the same source session preserves the viewer revision", () => {
  const tab = { ...tabA, sourceSessionId: "session-1" };
  const tabs = [tab];
  assert.strictEqual(
    openFileTab(tabs, { ...openA, sourceSessionId: "session-1" }),
    tabs,
  );
});

test("changing source while forcing diff increments the revision once", () => {
  const [next] = openFileTab([tabA], {
    ...openA,
    sourceSessionId: "session-2",
    modeHint: "diff",
  });
  assert.equal(next.sourceSessionId, "session-2");
  assert.equal(next.viewerRevision, 1);
  assert.equal(next.viewerState.displayMode, "diff");
});

test("every explicit diff activation resets the mode and increments the revision", () => {
  const first = openFileTab([tabA, tabB], { ...openA, modeHint: "diff" });
  assert.equal(first[0].viewerRevision, 1);
  assert.deepEqual(first[0].viewerState, {
    displayMode: "diff",
    wrapLines: true,
    scrollTop: 0,
    scrollLeft: 0,
  });

  const returnedToSource = saveFileViewerState(first, tabA.id, 1, tabA.viewerState);
  const second = openFileTab(returnedToSource, { ...openA, modeHint: "diff" });
  assert.equal(second[0].viewerRevision, 2);
  assert.equal(second[0].viewerState.displayMode, "diff");
});

test("a remounted viewer ignores the previous revision's late cleanup", () => {
  const reopened = openFileTab([tabA], { ...openA, modeHint: "diff" });
  const stale = saveFileViewerState(reopened, tabA.id, 0, tabA.viewerState);
  assert.strictEqual(stale, reopened);
  assert.equal(stale[0].viewerState.displayMode, "diff");
});

test("a PDF page link remounts the viewer so the document jumps", () => {
  const [next] = openFileTab([tabA], { ...openA, page: 12 });
  assert.equal(next.page, 12);
  assert.equal(next.viewerRevision, 1);
  assert.strictEqual(next.viewerState, tabA.viewerState);
});

test("reopening the same PDF page keeps the viewer mounted", () => {
  const tabs = [{ ...tabA, page: 12 }];
  assert.strictEqual(openFileTab(tabs, { ...openA, page: 12 }), tabs);
});

test("opening another page of the same PDF increments the revision", () => {
  const [next] = openFileTab([{ ...tabA, page: 12 }], { ...openA, page: 13 });
  assert.equal(next.page, 13);
  assert.equal(next.viewerRevision, 1);
});

test("opening a PDF without a page fragment clears a previous jump", () => {
  const [next] = openFileTab([{ ...tabA, page: 12 }], openA);
  assert.equal(next.page, undefined);
  assert.equal(next.viewerRevision, 1);
});
