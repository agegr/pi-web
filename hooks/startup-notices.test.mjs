import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createShownNotices, extensionErrorMessage } from "../lib/startup-issues.ts";

// A session's wrapper tells its startup issues to every stream it opens, under the same ids
// (lib/rpc-manager.ts); the page shows each once. These tests run the hook's own code, taken
// from its source, against stubbed state.

const hookSource = (await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const hookFile = ts.createSourceFile("useAgentSession.ts", hookSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const nodes = [];
(function visit(node) { nodes.push(node); ts.forEachChild(node, visit); })(hookFile);

const transpile = (code) => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.trim().replace(/;$/, "");

const handleExtensionUiRequest = nodes.find((node) => ts.isVariableDeclaration(node)
  && node.name.getText(hookFile) === "handleExtensionUiRequest"
  && node.initializer && ts.isCallExpression(node.initializer));
assert.ok(handleExtensionUiRequest, "handleExtensionUiRequest not found");
const compiledUiRequest = new Function("scope", `with (scope) { return ${transpile(`(${handleExtensionUiRequest.initializer.arguments[0].getText(hookFile)})`)}; }`);

const extensionErrorCase = nodes.find((node) => ts.isCaseClause(node) && node.expression.getText(hookFile) === "\"extension_error\"");
assert.ok(extensionErrorCase, "missing case extension_error");
const compiledEventCase = new Function("scope", `with (scope) { return ${transpile(`((event) => { switch (event.type) { ${extensionErrorCase.getText(hookFile)} } })`)}; }`);

function setup() {
  const notices = [];
  const scope = {
    addNotice: (notice) => notices.push(notice),
    isFirstNoticeShowing: createShownNotices(),
    isBlockingExtensionUiRequest: () => false,
    onAttentionNeeded: undefined,
    stripAnsi: (text) => text,
    extensionErrorMessage,
  };
  return { notices, handleRequest: compiledUiRequest(scope), handleEvent: compiledEventCase(scope) };
}

test("a startup notice a stream replays shows once on the page", () => {
  const { notices, handleRequest } = setup();
  const notice = { type: "extension_ui_request", id: "startup-1", method: "notify", notifyType: "error", message: "Failed to load extension: boom" };
  handleRequest(notice);
  // The stream reconnected, or the page came back to the session.
  handleRequest({ ...notice });
  handleRequest({ ...notice, id: "other" });
  assert.deepEqual(notices.map((item) => item.id), ["startup-1", "other"]);
});

test("an extension error names its extension as pi's TUI does", () => {
  const { notices, handleEvent } = setup();
  handleEvent({ type: "extension_error", extensionPath: "/ext/a.js", event: "turn_start", error: "boom" });
  handleEvent({ type: "extension_error", event: "turn_start" });
  assert.deepEqual(notices.map((item) => item.message), ["Extension \"/ext/a.js\" error: boom", "Extension command failed"]);
});
