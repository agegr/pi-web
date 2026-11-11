import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// `/clone` asks pi's `session_before_fork` handlers, as pi's /clone does. A handler's
// cancel (`byExtension`) says nothing more, as in pi; only the server's own refusal of
// an empty or unsaved session is reported. These tests run the hook's own callback,
// taken from its source, against stubbed state.

const read = async (path) => (await readFile(new URL(path, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const hookSource = await read("./useAgentSession.ts");
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
const compiled = new Function("scope", `with (scope) { return ${callbackSource("handleBuiltinSlashCommand")}; }`);

function hook(reply) {
  const calls = { notices: [], requests: [], forked: [] };
  const scope = {
    sessionIdRef: { current: "session-1" },
    ensureNewSession: async () => "session-1",
    addNotice: (notice) => calls.notices.push(notice),
    agentRunningRef: { current: false },
    bashRunningRef: { current: false },
    activeLeafId: "leaf-1",
    appendedLeafRef: { current: null },
    entryIdsRef: { current: [] },
    onSessionForked: (id) => calls.forked.push(id),
    sendAgentCommand: async (sid, command) => {
      calls.requests.push(command);
      return reply;
    },
  };
  return { run: compiled(scope), calls };
}

test("a /clone a session_before_fork handler cancelled says nothing and opens no copy", async () => {
  const { run, calls } = hook({ cancelled: true, byExtension: true });
  assert.deepEqual(await run("/clone"), { handled: true });
  assert.deepEqual(calls.requests, [{ type: "clone", leafId: "leaf-1" }]);
  assert.deepEqual(calls.notices, []);
  assert.deepEqual(calls.forked, []);
});

test("/clone of an empty or unsaved session is still reported", async () => {
  const { run, calls } = hook({ cancelled: true });
  assert.deepEqual(await run("/clone"), { handled: true, error: "Cannot clone an empty or unsaved session" });
  assert.deepEqual(calls.notices, [{ type: "error", message: "Cannot clone an empty or unsaved session" }]);
  assert.deepEqual(calls.forked, []);
});

test("/clone opens the copy", async () => {
  const { run, calls } = hook({ cancelled: false, newSessionId: "session-2" });
  assert.deepEqual(await run("/clone"), { handled: true, message: "Cloned current session branch" });
  assert.deepEqual(calls.forked, ["session-2"]);
});
