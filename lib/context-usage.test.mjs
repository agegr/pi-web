import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { computeFileContextUsage, computeSessionContextUsage } = await jiti.import("./context-usage.ts");

function createTempManager(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-context-usage-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manager = SessionManager.create(dir, dir);
  manager.newSession();
  return manager;
}

const userMsg = (text) => ({ role: "user", content: text, timestamp: 1 });
const assistantMsg = (totalTokens) => ({
  role: "assistant",
  content: [{ type: "text", text: "answer" }],
  stopReason: "stop",
  usage: { input: totalTokens - 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens, cost: { total: 0 } },
  timestamp: 2,
});

test("no compaction: tokens = last assistant usage + trailing estimate", (t) => {
  const m = createTempManager(t);
  m.appendMessage(userMsg("hello"));
  m.appendMessage(assistantMsg(1000));

  const exact = computeFileContextUsage(m, undefined, 200000);
  assert.equal(exact.tokens, 1000);
  assert.equal(exact.contextWindow, 200000);
  assert.equal(exact.percent, 0.5);

  m.appendMessage(userMsg("hello again"));
  const withTrailing = computeFileContextUsage(m, undefined, 200000);
  assert.ok(withTrailing.tokens > 1000, "trailing user message adds estimated tokens");
  assert.equal(withTrailing.percent, (withTrailing.tokens / 200000) * 100);
});

test("compaction without post-compaction usage yields null tokens", (t) => {
  const m = createTempManager(t);
  m.appendMessage(userMsg("hello"));
  const a1 = m.appendMessage(assistantMsg(50000));
  m.appendCompaction("summary", a1, 50000);

  const usage = computeFileContextUsage(m, undefined, 200000);
  assert.equal(usage.tokens, null);
  assert.equal(usage.percent, null);
  assert.equal(usage.contextWindow, 200000);
});

test("compaction followed by fresh usage computes normally", (t) => {
  const m = createTempManager(t);
  m.appendMessage(userMsg("hello"));
  const a1 = m.appendMessage(assistantMsg(50000));
  m.appendCompaction("summary", a1, 50000);
  m.appendMessage(userMsg("next"));
  m.appendMessage(assistantMsg(3000));

  const usage = computeFileContextUsage(m, undefined, 200000);
  assert.equal(usage.tokens, 3000);
  assert.equal(usage.percent, 1.5);
});

test("missing or zero contextWindow returns null", (t) => {
  const m = createTempManager(t);
  m.appendMessage(userMsg("hello"));
  m.appendMessage(assistantMsg(1000));

  assert.equal(computeFileContextUsage(m, undefined, undefined), null);
  assert.equal(computeFileContextUsage(m, undefined, 0), null);
});

test("aborted trailing assistant message with a toolCall block estimates without crashing", (t) => {
  const m = createTempManager(t);
  m.appendMessage(userMsg("hello"));
  m.appendMessage(assistantMsg(1000));
  // Aborted mid-tool-call turn, raw on-disk SDK shape (name/arguments).
  m.appendMessage({
    role: "assistant",
    content: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }],
    stopReason: "aborted",
    timestamp: 3,
  });

  const usage = computeFileContextUsage(m, undefined, 200000);
  assert.equal(typeof usage.tokens, "number");
  assert.ok(usage.tokens > 1000, "trailing aborted toolCall adds estimated tokens");
});

test("computeSessionContextUsage resolves the branch model from a model_change entry", (t) => {
  const m = createTempManager(t);
  m.appendMessage(userMsg("hello"));
  m.appendModelChange("p1", "m1");
  m.appendMessage(userMsg("still on p1/m1"));

  const usage = computeSessionContextUsage(m, undefined, {
    modelList: [
      { provider: "p0", id: "m0", contextWindow: 999999 },
      { provider: "p1", id: "m1", contextWindow: 123456 },
    ],
    defaultModel: { provider: "p0", modelId: "m0" },
  });
  assert.equal(usage.contextWindow, 123456);
  assert.equal(typeof usage.tokens, "number");
});

test("session routes wire offline context usage via the shared models cache", async () => {
  const { readFile } = await import("node:fs/promises");
  const detailSource = await readFile(new URL("../app/api/sessions/[id]/route.ts", import.meta.url), "utf8");
  const contextSource = await readFile(new URL("../app/api/sessions/[id]/context/route.ts", import.meta.url), "utf8");
  const modelsRouteSource = await readFile(new URL("../app/api/models/route.ts", import.meta.url), "utf8");

  for (const source of [detailSource, contextSource]) {
    assert.match(source, /computeSessionContextUsage\(/);
    assert.match(source, /loadModelsWithCache\(/);
  }
  assert.match(modelsRouteSource, /from "@\/lib\/models-loader"/);
  assert.match(modelsRouteSource, /loadModelsWithCache\(cwd, \(\) => loadModels\(cwd\)\)/);
});
