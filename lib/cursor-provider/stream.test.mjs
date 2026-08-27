import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import { create, fromJson, toBinary } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  AgentServerMessageSchema,
  ConversationStateStructureSchema,
  ExecServerMessageSchema,
  InteractionUpdateSchema,
  McpArgsSchema,
  TextDeltaUpdateSchema,
} = await jiti.import("./proto/agent_pb.ts");
const {
  __testInternals,
  accountCacheKey,
  cleanupSessionState,
  mapConnectErrorCode,
  parseContext,
  setCursorBridgeFactoryForTests,
  streamCursor,
  turnsFingerprint,
} = await jiti.import("./stream.ts");

const model = {
  id: "grok-4.6",
  name: "Grok 4.6",
  api: "openai-completions",
  provider: "cursor",
  baseUrl: "https://api2.cursor.sh",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 256_000,
  maxTokens: 64_000,
};

function endStreamFrame(payload = new Uint8Array()) {
  const frame = Buffer.alloc(5 + payload.length);
  frame[0] = 0b0000_0010;
  frame.writeUInt32BE(payload.length, 1);
  frame.set(payload, 5);
  return frame;
}

function messageFrame(message) {
  const payload = toBinary(AgentServerMessageSchema, message);
  const frame = Buffer.alloc(5 + payload.length);
  frame.writeUInt32BE(payload.length, 1);
  frame.set(payload, 5);
  return frame;
}

function textMessage(text) {
  return create(AgentServerMessageSchema, {
    message: {
      case: "interactionUpdate",
      value: create(InteractionUpdateSchema, {
        message: {
          case: "textDelta",
          value: create(TextDeltaUpdateSchema, { text }),
        },
      }),
    },
  });
}

function toolMessage() {
  const args = create(McpArgsSchema, {
    name: "bash",
    toolName: "bash",
    toolCallId: "call-1",
    providerIdentifier: "pi",
    args: {
      command: toBinary(ValueSchema, fromJson(ValueSchema, "pwd")),
    },
  });
  return create(AgentServerMessageSchema, {
    message: {
      case: "execServerMessage",
      value: create(ExecServerMessageSchema, {
        id: 7,
        execId: "exec-1",
        message: { case: "mcpArgs", value: args },
      }),
    },
  });
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("condition was not reached");
}

function createMockBridge() {
  let alive = true;
  let dataCallback;
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  const writes = [];
  return {
    bridge: {
      get alive() { return alive; },
      response: Promise.resolve({ status: 200, headers: { "x-test": "ok" } }),
      closed,
      write(data) { writes.push(Buffer.from(data)); },
      end() {
        if (!alive) return;
        alive = false;
        resolveClosed({ status: 200 });
      },
      destroy(error) {
        if (!alive) return;
        alive = false;
        resolveClosed({ status: 200, error });
      },
      onData(callback) { dataCallback = callback; },
    },
    writes,
    emitData(data) { dataCallback(data); },
    hasDataHandler() { return typeof dataCallback === "function"; },
  };
}

test("parses Pi context directly and keeps tool continuations open", () => {
  const parsed = parseContext({
    systemPrompt: "",
    tools: [],
    messages: [
      { role: "user", content: "run it", timestamp: 1 },
      {
        ...model,
        role: "assistant",
        content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "pwd" } }],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "toolUse",
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "bash",
        content: [{ type: "text", text: "/tmp" }],
        isError: false,
        timestamp: 3,
      },
    ],
  });
  assert.equal(parsed.systemPrompt, "");
  assert.equal(parsed.turns.length, 0);
  assert.equal(parsed.openTurn.steps.length, 1);
  assert.deepEqual(parsed.toolResults, [{ toolCallId: "call-1", content: "/tmp", isError: false }]);
});

