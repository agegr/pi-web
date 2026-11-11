import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// A message's "New session" copies the branch up to that message, and the new
// session's composer starts with the message, as pi's /fork leaves it in the
// editor. handleFork writes that draft under the new session's id before the
// switch, so the composer that mounts for it finds the draft; a fork an
// extension cancelled, or one that failed, writes none.

const hookSource = (await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const hookFile = ts.createSourceFile("useAgentSession.ts", hookSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** The function a `const <name> = useCallback(fn, deps)` declaration wraps, as JavaScript. */
function callbackSource(name) {
  let found;
  const visit = (node) => {
    if (found) return;
    if (
      ts.isVariableDeclaration(node)
      && node.name.getText(hookFile) === name
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && node.initializer.expression.getText(hookFile) === "useCallback"
    ) {
      found = node.initializer.arguments[0];
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(hookFile);
  assert.ok(found, `useCallback ${name} not found`);
  return ts.transpileModule(`(${found.getText(hookFile)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.trim().replace(/;$/, "");
}

// The callback reads hook state as free variables; `with` resolves them from the scope.
const compileHandleFork = new Function("scope", `with (scope) { return ${callbackSource("handleFork")}; }`);

const DRAFT = { value: "Try it again", images: [{ data: "aW1n", mimeType: "image/png" }] };

function fork(reply) {
  const calls = { events: [], requests: [], notices: [] };
  const scope = {
    bashRunningRef: { current: false },
    sessionIdRef: { current: "source" },
    setForkingEntryId: () => {},
    sendAgentCommand: async (sid, command) => {
      calls.requests.push([sid, command]);
      return reply();
    },
    setDraft: (key, draft) => calls.events.push(["draft", key, draft]),
    onSessionForked: (id) => calls.events.push(["switch", id]),
    addNotice: (notice) => calls.notices.push(notice),
    console: { error: () => {} },
  };
  return { run: compileHandleFork(scope), calls };
}

test("a message's fork writes the message as the new session's draft before switching to it", async () => {
  const { run, calls } = fork(() => ({ newSessionId: "copy" }));
  await run("entry-1", DRAFT);
  assert.deepEqual(calls.requests, [["source", { type: "fork", entryId: "entry-1" }]]);
  assert.deepEqual(calls.events, [["draft", "copy", DRAFT], ["switch", "copy"]]);
});

test("a cancelled fork writes no draft", async () => {
  const { run, calls } = fork(() => ({ cancelled: true }));
  await run("entry-1", DRAFT);
  assert.deepEqual(calls.events, []);
});

test("a failed fork writes no draft and reports the error", async () => {
  const { run, calls } = fork(() => { throw new Error("Entry not found"); });
  await run("entry-1", DRAFT);
  assert.deepEqual(calls.events, []);
  assert.deepEqual(calls.notices, [{ type: "error", message: "Entry not found" }]);
});
