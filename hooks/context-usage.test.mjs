import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script, createContext } from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";

const { agentStatusUrl } = await createJiti(import.meta.url, { interopDefault: true }).import("../lib/agent-client.ts");

const source = ts.createSourceFile("useAgentSession.ts", await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const nodes = [];
function visit(node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(source);
function callback(name) {
  const node = nodes.find((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === name);
  assert.ok(node, `missing ${name}`);
  return new Script(ts.transpileModule(`(${node.initializer.arguments[0].getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText);
}
function setup() {
  const writes = [];
  const activeWrites = [];
  const requests = [];
  const context = createContext({
    sessionHookMountedRef: { current: true }, sessionIdRef: { current: "a" },
    promptRunIdRef: { current: 1 }, contextUsageRequestIdRef: { current: 0 }, contextUsageAppliedIdRef: { current: 0 },
    agentRunningRef: { current: true }, sdkAgentActiveRef: { current: true }, rpcPromptPendingRef: { current: true },
    setContextUsage: (value) => writes.push(value),
    setLiveTotalActiveMs: (value) => activeWrites.push({ sessionId: value.sessionId, value: value.value }), agentStatusUrl,
    fetch: (url) => { const request = Promise.withResolvers(); requests.push({ ...request, url }); return request.promise; },
    syncLiveModel() {}, setIsCompacting() {}, setAutoCompactionEnabled() {}, setQueuedMessages() {},
    normalizeQueuedMessages: (value) => value, finishPromptWithoutStream: () => { throw new Error("busy run settled"); },
  });
  context.applyLiveUsage = callback("applyLiveUsage").runInContext(context);
  context.refreshContextUsage = callback("refreshContextUsage").runInContext(context);
  context.reconcileAgentState = callback("reconcileAgentState").runInContext(context);
  const reply = (index, usage, busy = true, totalActiveMs) => requests[index].resolve(Response.json({ running: busy, state: { contextUsage: usage, totalActiveMs, isStreaming: busy, isPromptRunning: busy } }));
  return { context, writes, activeWrites, requests, reply };
}
const usage = (tokens) => ({ percent: tokens / 100, contextWindow: 10_000, tokens });

test("a busy reconciliation refreshes context usage without settling the run", async () => {
  const state = setup();
  const pending = state.context.reconcileAgentState("a");
  state.reply(0, usage(100));
  await pending;
  assert.deepEqual(state.writes, [usage(100)]);
  assert.equal(state.context.agentRunningRef.current, true);
  // Status reads leave out the system prompt, nearly all of the state (#1302).
  assert.equal(state.requests[0].url, "/api/agent/a?systemPrompt=0");
});

test("a usage read also carries the live active time, keyed to its session", async () => {
  const state = setup();
  const pending = state.context.reconcileAgentState("a");
  state.reply(0, usage(100), true, 112_900_000);
  await pending;
  assert.deepEqual(state.activeWrites, [{ sessionId: "a", value: 112_900_000 }]);
  // A read without the field leaves the last value alone.
  const later = state.context.refreshContextUsage("a");
  state.reply(1, usage(200));
  await later;
  assert.deepEqual(state.activeWrites, [{ sessionId: "a", value: 112_900_000 }]);
});

test("a newer assistant usage read wins over a delayed poll", async () => {
  const state = setup();
  const poll = state.context.reconcileAgentState("a");
  const refresh = state.context.refreshContextUsage("a");
  state.reply(1, usage(200)); await refresh;
  state.reply(0, usage(100)); await poll;
  assert.deepEqual(state.writes, [usage(200)]);
});

test("a failed newer read does not discard an older poll's usage", async () => {
  const state = setup();
  const poll = state.context.reconcileAgentState("a");
  const refresh = state.context.refreshContextUsage("a");
  state.requests[1].resolve(new Response("Unavailable", { status: 503 })); await refresh;
  state.reply(0, usage(100)); await poll;
  assert.deepEqual(state.writes, [usage(100)]);
});

test("usage replies from an old run, another session or an unmounted hook are ignored", async () => {
  for (const invalidate of [
    (ctx) => { ctx.promptRunIdRef.current++; },
    (ctx) => { ctx.sessionIdRef.current = "b"; },
    (ctx) => { ctx.sessionHookMountedRef.current = false; },
    (ctx) => { ctx.contextUsageAppliedIdRef.current = ctx.contextUsageRequestIdRef.current; },
  ]) {
    const state = setup();
    const pending = state.context.refreshContextUsage("a");
    invalidate(state.context); state.reply(0, usage(100)); await pending;
    assert.deepEqual(state.writes, []);
  }
});

test("failed reads preserve usage and a subsequent read can recover", async () => {
  const state = setup();
  const failed = state.context.refreshContextUsage("a");
  state.requests[0].resolve(new Response("Unavailable", { status: 503 })); await failed;
  const broken = state.context.refreshContextUsage("a");
  state.requests[1].reject(new TypeError("offline")); await broken;
  assert.deepEqual(state.writes, []);
  const recovered = state.context.refreshContextUsage("a");
  state.reply(2, null); await recovered;
  assert.deepEqual(state.writes, [null]);
});

function usageReads(clause) {
  return nodes.filter((node) => ts.isCallExpression(node) && node.expression.getText(source) === "refreshContextUsage"
    && node.pos >= clause.pos && node.end <= clause.end);
}

function guardingConditions(node, clause) {
  const conditions = [];
  for (let child = node, parent = node.parent; parent && parent !== clause; child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent) && parent.thenStatement === child) conditions.push(parent.expression.getText(source));
  }
  return conditions;
}

test("only completed assistant messages trigger an immediate usage read", () => {
  const messageEnd = nodes.find((node) => ts.isCaseClause(node) && node.expression.getText(source) === '"message_end"');
  const reads = usageReads(messageEnd);
  assert.equal(reads.length, 1);
  const conditions = guardingConditions(reads[0], messageEnd);
  assert.ok(conditions.includes('completed.role === "assistant"'));
  assert.ok(conditions.includes("sid"));
  assert.equal(reads[0].arguments[0].getText(source), "sid");
});

test("each event stream connection reads usage, since connecting resumes an idle-reaped session", () => {
  const connected = nodes.find((node) => ts.isCaseClause(node) && node.expression.getText(source) === '"connected"');
  const reads = usageReads(connected);
  assert.equal(reads.length, 1);
  assert.deepEqual(guardingConditions(reads[0], connected), ["sessionIdRef.current"]);
  assert.equal(reads[0].arguments[0].getText(source), "sessionIdRef.current");
});
