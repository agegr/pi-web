import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

const { withSubagentExtensionTools, SUBAGENT_CONTROL_TOOL_NAMES } =
  await jiti.import("./subagents.ts");
const { extensionFilterKey, filterExtensionsBySource } =
  await jiti.import("./subagent-runtime.ts");

// ---------------------------------------------------------------------------
// withSubagentExtensionTools — exported helper used by the runtime pipeline
// ---------------------------------------------------------------------------

test("withSubagentExtensionTools merges extension names and filters control tools", () => {
  const result = withSubagentExtensionTools(
    ["read", "bash", "edit"],
    ["lsp_diagnostics", "lsp_fix", "Agent"],
  );
  assert.ok(result.includes("read"));
  assert.ok(result.includes("bash"));
  assert.ok(result.includes("edit"));
  assert.ok(result.includes("lsp_diagnostics"));
  assert.ok(result.includes("lsp_fix"));
  assert.ok(!result.includes("Agent"), "Agent must be filtered out by SUBAGENT_CONTROL_TOOLS");
});

test("withSubagentExtensionTools filters all three reserved tool names", () => {
  const result = withSubagentExtensionTools(
    ["read"],
    [...SUBAGENT_CONTROL_TOOL_NAMES, "lsp_diagnostics"],
  );
  assert.ok(!result.includes("Agent"));
  assert.ok(!result.includes("get_subagent_result"));
  assert.ok(!result.includes("steer_subagent"));
  assert.ok(result.includes("lsp_diagnostics"));
  assert.ok(result.includes("read"));
});

test("withSubagentExtensionTools deduplicates across profile and extension", () => {
  const result = withSubagentExtensionTools(["read", "bash"], ["read", "grep"]);
  const readCount = result.filter((t) => t === "read").length;
  assert.equal(readCount, 1, "read must appear exactly once");
  assert.ok(result.includes("grep"));
});

test("withSubagentExtensionTools handles empty extension list", () => {
  const result = withSubagentExtensionTools(["read", "bash"], []);
  assert.deepEqual(result.sort(), ["bash", "read"]);
});

// ---------------------------------------------------------------------------
// C: extensionFilterKey — stable key derivation from extension source strings
// ---------------------------------------------------------------------------

test("C: extensionFilterKey strips npm prefix and version from scoped packages", () => {
  assert.equal(extensionFilterKey("npm:@scope/my-pkg@1.0.0"), "@scope/my-pkg");
});

test("C: extensionFilterKey strips npm prefix and version from unscoped packages", () => {
  assert.equal(extensionFilterKey("npm:my-pkg@2.3.4"), "my-pkg");
});

test("C: extensionFilterKey uses basename without extension for file paths", () => {
  assert.equal(extensionFilterKey("/home/user/.agents/extensions/my-ext.ts"), "my-ext");
});

test("C: extensionFilterKey handles path without extension", () => {
  assert.equal(extensionFilterKey("/path/to/ext"), "ext");
});

// ---------------------------------------------------------------------------
// C: filterExtensionsBySource — real-shape guardrail + allow/deny integration
// ---------------------------------------------------------------------------

test("C: filterExtensionsBySource uses sourceInfo.path for non-npm sources", () => {
  const extensions = [
    { sourceInfo: { source: "auto", path: "/ext/foo.ts" }, tools: new Map([["foo", {}]]) },
    { sourceInfo: { source: "auto", path: "/ext/bar.js" }, tools: new Map([["bar", {}]]) },
    { sourceInfo: { source: "npm:baz@1.0.0" }, tools: new Map([["baz", {}]]) },
  ];

  const filtered = filterExtensionsBySource(extensions, { allow: ["foo", "baz"] });
  assert.equal(filtered.length, 2);
  assert.ok(filtered.some((e) => e.tools.has("foo")), "foo must survive (matched via path basename)");
  assert.ok(filtered.some((e) => e.tools.has("baz")), "baz must survive (matched via npm package name)");
  assert.ok(!filtered.some((e) => e.tools.has("bar")), "bar must be filtered out");
});

test("C: filterExtensionsBySource deny wins over allow", () => {
  const extensions = [
    { sourceInfo: { source: "npm:pkg-a@1.0.0" }, tools: new Map([["a", {}]]) },
    { sourceInfo: { source: "npm:pkg-b@1.0.0" }, tools: new Map([["b", {}]]) },
  ];

  const filtered = filterExtensionsBySource(extensions, {
    allow: ["pkg-a", "pkg-b"],
    deny: ["pkg-a"],
  });
  assert.equal(filtered.length, 1);
  assert.ok(filtered[0].tools.has("b"));
});

test("C: filterExtensionsBySource with no allow/deny returns all", () => {
  const extensions = [
    { sourceInfo: { source: "npm:a@1.0.0" }, tools: new Map([["a", {}]]) },
    { sourceInfo: { source: "auto", path: "/ext/b.ts" }, tools: new Map([["b", {}]]) },
  ];

  const filtered = filterExtensionsBySource(extensions, {});
  assert.equal(filtered.length, 2);
});

test("C: filterExtensionsBySource handles missing sourceInfo gracefully", () => {
  const extensions = [
    { tools: new Map([["a", {}]]) },
    { sourceInfo: {}, tools: new Map([["b", {}]]) },
  ];

  const filtered = filterExtensionsBySource(extensions, {});
  assert.equal(filtered.length, 2);
});
