import assert from "node:assert/strict";
import test from "node:test";
import { prettyMcpResultText } from "./mcp-tool-display.ts";

test("MCP result formatting preserves large numeric IDs and overflowing numbers", () => {
  for (const text of ['{"id":9007199254740993}', '[{"id":-9007199254740993}]', '{"value":1e400}']) {
    assert.equal(prettyMcpResultText(text), text);
  }
  assert.equal(prettyMcpResultText('{"id":"9007199254740993","count":2}'), '{\n  "id": "9007199254740993",\n  "count": 2\n}');
});
