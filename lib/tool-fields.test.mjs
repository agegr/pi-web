import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { EMPTY_FIELD_VALUE, toolFieldsOfInput } = await jiti.import("./tool-fields.ts");

const keys = (fields) => fields?.map((field) => field.key);
const valueOf = (fields, key) => fields?.find((field) => field.key === key)?.value;

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
