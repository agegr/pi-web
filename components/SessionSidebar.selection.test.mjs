import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("SessionSidebar.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const jiti = createJiti(import.meta.url);
const { resolveSessionSelection } = await jiti.import("../lib/session-tree.ts");

// Execute the component's actual event callbacks with controlled render bindings.
function callback(name, bindings) {
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(initializer, `${name} exists`);
  if (ts.isCallExpression(initializer)) initializer = initializer.arguments[0];
  const js = ts.transpile(`const action = ${initializer.getText(ast)}; action;`, { target: ts.ScriptTarget.ES2022 });
  return vm.runInNewContext(js, { Set, ...bindings });
}

function catalogue() {
  return new Map(["a", "b", "c"].map((id) => [id, {
    root: { id, modified: "2026-01-01T00:00:00Z" }, subagents: [],
  }]));
}

function selectionInput() {
  return { uiState: { sessions: {} }, runningIds: new Set(), awaitingIds: new Set(), subagentsActiveIds: new Set() };
}

test("selection checkbox callback toggles roots independently and refuses activity and pending writes", () => {
  let selected = new Set(["a"]);
  const pending = { current: false };
  const action = callback("toggleSelection", {
    selectionScope: "main", selectionDeletePendingRef: pending,
    familyByRootId: catalogue(), selectionEligibility: { excluded: new Map([["b", "active"]]) },
    setSelectedRootIds: (update) => { selected = update(selected); },
  });
  action("c");
  assert.deepEqual([...selected], ["a", "c"]);
  action("b"); action("missing");
  assert.deepEqual([...selected], ["a", "c"]);
  action("a");
  assert.deepEqual([...selected], ["c"]);
  pending.current = true;
  action("c");
  assert.deepEqual([...selected], ["c"]);
});

test("delete callback revalidates frozen roots, clears submitted selection and prevents duplicate requests", async () => {
  const families = catalogue();
  const input = selectionInput();
  input.runningIds.add("c");
  const pending = { current: false };
  let selected = new Set(["a", "b", "c"]);
  const pendingStates = [];
  const requests = [];
  let complete;
  const request = new Promise((resolve) => { complete = resolve; });
  const action = callback("deleteSelected", {
    selectionDeletePendingRef: pending,
    menu: { kind: "selection", ids: new Set(["a", "c"]), scope: "main" },
    selectionDeleteIds: ["a"], familyByRootId: families, selectionInput: input,
    resolveSessionSelection,
    setSelectionDeletePending: (value) => pendingStates.push(value),
    setSelectedRootIds: (value) => { selected = value; },
    deleteFamilyIds: (key, ids) => { requests.push({ key, ids }); return request; },
    selectionDoneRef: { current: null }, selectedTabButton: () => null,
  });
  action(); action();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].key, "selection");
  assert.deepEqual(requests[0].ids, ["a"], "running C is kept; B was not in the question");
  assert.equal(selected.size, 0);
  assert.equal(pending.current, true);
  complete();
  await request;
  await Promise.resolve();
  assert.equal(pending.current, false);
  assert.deepEqual(pendingStates, [true, false]);
});

test("Done/reset closes only a selection confirmation and clears local selection", () => {
  let scope = "archive";
  let ids = new Set(["a"]);
  let menu = { kind: "selection" };
  const action = callback("clearSelection", {
    setSelectionScope: (next) => { scope = next; },
    setSelectedRootIds: (next) => { ids = next; },
    setMenu: (update) => { menu = update(menu); },
  });
  action();
  assert.equal(scope, null);
  assert.equal(ids.size, 0);
  assert.equal(menu, null);
  menu = { kind: "group" };
  action();
  assert.equal(menu.kind, "group");
});
