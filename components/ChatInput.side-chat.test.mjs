import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function callback(file, name) {
  const source = ts.createSourceFile(file, file === "ChatInput.tsx" ? input : windowSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) return node.initializer.arguments[0];
    return ts.forEachChild(node, find);
  }
  return ts.transpileModule(find(source).getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
}

const input = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const windowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("side button opens blank and sends a typed draft; images stay untouched", () => {
  const run = (value, attachedImages = []) => {
    const calls = [];
    const context = { value, attachedImages, onSideChat: (message) => calls.push(message), clearInput: () => calls.push("cleared") };
    vm.runInNewContext(callback("ChatInput.tsx", "sendToSideChat"), context)();
    return calls;
  };
  assert.deepEqual(run(""), [""]);
  assert.deepEqual(run(" question "), ["cleared", "question"]);
  assert.deepEqual(run("", [{}]), []);
  assert.match(input, /disabled=\{attachedImages\.length > 0\}/);
  assert.match(input, /title=\{value\.trim\(\) \? t\("chat\.sideChatHint"\) : t\("sideChat\.new"\)\}/);
});

test("an empty side button click forks without a prompt", async () => {
  const calls = [];
  const context = {
    startSideChat: async (prompt) => { calls.push(prompt); return null; },
    chatInputRef: null,
    addNotice: () => {},
  };
  await vm.runInNewContext(callback("ChatWindow.tsx", "askInSideChat"), context)("");
  assert.deepEqual(calls, [null]);
});
