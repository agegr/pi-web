import assert from "node:assert/strict";
import test from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  appendTitleRequestToTrailingUser,
  buildSessionTitleAgentOptions,
  generateSessionTitle,
  parseGeneratedSessionTitle,
  sanitizeTitleMessages,
} = await jiti.import("./session-title.ts");

function assistantMessage(text) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "test",
    provider: "test",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

test("cleans common session title response wrappers", () => {
  assert.equal(parseGeneratedSessionTitle("标题：修复 SSE 重连。"), "修复 SSE 重连");
  assert.equal(
    parseGeneratedSessionTitle('```json\n{"title":"整理 Session 文件夹"}\n```'),
    "整理 Session 文件夹",
  );
  assert.equal(
    parseGeneratedSessionTitle('"Improve worktree session grouping"'),
    "Improve worktree session grouping",
  );
});

test("rejects responses without a usable title", () => {
  assert.throws(() => parseGeneratedSessionTitle("```\n---\n```"), /usable session title/);
});

test("folds the title request into a trailing user message without mutating the source", () => {
  const source = [
    { role: "assistant", content: [], timestamp: 1 },
    {
      role: "user",
      content: [{ type: "text", text: "Fix the running-session race" }],
      timestamp: 2,
    },
  ];

  const prepared = appendTitleRequestToTrailingUser(source);

  assert.deepEqual(
    prepared.map((message) => message.role),
    ["assistant", "user"],
  );
  assert.match(prepared[1].content.at(-1).text, /Create a concise title/);
  assert.equal(source[1].content.length, 1);
  assert.notEqual(prepared[1], source[1]);
});

test("leaves a completed conversation unchanged before adding the title turn", () => {
  const source = [
    { role: "user", content: "Fix it", timestamp: 1 },
    { role: "assistant", content: [], timestamp: 2 },
  ];

  assert.equal(appendTitleRequestToTrailingUser(source), source);
});

test("waits for the source reply before sending the title prompt", async () => {
  let sourceReplyFinished = false;
  let providerRoles;
  const sourceAgent = {
    state: {
      systemPrompt: "system",
      model: { provider: "test", id: "test-model" },
      thinkingLevel: "off",
      tools: [],
      messages: [{ role: "user", content: "Implement auto name", timestamp: 1 }],
    },
    waitForIdle: async () => {
      sourceAgent.state.messages.push(assistantMessage("The implementation is complete"));
      sourceReplyFinished = true;
    },
    convertToLlm: (messages) => messages,
    streamFunction: (_model, context) => {
      assert.equal(sourceReplyFinished, true);
      providerRoles = context.messages.map((message) => message.role);
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message: assistantMessage("Wait for Complete Agent Reply"),
        });
      });
      return stream;
    },
    sessionId: "source-session-id",
  };

  const result = await generateSessionTitle({ agent: sourceAgent });

  assert.equal(result.title, "Wait for Complete Agent Reply");
  assert.deepEqual(providerRoles, ["user", "assistant", "user"]);
});

test("temporary title agent preserves the provider-facing prefix", async () => {
  const model = { provider: "test", id: "cached-model" };
  const messages = [{ role: "user", content: [{ type: "text", text: "Fix it" }] }];
  const originalExecute = async () => ({ content: [], details: {} });
  const tools = [
    {
      name: "read",
      label: "read",
      description: "Read a file",
      parameters: { type: "object", properties: {} },
      execute: originalExecute,
    },
  ];
  const convertToLlm = (value) => value;
  const transformContext = async (value) => value;
  const streamFunction = () => {
    throw new Error("not called");
  };
  const source = {
    state: {
      systemPrompt: "cached system prompt",
      model,
      thinkingLevel: "high",
      tools,
      messages,
    },
    convertToLlm,
    transformContext,
    streamFunction,
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
    sessionId: "source-session-id",
    transport: "sse",
    toolExecution: "parallel",
  };

  const options = buildSessionTitleAgentOptions(source);

  assert.equal(options.initialState.systemPrompt, source.state.systemPrompt);
  assert.equal(options.initialState.model, model);
  assert.equal(options.initialState.thinkingLevel, "high");
  assert.equal(options.initialState.messages, messages);
  assert.equal(options.convertToLlm, convertToLlm);
  assert.equal(options.transformContext, transformContext);
  assert.equal(options.streamFn, streamFunction);
  assert.equal(options.sessionId, "source-session-id");
  const withoutExecute = (tool) =>
    Object.fromEntries(Object.entries(tool).filter(([key]) => key !== "execute"));
  assert.deepEqual(options.initialState.tools.map(withoutExecute), tools.map(withoutExecute));
  assert.notEqual(options.initialState.tools[0].execute, originalExecute);
  await assert.rejects(
    options.initialState.tools[0].execute("call", {}, undefined, undefined),
    /cannot be executed/,
  );
});

test("keeps only tool calls with adjacent matching results", () => {
  const messages = [
    { role: "user", content: "inspect both files", timestamp: 1 },
    {
      ...assistantMessage("Inspecting files"),
      content: [
        { type: "text", text: "Inspecting files" },
        { type: "toolCall", id: "call-complete", name: "read", arguments: { path: "a.txt" } },
        { type: "toolCall", id: "call-incomplete", name: "read", arguments: { path: "b.txt" } },
      ],
      stopReason: "toolUse",
    },
    {
      role: "toolResult",
      toolCallId: "call-complete",
      toolName: "read",
      content: [{ type: "text", text: "file contents" }],
      isError: false,
      timestamp: 2,
    },
  ];

  const sanitized = sanitizeTitleMessages(messages);

  assert.deepEqual(
    sanitized[1].content.filter((block) => block.type === "toolCall").map((block) => block.id),
    ["call-complete"],
  );
  assert.equal(sanitized[2], messages[2]);
  assert.equal(messages[1].content.length, 3);
});

test("removes incomplete tool calls before invoking the title provider", async () => {
  let providerMessages;
  const sourceAgent = {
    state: {
      systemPrompt: "system",
      model: { provider: "test", id: "test-model" },
      thinkingLevel: "off",
      tools: [],
      messages: [
        { role: "user", content: "run a command", timestamp: 1 },
        {
          ...assistantMessage(""),
          content: [
            {
              type: "toolCall",
              id: "call-incomplete",
              name: "bash",
              arguments: { command: "sleep 10" },
            },
          ],
          stopReason: "toolUse",
        },
      ],
    },
    waitForIdle: async () => {},
    convertToLlm: (messages) => messages,
    streamFunction: (_model, context) => {
      providerMessages = context.messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({
          type: "done",
          reason: "stop",
          message: assistantMessage("Sanitized Tool Call History"),
        });
      });
      return stream;
    },
    sessionId: "source-session-id",
  };

  const result = await generateSessionTitle({ agent: sourceAgent });

  assert.equal(result.title, "Sanitized Tool Call History");
  assert.deepEqual(
    providerMessages.map((message) => message.role),
    ["user"],
  );
  assert.match(providerMessages[0].content, /Create a concise title/);
});