test("streams through the custom provider without a loopback HTTP proxy", async () => {
  const mock = createMockBridge();
  setCursorBridgeFactoryForTests(async () => mock.bridge);
  let payloadCalls = 0;
  let responseStatus;
  try {
    const stream = streamCursor(
      model,
      { messages: [{ role: "user", content: "hello", timestamp: 1 }] },
      {
        apiKey: "token",
        sessionId: "stream-test-session",
        onPayload(payload) {
          payloadCalls++;
          return payload;
        },
        onResponse(response) {
          responseStatus = response.status;
        },
      },
    );
    const result = stream.result();
    await waitFor(() => mock.hasDataHandler());
    mock.emitData(messageFrame(textMessage("hello")));
    mock.emitData(endStreamFrame());
    const message = await result;
    assert.equal(message.stopReason, "stop");
    assert.equal(message.content[0].text, "hello");
    assert.equal(payloadCalls, 1);
    assert.equal(responseStatus, 200);
    assert.ok(mock.writes.length >= 1);
  } finally {
    cleanupSessionState("stream-test-session");
    setCursorBridgeFactoryForTests();
  }
});

test("keeps one HTTP/2 stream across a tool call and its result", async () => {
  const mock = createMockBridge();
  let bridgeStarts = 0;
  setCursorBridgeFactoryForTests(async () => {
    bridgeStarts++;
    return mock.bridge;
  });
  const sessionId = "tool-resume-session";
  try {
    const first = streamCursor(
      model,
      {
        tools: [{ name: "bash", description: "Run a command", parameters: { type: "object", properties: {} } }],
        messages: [{ role: "user", content: "where am I", timestamp: 1 }],
      },
      { apiKey: "token", sessionId },
    );
    const firstResult = first.result();
    await waitFor(() => mock.hasDataHandler());
    mock.emitData(messageFrame(toolMessage()));
    const toolCall = await firstResult;
    assert.equal(toolCall.stopReason, "toolUse");
    assert.equal(toolCall.content[0].name, "bash");

    const second = streamCursor(
      model,
      {
        tools: [{ name: "bash", description: "Run a command", parameters: { type: "object", properties: {} } }],
        messages: [
          { role: "user", content: "where am I", timestamp: 1 },
          { ...toolCall, timestamp: 2 },
          {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "bash",
            content: [{ type: "text", text: "/tmp" }],
            isError: false,
            timestamp: 3,
          },
        ],
      },
      { apiKey: "token", sessionId },
    );
    const secondResult = second.result();
    await new Promise((resolve) => setImmediate(resolve));
    mock.emitData(messageFrame(textMessage("You are in /tmp")));
    mock.emitData(endStreamFrame());
    const completed = await secondResult;
    assert.equal(completed.stopReason, "stop");
    assert.equal(completed.content[0].text, "You are in /tmp");
    assert.equal(bridgeStarts, 1);
  } finally {
    cleanupSessionState(sessionId);
    setCursorBridgeFactoryForTests();
  }
});

test("fails promptly if the bridge closes while tool results resume", async () => {
  const mock = createMockBridge();
  const sessionId = "tool-resume-close-session";
  setCursorBridgeFactoryForTests(async () => mock.bridge);
  try {
    const first = streamCursor(
      model,
      {
        tools: [{ name: "bash", description: "Run a command", parameters: { type: "object", properties: {} } }],
        messages: [{ role: "user", content: "where am I", timestamp: 1 }],
      },
      { apiKey: "token", sessionId },
    );
    const firstResult = first.result();
    await waitFor(() => mock.hasDataHandler());
    mock.emitData(messageFrame(toolMessage()));
    const toolCall = await firstResult;

    const second = streamCursor(
      model,
      {
        tools: [{ name: "bash", description: "Run a command", parameters: { type: "object", properties: {} } }],
        messages: [
          { role: "user", content: "where am I", timestamp: 1 },
          { ...toolCall, timestamp: 2 },
          {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "bash",
            content: [{ type: "text", text: "/tmp" }],
            isError: false,
            timestamp: 3,
          },
        ],
      },
      {
        apiKey: "token",
        sessionId,
        async onResponse() {
          mock.bridge.destroy(new Error("connection dropped"));
          await new Promise((resolve) => setImmediate(resolve));
        },
      },
    );
    const result = await Promise.race([
      second.result(),
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error("resume did not finish promptly")), 100);
      }),
    ]);
    assert.equal(result.stopReason, "error");
    assert.match(result.errorMessage, /connection lost while resuming/);
  } finally {
    cleanupSessionState(sessionId);
    setCursorBridgeFactoryForTests();
  }
});

