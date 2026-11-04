import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// `/export` must not hold the composer hostage either (see compact-command.test.mjs):
// runBuiltinCommand keeps the composer's <fieldset>, Stop included, disabled until
// the command resolves, and a large session's export takes seconds to arrive. The
// command completes at once; the download runs detached and only a failure is a notice.

const hookSource = (await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const hookFile = ts.createSourceFile("useAgentSession.ts", hookSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

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
const compile = new Function("scope", `with (scope) { return ${callbackSource("handleBuiltinSlashCommand")}; }`);

function hook(sessionId = "session-1") {
  const calls = { notices: [], exports: [], ensured: 0 };
  let finish;
  let fail;
  const download = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const scope = {
    sessionIdRef: { current: sessionId },
    ensureNewSession: async () => { calls.ensured += 1; return null; },
    addNotice: (notice) => calls.notices.push(notice),
    translate: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    // The download never resolves within the command's await, as a large export does not.
    downloadSessionExport: (id) => {
      calls.exports.push(id);
      return download;
    },
    opts: {},
  };
  return { run: compile(scope), calls, finish: () => finish(), fail: (error) => fail(error) };
}

test("/export completes at once and downloads detached", async () => {
  const { run, calls, finish } = hook();
  assert.deepEqual(await run("/export"), { handled: true, action: "export" });
  assert.deepEqual(calls.exports, ["session-1"]);
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  // The download is the answer: no notice, and no session started for it.
  assert.deepEqual(calls.notices, []);
  assert.equal(calls.ensured, 0);
});

test("a failed /export download is an error notice", async () => {
  const { run, calls, fail } = hook();
  assert.deepEqual(await run("/export"), { handled: true, action: "export" });
  fail(new Error("HTTP 500"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.notices, [{ type: "error", message: `chat.exportFailed ${JSON.stringify({ error: "HTTP 500" })}` }]);
});

test("/export in a fresh composer says there is nothing to export", async () => {
  const { run, calls } = hook(null);
  assert.deepEqual(await run("/export"), { handled: true, error: "chat.exportNoSession" });
  assert.deepEqual(calls.exports, []);
  assert.deepEqual(calls.notices, [{ type: "error", message: "chat.exportNoSession" }]);
});
