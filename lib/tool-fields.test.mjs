import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const toolFieldsModule = await jiti.import("./tool-fields.ts");
const { EMPTY_FIELD_VALUE, toolFieldsOfInput } = toolFieldsModule;

const keys = (fields) => fields?.map((field) => field.key);
const valueOf = (fields, key) => fields?.find((field) => field.key === key)?.value;

test("grep previews the pattern before its search directory", () => {
  const { toolInputPreview } = toolFieldsModule;
  assert.equal(toolInputPreview({ path: "src", pattern: "TODO" }, null, "grep"), "TODO");
  assert.equal(toolInputPreview({ pattern: "TODO" }, null, "grep"), "TODO");
  assert.equal(toolInputPreview({ path: "src", pattern: "" }, null, "grep"), "src");
  assert.equal(toolInputPreview({ path: "src", pattern: "TODO" }, null, "custom"), "src");
  assert.equal(toolInputPreview({ path: "src", pattern: "x".repeat(300) }, null, "grep").length, 120);
});

test("a flat argument list becomes one row per argument, in the tool's own order", () => {
  const fields = toolFieldsOfInput({ path: "src/app/page.tsx", offset: 120, limit: 80 });
  assert.deepEqual(keys(fields), ["path", "offset", "limit"]);
  assert.equal(valueOf(fields, "offset"), "120");
  assert.equal(valueOf(fields, "limit"), "80");
});

test("numbers, booleans and nulls read as the text they are", () => {
  const fields = toolFieldsOfInput({ pattern: "TODO", "case-sensitive": false, limit: 0, extra: null });
  assert.equal(valueOf(fields, "case-sensitive"), "false");
  assert.equal(valueOf(fields, "limit"), "0");
  assert.equal(valueOf(fields, "extra"), "null");
});

test("an empty argument is shown as something the eye can find", () => {
  const fields = toolFieldsOfInput({ path: "notes.md", content: "" });
  assert.equal(valueOf(fields, "content"), EMPTY_FIELD_VALUE);
});

test("a value with newlines keeps them instead of folding into one line", () => {
  const fields = toolFieldsOfInput({ path: "a.ts", content: "one\ntwo\n" });
  assert.equal(fields.find((field) => field.key === "path").multiline, false);
  assert.equal(fields.find((field) => field.key === "content").multiline, true);
});

test("a nested argument takes the whole card back to the JSON view", () => {
  // The rule is all of the arguments or none: a row cannot hold a subtree, and a
  // dropped one is an argument the user never sees.
  for (const input of [
    { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] },
    { query: "book", filter: { status: "open", labels: ["a"] } },
    { nested: { a: 1 } },
    { list: [1, 2] },
    { deep: [{ very: { deep: true } }] },
  ]) {
    assert.equal(toolFieldsOfInput(input), null, JSON.stringify(input));
  }
});

test("nothing is invented for a call with no arguments or a non-object one", () => {
  assert.equal(toolFieldsOfInput({}), null);
  assert.equal(toolFieldsOfInput(undefined), null);
  assert.equal(toolFieldsOfInput(null), null);
  assert.equal(toolFieldsOfInput("a string"), null);
  assert.equal(toolFieldsOfInput(["a"]), null);
});

test("a collapsed card's preview reads nested arguments instead of [object Object]", () => {
  const { toolInputPreview } = toolFieldsModule;
  assert.equal(toolInputPreview({ command: "ls -la" }), "ls -la");
  assert.equal(toolInputPreview({ path: "a.ts", content: "x" }), "a.ts");
  assert.equal(toolInputPreview({ edits: [{ oldText: "a" }] }, "src/a.ts"), "src/a.ts");
  // ask_user_question: the questions' text, not "[object Object],[object Object]"
  assert.equal(toolInputPreview({
    questions: [
      { question: "Which database?", header: "DB", options: [{ label: "Postgres" }] },
      { question: "Which features?", header: "Feat", options: [] },
    ],
  }), "Which database?, Which features?");
  // A later flat argument wins over an earlier nested one.
  assert.equal(toolInputPreview({ tasks: [{ agent: "worker" }], description: "Audit the repo" }), "Audit the repo");
  assert.equal(toolInputPreview({ options: { topic: "workflows" } }), "workflows");
  assert.equal(toolInputPreview({ ids: [1, 2, 3] }), "1, 2, 3");
  assert.equal(toolInputPreview({ empty: [], none: {} }), "");
  assert.equal(toolInputPreview({ query: "x".repeat(300) }).length, 120);
});

test("a list of strings reads as itself, ahead of a later flag", () => {
  const { toolInputPreview } = toolFieldsModule;
  assert.equal(toolInputPreview({ queries: ["pi web", "pi tui"], workflow: "none" }), "pi web, pi tui");
  assert.equal(toolInputPreview({ urls: ["https://a.dev"], forceClone: true }), "https://a.dev");
  assert.equal(toolInputPreview({ paths: ["a.ts", "b.ts"] }), "a.ts, b.ts");
  assert.equal(toolInputPreview({ command: ["bash", "-lc", "ls"], workdir: "/tmp" }), "bash -lc ls");
  // Objects are read only after every argument that reads as itself.
  assert.equal(toolInputPreview({ questions: [{ question: "Q?" }], limit: 3 }), "3");
});
