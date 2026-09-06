import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  TOOL_SELECTION_TYPE,
  appendSessionToolSelection,
  readSessionToolSelection,
  validateSessionToolSelection,
} = await createJiti(import.meta.url).import("./session-tool-selection.ts");

function entry(data, customType = TOOL_SELECTION_TYPE) {
  return {
    type: "custom",
    customType,
    data,
    id: Math.random().toString(16),
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
  };
}

test("a missing tool-selection entry identifies a legacy session", () => {
  assert.equal(readSessionToolSelection([]), undefined);
  assert.equal(readSessionToolSelection([entry({ version: 1, tools: [] }, "other")]), undefined);
});

test("an empty selection is distinct from a missing selection", () => {
  assert.deepEqual(readSessionToolSelection([entry({ version: 1, tools: [] })]), []);
});

test("the newest valid tool selection wins and invalid newer entries are ignored", () => {
  const entries = [
    entry({ version: 1, tools: ["read"] }),
    entry({ version: 2, tools: [] }),
    entry({ version: 1, tools: ["unknown"] }),
    entry({ version: 1, tools: ["bash", "read", "bash"] }),
  ];
  assert.deepEqual(readSessionToolSelection(entries), ["bash", "read"]);

  entries.push(entry({ version: 1, tools: "read" }));
  assert.deepEqual(readSessionToolSelection(entries), ["bash", "read"]);
});

test("tool selections accept only built-in tools", () => {
  assert.deepEqual(validateSessionToolSelection(["read", "write", "read"]), ["read", "write"]);
  assert.throws(() => validateSessionToolSelection(["read", "extension-tool"]), /built-in tool names/);
  assert.throws(() => validateSessionToolSelection(undefined), /built-in tool names/);
});

test("appending a selection writes the versioned custom entry", () => {
  const calls = [];
  appendSessionToolSelection({
    appendCustomEntry: (...args) => calls.push(args),
  }, []);
  assert.deepEqual(calls, [[TOOL_SELECTION_TYPE, { version: 1, tools: [] }]]);
});
