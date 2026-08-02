import assert from "node:assert/strict";
import test from "node:test";

const { registerModules, clearRegistry } = await import("./registry.ts");
const { composeSystemPrompt } = await import("./compose.ts");

function mod(id, source, category, tags, text, extra = {}) {
  return { id, source, category, tags, text, ...extra };
}

test("compose returns all enabled modules concatenated when no query", () => {
  clearRegistry();
  registerModules([
    mod("a.1", "app", "identity", ["id"], "AAA", { alwaysOn: true }),
    mod("a.2", "app", "tone", ["t"], "BBB"),
    mod("m.1", "agents-md", "other", ["o"], "CCC"),
  ]);
  const { prompt, selection } = composeSystemPrompt();
  assert.ok(prompt.includes("AAA"));
  assert.ok(prompt.includes("BBB"));
  assert.ok(prompt.includes("CCC"));
  assert.equal(selection.selected.length, 3);
});

test("compose filters by source", () => {
  clearRegistry();
  registerModules([
    mod("a.1", "app", "identity", ["id"], "AAA"),
    mod("m.1", "agents-md", "other", ["o"], "CCC"),
  ]);
  const { prompt } = composeSystemPrompt({ source: "app" });
  assert.ok(prompt.includes("AAA"));
  assert.ok(!prompt.includes("CCC"));
});

test("compose honors disabled switch via enabledOverride", () => {
  clearRegistry();
  registerModules([
    mod("a.1", "app", "identity", ["id"], "AAA", { alwaysOn: true }),
    mod("a.2", "app", "tone", ["t"], "BBB"),
  ]);
  const { prompt, selection } = composeSystemPrompt({ enabledOverride: { "a.2": false } });
  assert.ok(prompt.includes("AAA"), "alwaysOn kept");
  assert.ok(!prompt.includes("BBB"), "disabled module omitted");
  assert.ok(!selection.selected.map((m) => m.id).includes("a.2"), "disabled module not selected");
});

test("compose prefers compressed text", () => {
  clearRegistry();
  registerModules([
    mod("a.1", "app", "identity", ["id"], "ORIGINAL LONG TEXT", { compressedText: "SHORT" }),
  ]);
  const { prompt } = composeSystemPrompt();
  assert.equal(prompt, "SHORT");
});

test("compose filters by query (dynamic submission)", () => {
  clearRegistry();
  registerModules([
    mod("a.1", "app", "identity", ["id"], "AAA", { alwaysOn: true }),
    mod("a.2", "app", "tone", ["tone"], "BBB"),
    mod("a.3", "app", "output-format", ["json", "format"], "CCC"),
  ]);
  const { prompt, selection } = composeSystemPrompt({ userInput: "输出 JSON 格式" });
  assert.ok(prompt.includes("AAA"), "alwaysOn");
  assert.ok(prompt.includes("CCC"), "format matched");
  assert.ok(!prompt.includes("BBB"), "tone skipped");
  assert.ok(selection.tokensSaved > 0);
});
