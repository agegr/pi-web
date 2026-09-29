import assert from "node:assert/strict";
import test from "node:test";

import {
  clearExpandedToolCalls,
  isToolCallExpanded,
  setToolCallExpanded,
} from "./tool-call-expansion.ts";

test("remembers expanded tool calls across remounts by toolCallId", () => {
  clearExpandedToolCalls();
  assert.equal(isToolCallExpanded("call_1"), false);

  setToolCallExpanded("call_1", true);
  assert.equal(isToolCallExpanded("call_1"), true);
  assert.equal(isToolCallExpanded("call_2"), false);

  setToolCallExpanded("call_1", false);
  assert.equal(isToolCallExpanded("call_1"), false);
});

test("ignores tool calls without an id", () => {
  clearExpandedToolCalls();
  setToolCallExpanded(undefined, true);
  assert.equal(isToolCallExpanded(undefined), false);
});
