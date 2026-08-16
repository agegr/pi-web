import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  preferHostAskExtension,
  createAskUserToolDefinition,
  HOST_ASK_EXTENSION_PATH,
} = await jiti.import("./ask-user-extension.ts");

const ext = (path, tools) => ({
  path,
  tools: new Map(tools.map((tool) => [tool, { name: tool }])),
});

test("built-in ask_user wins: third-party same-name tool removed, other tools kept", () => {
  const base = {
    extensions: [
      ext("/path/to/pi-ask-user", ["ask_user", "other_tool"]),
      ext(HOST_ASK_EXTENSION_PATH, ["ask_user"]),
    ],
    errors: [
      {
        path: HOST_ASK_EXTENSION_PATH,
        error: 'Tool "ask_user" conflicts with /path/to/pi-ask-user',
      },
    ],
    runtime: {},
  };
  const result = preferHostAskExtension(base);
  const host = result.extensions.find(
    (e) => e.path === HOST_ASK_EXTENSION_PATH,
  );
  const third = result.extensions.find(
    (e) => e.path === "/path/to/pi-ask-user",
  );
  assert.ok(host, "built-in extension kept");
  assert.equal(host.tools.has("ask_user"), true, "built-in ask_user kept");
  assert.ok(third, "third-party extension kept as a whole");
  assert.equal(third.tools.has("ask_user"), false, "third-party ask_user removed");
  assert.equal(third.tools.has("other_tool"), true, "third-party other tools unaffected");
  assert.equal(result.errors.length, 0, "built-in conflict diagnostics cleared");
});

test("returns base unchanged when no third-party conflict (no copy)", () => {
  const base = {
    extensions: [ext(HOST_ASK_EXTENSION_PATH, ["ask_user"])],
    errors: [],
    runtime: {},
  };
  assert.equal(preferHostAskExtension(base), base);
});

test("returns base unchanged when the built-in extension is absent", () => {
  const base = {
    extensions: [ext("/path/to/pi-ask-user", ["ask_user"])],
    errors: [{ path: "/path/to/pi-ask-user", error: "boom" }],
    runtime: {},
  };
  assert.equal(preferHostAskExtension(base), base);
});

test("tool definition exposes name and a complete parameter schema", () => {
  const def = createAskUserToolDefinition();
  assert.equal(def.name, "ask_user");
  assert.match(def.description, /ask the user/i);
  const schema = def.parameters;
  assert.equal(schema.type, "object");
  assert.ok(schema.properties.question, "question is required");
  assert.ok(schema.properties.options, "options exists");
  assert.ok(schema.properties.allowMultiple, "allowMultiple exists");
  assert.ok(schema.properties.allowFreeform, "allowFreeform exists");
  assert.ok(schema.properties.context, "context exists");
  assert.ok(schema.required.includes("question"), "question is in required");
});