test("does not commit a checkpoint when Connect ends with an error", async () => {
  const mock = createMockBridge();
  const sessionId = "connect-error-session";
  setCursorBridgeFactoryForTests(async () => mock.bridge);
  try {
    const stream = streamCursor(
      model,
      { messages: [{ role: "user", content: "hello", timestamp: 1 }] },
      { apiKey: "token", sessionId },
    );
    const result = stream.result();
    await waitFor(() => mock.hasDataHandler());
    const checkpoint = create(ConversationStateStructureSchema, {
      turns: [new Uint8Array([1, 2, 3])],
    });
    mock.emitData(messageFrame(create(AgentServerMessageSchema, {
      message: { case: "conversationCheckpointUpdate", value: checkpoint },
    })));
    mock.emitData(endStreamFrame(Buffer.from(JSON.stringify({
      error: { code: "invalid_argument", message: "bad request" },
    }))));
    const message = await result;
    assert.equal(message.stopReason, "error");
    assert.equal([...__testInternals.conversations.values()][0].checkpoint, null);
  } finally {
    cleanupSessionState(sessionId);
    setCursorBridgeFactoryForTests();
  }
});

test("treats a malformed Connect end-stream envelope as an error", async () => {
  const mock = createMockBridge();
  const sessionId = "malformed-end-stream-session";
  setCursorBridgeFactoryForTests(async () => mock.bridge);
  try {
    const stream = streamCursor(
      model,
      { messages: [{ role: "user", content: "hello", timestamp: 1 }] },
      { apiKey: "token", sessionId },
    );
    const result = stream.result();
    await waitFor(() => mock.hasDataHandler());
    mock.emitData(endStreamFrame(Buffer.from("{")));
    const message = await result;
    assert.equal(message.stopReason, "error");
    assert.match(message.errorMessage, /malformed Connect end-stream/);
    assert.equal([...__testInternals.conversations.values()][0].checkpoint, null);
  } finally {
    cleanupSessionState(sessionId);
    setCursorBridgeFactoryForTests();
  }
});

test("session cleanup cancels an ordinary live stream", async () => {
  const mock = createMockBridge();
  const sessionId = "cleanup-live-session";
  setCursorBridgeFactoryForTests(async () => mock.bridge);
  try {
    const stream = streamCursor(
      model,
      { messages: [{ role: "user", content: "hello", timestamp: 1 }] },
      { apiKey: "token", sessionId },
    );
    const result = stream.result();
    await waitFor(() => mock.hasDataHandler());
    cleanupSessionState(sessionId);
    const message = await result;
    assert.equal(message.stopReason, "error");
    assert.equal(__testInternals.liveBridges.size, 0);
    assert.equal(__testInternals.conversations.size, 0);
  } finally {
    cleanupSessionState(sessionId);
    setCursorBridgeFactoryForTests();
  }
});

test("maps quota errors separately from context overflow", () => {
  assert.match(
    mapConnectErrorCode("resource_exhausted", "context length exceeded"),
    /context_length_exceeded/,
  );
  assert.match(
    mapConnectErrorCode("resource_exhausted", "rate limit"),
    /quota or rate limit/,
  );
});

test("fingerprints full turn content and scopes model caches by account", () => {
  const first = [{ userText: "hello", images: [], steps: [{ kind: "assistantText", text: "one" }] }];
  const second = [{ userText: "hello", images: [], steps: [{ kind: "assistantText", text: "two" }] }];
  assert.notEqual(turnsFingerprint(first), turnsFingerprint(second));
  const token = `header.${Buffer.from(JSON.stringify({ sub: "user-a" })).toString("base64url")}.sig`;
  assert.equal(accountCacheKey(token), "sub:user-a");
  assert.match(accountCacheKey("opaque-token"), /^tok:/);
});

test("the Cursor implementation no longer owns an HTTP or child-process proxy", async () => {
  const source = await readFile(new URL("./stream.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /createServer|child_process|text\/event-stream/);
  assert.equal(__testInternals.liveBridges.size, 0);
});
