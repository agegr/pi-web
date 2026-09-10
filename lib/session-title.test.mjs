import assert from "node:assert/strict";
import test from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  buildSessionTitleAgentOptions,
  buildTitleTranscript,
  generateSessionTitle,
  parseGeneratedSessionTitle,
} = await jiti.import("./session-title.ts");

function assistantMessage(text) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "test",
    provider: "test",
    model: "test-model",
    usage: {
      input: 12, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 16,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function replyWith(message, observe = () => {}) {
  return (_model, context) => {
    observe(context);
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      stream.push(message.stopReason === "error"
        ? { type: "error", reason: "error", error: message }
        : { type: "done", reason: "stop", message });
    });
    return stream;
  };
}

function sourceAgent(messages) {
  return {
    state: {
      systemPrompt: "SOURCE_SYSTEM_SENTINEL",
      model: { provider: "test", id: "test-model" },
      thinkingLevel: "high",
      tools: [{
        name: "read", label: "read", description: "TOOL_SCHEMA_SENTINEL",
        parameters: { type: "object", properties: {} },
        execute: async () => { throw new Error("Source tools must not run"); },
      }],
      messages,
    },
    waitForIdle: async () => {},
    convertToLlm,
    streamFunction: replyWith(assistantMessage("Fix session titles")),
    sessionId: "source-session-id",
  };
}

const user = (content) => ({ role: "user", content, timestamp: 1 });

test("cleans common session title response wrappers", () => {
  assert.equal(parseGeneratedSessionTitle("标题：修复 SSE 重连。"), "修复 SSE 重连");
  assert.equal(parseGeneratedSessionTitle('```json\n{"title":"整理 Session 文件夹"}\n```'), "整理 Session 文件夹");
  assert.equal(parseGeneratedSessionTitle('"Improve worktree session grouping"'), "Improve worktree session grouping");
});

test("rejects responses without a usable title", () => {
  assert.throws(() => parseGeneratedSessionTitle("```\n---\n```"), /usable session title/);
});

test("sends one text-only title request without source context or source mutation", async () => {
  const source = sourceAgent([
    user([{ type: "text", text: "Fix session titles" }, { type: "image", data: "IMAGE_SENTINEL", mimeType: "image/png" }]),
    { ...assistantMessage("Investigating"), content: [
      { type: "text", text: "Investigating" },
      { type: "thinking", thinking: "THINKING_SENTINEL" },
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: "TOOL_ARGUMENT_SENTINEL" } },
      { type: "toolCall", id: "incomplete", name: "read", arguments: {} },
    ] },
    { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "TOOL_RESULT_SENTINEL".repeat(10000) }], isError: false, timestamp: 2 },
    user("Keep the new goal in the title"),
  ]);
  const before = structuredClone(source.state.messages);
  let seen;
  source.streamFunction = replyWith(assistantMessage("Fix session titles"), (context) => { seen = context; });
  const result = await generateSessionTitle({ agent: source });
  assert.equal(result.title, "Fix session titles");
  assert.deepEqual(result.usage, { input: 12, output: 4, cacheRead: 0, cacheWrite: 0, total: 16 });
  assert.deepEqual(seen.messages.map((message) => message.role), ["user"]);
  assert.equal(seen.tools?.length ?? 0, 0);
  const payload = JSON.stringify(seen);
  assert.match(payload, /User: Fix session titles/);
  assert.match(payload, /Assistant: Investigating/);
  assert.match(payload, /Keep the new goal in the title/);
  assert.match(payload, /Create a concise title/);
  assert.doesNotMatch(payload, /SENTINEL/);
  assert.deepEqual(source.state.messages, before);
});

test("waits for the source reply before sending the title prompt", async () => {
  const source = sourceAgent([user("Implement auto name")]);
  let finished = false;
  source.waitForIdle = async () => {
    source.state.messages.push(assistantMessage("The implementation is complete"));
    finished = true;
  };
  source.streamFunction = replyWith(assistantMessage("Wait for Complete Agent Reply"), (context) => {
    assert.equal(finished, true);
    assert.deepEqual(context.messages.map((message) => message.role), ["user"]);
    assert.match(JSON.stringify(context.messages), /The implementation is complete/);
  });
  assert.equal((await generateSessionTitle({ agent: source })).title, "Wait for Complete Agent Reply");
});

test("generates a title when compaction removed all literal user messages", async () => {
  const source = sourceAgent([{
    role: "compactionSummary", summary: "Fix title generation after compaction.", tokensBefore: 100000, timestamp: 1,
  }, assistantMessage("The implementation is complete")]);
  source.streamFunction = replyWith(assistantMessage("Title Generation After Compaction"), (context) => {
    assert.deepEqual(context.messages.map((message) => message.role), ["user"]);
    assert.match(JSON.stringify(context.messages), /Earlier summary.*Fix title generation after compaction/);
  });
  assert.equal((await generateSessionTitle({ agent: source })).title, "Title Generation After Compaction");
});

test("temporary title agent changes context, not model or transport settings", () => {
  const source = sourceAgent([user("Fix it")]);
  source.getApiKey = async () => "test-key";
  source.transformContext = async (messages) => messages;
  source.transport = "sse";
  const options = buildSessionTitleAgentOptions(source);
  assert.notEqual(options.initialState.systemPrompt, source.state.systemPrompt);
  assert.equal(options.initialState.model, source.state.model);
  assert.equal(options.initialState.thinkingLevel, "high");
  assert.deepEqual(options.initialState.tools, []);
  assert.deepEqual(options.initialState.messages, []);
  assert.equal(options.convertToLlm, convertToLlm);
  assert.equal(options.transformContext, source.transformContext);
  assert.equal(options.streamFn, source.streamFunction);
  assert.equal(options.getApiKey, source.getApiKey);
  assert.equal(options.transport, "sse");
  assert.equal(options.sessionId, source.sessionId);
});

test("caps text by Unicode code points while retaining user turns and the last nonempty reply", () => {
  const messages = [
    user("😀".repeat(801)),
    assistantMessage("a".repeat(301)),
    user("A mid-session change of goal"),
    { role: "compactionSummary", summary: "s".repeat(601), tokensBefore: 1000, timestamp: 1 },
    assistantMessage("z".repeat(601)),
    assistantMessage("  "),
    { role: "toolResult", content: [{ type: "text", text: "ignored" }] },
    user("The final user request"),
  ];
  assert.equal(buildTitleTranscript(messages), [
    `User: ${"😀".repeat(800)}…`,
    `Assistant: ${"a".repeat(300)}…`,
    "User: A mid-session change of goal",
    `[Earlier summary] ${"s".repeat(600)}…`,
    `Assistant: ${"z".repeat(600)}…`,
    "User: The final user request",
  ].join("\n\n"));
  assert.equal(buildTitleTranscript([user("x".repeat(800))]), `User: ${"x".repeat(800)}`);
  assert.equal(buildTitleTranscript([user([]), assistantMessage("")]), "");
});

test("rejects a session without a user message or summary", async () => {
  await assert.rejects(generateSessionTitle({ agent: sourceAgent([]) }), /no user messages/);
});

test("propagates title provider errors", async () => {
  const source = sourceAgent([user("Fix it")]);
  source.streamFunction = replyWith({ ...assistantMessage(""), stopReason: "error", errorMessage: "Provider unavailable" });
  await assert.rejects(generateSessionTitle({ agent: source }), /Provider unavailable/);
});
