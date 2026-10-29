import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// `/compact` must not hold the composer hostage. runBuiltinCommand keeps the
// composer's <fieldset> disabled until the builtin command resolves, and a
// manual compaction is a blocking POST for the whole compaction, so awaiting it
// in the command handler left the input box dead until a remount. The command
// completes at once and runs the compaction detached (the Compact button's
// handleCompact), which reports itself: Compacting status, Stop compaction,
// result banner, error.

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

const CALLBACKS = ["handleCompact", "handleBuiltinSlashCommand"];
const compiled = Object.fromEntries(CALLBACKS.map((name) => [
  name,
  // The callbacks read hook state as free variables; `with` resolves them from the scope.
  new Function("scope", `with (scope) { return ${callbackSource(name)}; }`),
]));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function hook() {
  const calls = { notices: [], compacting: [], compactErrors: [], compactResults: [], requests: [], promoted: 0, restored: [] };
  const compact = deferred();
  const scope = {
    sessionIdRef: { current: "session-1" },
    ensureNewSession: async () => "session-1",
    addNotice: (notice) => calls.notices.push(notice),
    isCompacting: false,
    setIsCompacting: (value) => calls.compacting.push(value),
    setCompactError: (error) => calls.compactErrors.push(error),
    setCompactResult: (result) => calls.compactResults.push(result),
    readCompactResult: (result) => result,
    // The compact POST blocks for the whole compaction, as the real one does.
    sendAgentCommand: (sid, command) => {
      calls.requests.push(command);
      return compact.promise;
    },
    loadSession: async () => true,
    promoteNewSession: () => { calls.promoted += 1; },
    opts: { chatInputRef: { current: { prependText: (text) => calls.restored.push(text) } } },
  };
  for (const name of CALLBACKS) scope[name] = compiled[name](scope);
  return { run: scope.handleBuiltinSlashCommand, calls, finishCompaction: compact.resolve, failCompaction: compact.reject };
}

test("/compact completes at once and runs the compaction detached", async () => {
  const { run, calls, finishCompaction } = hook();
  // The compact POST never resolves within this await: the command must still return.
  assert.deepEqual(await run("/compact"), { handled: true, action: "compact" });
  // No completion notice: the compaction's own UI is the answer.
  assert.deepEqual(calls.notices, []);
  // The detached compaction started and holds the Compacting state meanwhile.
  assert.deepEqual(calls.compacting, [true]);
  assert.deepEqual(calls.requests.map((command) => command.type), ["compact"]);

  finishCompaction({ tokensBefore: 10 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.compacting, [true, false]);
  // The reset at the start, then the compaction's own result banner.
  assert.deepEqual(calls.compactResults, [null, { tokensBefore: 10 }]);
  assert.equal(calls.promoted, 1);
});

test("/compact passes its instructions to the detached compaction", async () => {
  const { run, calls, finishCompaction } = hook();
  assert.deepEqual(await run("/compact keep the tests"), { handled: true, action: "compact" });
  assert.equal(calls.requests[0].customInstructions, "keep the tests");
  finishCompaction({});
  await new Promise((resolve) => setImmediate(resolve));
});

test("/compact gives its instructions back when the compaction fails", async () => {
  const { run, calls, failCompaction } = hook();
  await run("/compact keep the tests");
  failCompaction(new Error("Nothing to compact (session too small)"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.compactErrors.at(-1), "Nothing to compact (session too small)");
  assert.deepEqual(calls.restored, ["/compact keep the tests"]);
});
