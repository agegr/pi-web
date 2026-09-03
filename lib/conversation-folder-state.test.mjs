import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  deleteConversationFolder,
  emptyConversationFolderState,
  loadConversationFolderState,
  resolveConversationFolderAssignments,
  saveConversationFolderState,
} = await createJiti(import.meta.url).import("./conversation-folder-state.ts");

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
}

test("saves and restores conversation folders", () => {
  const storage = createStorage();
  const state = {
    folders: [{ id: "folder-1", name: "Research", projectKey: "repo:1", collapsed: false }],
    assignments: { child: "folder-1", unfiled: null },
  };
  saveConversationFolderState(state, storage);
  assert.deepEqual(loadConversationFolderState(storage), state);
});

test("inherits a parent folder while allowing an explicit unfiled override", () => {
  const resolved = resolveConversationFolderAssignments(
    [
      { id: "root" },
      { id: "child", parentSessionId: "root" },
      { id: "grandchild", parentSessionId: "child" },
    ],
    { root: "folder-1", child: null },
    new Set(["folder-1"]),
  );
  assert.equal(resolved.get("root"), "folder-1");
  assert.equal(resolved.get("child"), null);
  assert.equal(resolved.get("grandchild"), null);
});

test("deleting a folder keeps its sessions explicitly unfiled", () => {
  const state = {
    folders: [{ id: "folder-1", name: "Research", projectKey: "repo:1", collapsed: false }],
    assignments: { root: "folder-1" },
  };
  assert.deepEqual(deleteConversationFolder(state, "folder-1"), {
    folders: [],
    assignments: { root: null },
  });
});

test("rejects malformed and duplicate folder records", () => {
  const storage = createStorage({
    "pi-web:conversation-folders": JSON.stringify({
      folders: [
        { id: "folder-1", name: "Research", projectKey: "repo:1", collapsed: false },
        { id: "folder-1", name: "Duplicate", projectKey: "repo:1", collapsed: false },
        { id: "folder-2", name: "", projectKey: "repo:1", collapsed: false },
      ],
      assignments: [],
    }),
  });
  assert.deepEqual(loadConversationFolderState(storage), {
    folders: [{ id: "folder-1", name: "Research", projectKey: "repo:1", collapsed: false }],
    assignments: {},
  });
  assert.deepEqual(loadConversationFolderState(null), emptyConversationFolderState());
});
