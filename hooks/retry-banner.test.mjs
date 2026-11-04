import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script, createContext } from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile("useAgentSession.ts", await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const nodes = [];
function visit(node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(source);

// The event handler's cases for one run that fails, waits and retries, and for a
// compaction whose summarizer call does (in source order: attempt_start falls through).
const cases = [
  "agent_end", "auto_retry_start", "agent_start", "auto_retry_end",
  "summarization_retry_scheduled", "summarization_retry_attempt_start", "summarization_retry_finished", "compaction_end",
].map((type) => {
  const clause = nodes.find((node) => ts.isCaseClause(node) && node.expression.getText(source) === `"${type}"`);
  assert.ok(clause, `missing case ${type}`);
  return clause.getText(source);
});
const handler = new Script(ts.transpileModule(`((event) => { switch (event.type) { ${cases.join("\n")} } })`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText);

function setup() {
  const banner = { current: null };
  const context = createContext({
    agentRunningRef: { current: true }, sdkAgentActiveRef: { current: true }, sessionIdRef: { current: null },
    setRetryInfo: (value) => { banner.current = value; },
    cancelEventStreamGrace() {}, setAgentRunning() {}, setAgentPhase() {}, dispatch() {}, markPromptLanded() {},
    setIsCompacting() {}, setCompactError() {}, setCompactResult() {}, readCompactResult() {}, loadSession() {},
  });
  return { handle: handler.runInContext(context), banner };
}

test("the retry banner shows while a retry waits and goes once the retried run starts", () => {
  const { handle, banner } = setup();
  handle({ type: "agent_end", willRetry: true });
  handle({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "overloaded" });
  assert.deepEqual({ ...banner.current }, { attempt: 1, maxAttempts: 3, errorMessage: "overloaded" });
  // pi emits the successful auto_retry_end only after the retry's first complete reply.
  handle({ type: "agent_start" });
  assert.equal(banner.current, null);
  handle({ type: "auto_retry_end", success: true, attempt: 1 });
  assert.equal(banner.current, null);
});

test("a summarizer's retry wait shows in the banner until its next attempt starts or the retries finish", () => {
  const { handle, banner } = setup();
  handle({ type: "summarization_retry_scheduled", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "503 overloaded" });
  assert.deepEqual({ ...banner.current }, { attempt: 1, maxAttempts: 3, errorMessage: "503 overloaded" });
  handle({ type: "summarization_retry_attempt_start", reason: "manual", source: "compaction" });
  assert.equal(banner.current, null);
  handle({ type: "summarization_retry_scheduled", attempt: 2, maxAttempts: 3, delayMs: 4000, errorMessage: "503 overloaded" });
  assert.equal(banner.current?.attempt, 2);
  handle({ type: "summarization_retry_finished" });
  assert.equal(banner.current, null);
});

test("the compaction's end clears a summarizer's banner when the stream missed its retry finishing", () => {
  const { handle, banner } = setup();
  handle({ type: "summarization_retry_scheduled", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "503 overloaded" });
  // The stream was down for summarization_retry_attempt_start and _finished.
  handle({ type: "compaction_end", reason: "manual", result: { summary: "the summary" } });
  assert.equal(banner.current, null);
});
