import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isMcpTool, isReadOnlySelection } = await jiti.import("./mcp-read-only-policy.ts");

test("a pinned selection is read-only when it names tools and none can write or run commands", () => {
  assert.equal(isReadOnlySelection(["read", "grep", "find", "ls"]), true);
  assert.equal(isReadOnlySelection(["read"]), true);
  // No pin follows pi's configured tools, and an empty pin is Chat only, which loads no MCP.
  assert.equal(isReadOnlySelection(undefined), false);
  assert.equal(isReadOnlySelection([]), false);
  for (const writer of ["bash", "powershell", "edit", "write"]) {
    assert.equal(isReadOnlySelection(["read", writer]), false, writer);
  }
});

test("MCP tools are the MCP extension's and any named mcp__", () => {
  const source = (path) => ({ path, source: "builtin", scope: "user", origin: "top-level" });
  assert.equal(isMcpTool({ name: "read_mcp_resource", sourceInfo: source("builtin:mcp") }), true);
  assert.equal(isMcpTool({ name: "mcp__docs__search", sourceInfo: source("/ext/other-mcp.ts") }), true);
  assert.equal(isMcpTool({ name: "web_search", sourceInfo: source("/ext/search.ts") }), false);
  assert.equal(isMcpTool({ name: "codemode", sourceInfo: source("builtin:codemode") }), false);
});
