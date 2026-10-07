import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { canonicalJson, mcpConfigKey, MCP_CONFIG_KEY_MAX_DEPTH } = await jiti.import("./mcp-config-key.ts");

/** `levels` arrays (or objects under `k`) around `leaf`, built without recursion. */
function nested(levels, leaf, kind = "array") {
  let value = leaf;
  for (let level = 0; level < levels; level++) value = kind === "array" ? [value] : { k: value };
  return value;
}

/**
 * The same as JSON text, built without recursion: `JSON.stringify` recurses once per level and
 * overflows a smaller stack (Linux CI runners) at a few thousand.
 */
function nestedJson(levels, leafJson, kind = "array") {
  return kind === "array" ? `${"[".repeat(levels)}${leafJson}${"]".repeat(levels)}` : `${'{"k":'.repeat(levels)}${leafJson}${"}".repeat(levels)}`;
}

test("an entry's key ignores the order of its keys and changes with its content", () => {
  const a = { command: "npx", args: ["-y", "srv"], env: { B: "2", A: "1" } };
  const b = { env: { A: "1", B: "2" }, args: ["-y", "srv"], command: "npx" };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(mcpConfigKey(a), mcpConfigKey(b));
  assert.notEqual(mcpConfigKey(a), mcpConfigKey({ ...a, args: ["-y", "other"] }));
  assert.equal(canonicalJson([1, "two", null, true]), '[1,"two",null,true]');
  assert.equal(canonicalJson(undefined), "null");
});

test("an entry nested far deeper than the stack allows still gets a key", () => {
  // JSON.parse accepts this from a 6 KB repository file; one recursion per level overflowed at a few thousand.
  for (const kind of ["array", "object"]) {
    const deep = JSON.parse(nestedJson(5_000, '"x"', kind));
    assert.doesNotThrow(() => mcpConfigKey({ command: "x", pad: deep }), kind);
    assert.equal(mcpConfigKey({ command: "x", pad: deep }), mcpConfigKey({ pad: deep, command: "x" }), kind);
  }
  const huge = nested(200_000, 1);
  assert.doesNotThrow(() => mcpConfigKey(huge));
});

test("content is followed to the depth limit, and only past it do entries compare equal", () => {
  const within = MCP_CONFIG_KEY_MAX_DEPTH - 1;
  assert.notEqual(mcpConfigKey(nested(within, 1)), mcpConfigKey(nested(within, 2)), "a leaf inside the limit counts");
  assert.notEqual(mcpConfigKey(nested(within, [])), mcpConfigKey(nested(within, {})));
  assert.equal(mcpConfigKey(nested(MCP_CONFIG_KEY_MAX_DEPTH + 1, 1)), mcpConfigKey(nested(MCP_CONFIG_KEY_MAX_DEPTH + 1, 2)));
  // The marker is not JSON, so no value prints as it.
  assert.notEqual(canonicalJson(nested(MCP_CONFIG_KEY_MAX_DEPTH + 1, 1)), canonicalJson(nested(MCP_CONFIG_KEY_MAX_DEPTH, "<too deep>")));
});
