import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createAgentEventStream, TOOL_UPDATE_COALESCE_MS } = await jiti.import("./agent-event-stream.ts");
const { hasActiveSessionLivenessProvider } = await jiti.import("./session-liveness.ts");
const decoder = new TextDecoder();

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function readWithin(reader, timeoutMs = 1_000) {
  let timeout;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out reading SSE chunk")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function decodeData(chunk) {
  const text = decoder.decode(chunk.value);
  assert.match(text, /^data: /);
  return JSON.parse(text.slice("data: ".length));
}

test("opens the transport before a slow session is ready and snapshots after subscribing", async () => {
  const startup = deferred();
  const abortController = new AbortController();
  const stream = createAgentEventStream(
    new Request("http://localhost/events", { signal: abortController.signal }),
    "session-id",
    startup.promise,
  );
  const reader = stream.getReader();

  const transport = await readWithin(reader);
  assert.equal(decoder.decode(transport.value), ":\n\n");

  const snapshot = { role: "assistant", content: [{ type: "text", text: "Hello" }] };
  let listener;
  let subscribeCount = 0;
  let unsubscribeCount = 0;
  startup.resolve({
    isStreaming: true,
    streamingMessage: snapshot,
    onEvent(nextListener) {
      subscribeCount += 1;
      listener = nextListener;
      nextListener({
        type: "message_update",
        message: snapshot,
        assistantMessageEvent: { type: "text_delta", delta: "ignored" },
      });
      nextListener({ type: "agent_start" });
      return () => { unsubscribeCount += 1; };
    },
  });

  const connected = decodeData(await readWithin(reader));
  const messageStart = decodeData(await readWithin(reader));
  const replayedEvent = decodeData(await readWithin(reader));
  assert.equal(subscribeCount, 1);
  assert.deepEqual(connected, {
    type: "connected",
    sessionId: "session-id",
    isStreaming: true,
    pendingExtensionUiIds: [],
  });
  assert.deepEqual(messageStart, { type: "agent_start" });
  assert.deepEqual(replayedEvent, { type: "message_start", message: snapshot });
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-id" }), true);

  listener({
    type: "message_update",
    message: { ...snapshot },
    assistantMessageEvent: {
      type: "text_delta",
      delta: "!",
      partial: { ...snapshot },
    },
  });
  assert.deepEqual(decodeData(await readWithin(reader)), {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "!" },
  });

  abortController.abort();
  assert.equal(unsubscribeCount, 1);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-id" }), false);
  assert.equal((await readWithin(reader)).done, true);
});

test("reports a startup failure in-band after opening the transport", async () => {
  const stream = createAgentEventStream(
    new Request("http://localhost/events"),
    "session-id",
    Promise.reject(new Error("broken config")),
  );
  const reader = stream.getReader();

  assert.equal(decoder.decode((await readWithin(reader)).value), ":\n\n");
  assert.deepEqual(decodeData(await readWithin(reader)), {
    type: "startup_error",
    errorMessage: "Failed to start agent: broken config",
  });
  assert.equal((await readWithin(reader)).done, true);
});

test("does not subscribe when the client cancels during startup", async () => {
  const startup = deferred();
  let subscribeCount = 0;
  const stream = createAgentEventStream(
    new Request("http://localhost/events"),
    "session-id",
    startup.promise,
  );
  const reader = stream.getReader();

  await readWithin(reader);
  await reader.cancel();
  startup.resolve({
    isStreaming: false,
    streamingMessage: undefined,
    onEvent() {
      subscribeCount += 1;
      return () => {};
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(subscribeCount, 0);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-id" }), false);
});

test("session_shutdown from a live wrapper closes the SSE stream", async () => {
  const abortController = new AbortController();
  let listener;
  const stream = createAgentEventStream(
    new Request("http://localhost/events", { signal: abortController.signal }),
    "session-id",
    Promise.resolve({
      isStreaming: false,
      streamingMessage: undefined,
      isAlive: () => true,
      onEvent(nextListener) {
        listener = nextListener;
        return () => {};
      },
    }),
  );
  const reader = stream.getReader();
  await readWithin(reader);
  decodeData(await readWithin(reader));
  listener({ type: "session_shutdown" });
  assert.equal((await readWithin(reader)).done, true);
});

test("does not subscribe when the wrapper died before the snapshot", async () => {
  let subscribeCount = 0;
  const stream = createAgentEventStream(
    new Request("http://localhost/events"),
    "session-id",
    Promise.resolve({
      isStreaming: false,
      streamingMessage: undefined,
      isAlive: () => false,
      onEvent() {
        subscribeCount += 1;
        return () => {};
      },
    }),
  );
  const reader = stream.getReader();
  await readWithin(reader);
  assert.equal((await readWithin(reader)).done, true);
  assert.equal(subscribeCount, 0);
});

test("closes an already-aborted request and handles a later startup rejection", async () => {
  const abortController = new AbortController();
  abortController.abort();
  const stream = createAgentEventStream(
    new Request("http://localhost/events", { signal: abortController.signal }),
    "session-id",
    Promise.reject(new Error("startup failed after disconnect")),
  );

  assert.equal((await readWithin(stream.getReader())).done, true);
  await new Promise((resolve) => setImmediate(resolve));
});

async function connectedStream(sessionId) {
  const abortController = new AbortController();
  let listener;
  const stream = createAgentEventStream(
    new Request("http://localhost/events", { signal: abortController.signal }),
    sessionId,
    Promise.resolve({
      isStreaming: true,
      streamingMessage: undefined,
      onEvent(nextListener) {
        listener = nextListener;
        return () => {};
      },
    }),
  );
  const reader = stream.getReader();
  assert.equal(decoder.decode((await readWithin(reader)).value), ":\n\n");
  assert.deepEqual(decodeData(await readWithin(reader)), {
    type: "connected",
    sessionId,
    isStreaming: true,
    pendingExtensionUiIds: [],
  });
  return { reader, listener, abortController };
}

test("connected names the extension UI requests the session replays, so a client can drop the rest", async () => {
  const abortController = new AbortController();
  const stream = createAgentEventStream(
    new Request("http://localhost/events", { signal: abortController.signal }),
    "ui-session",
    Promise.resolve({
      isStreaming: true,
      streamingMessage: undefined,
      onEvent(nextListener) {
        // What AgentSessionWrapper.onEvent() replays: pending UI requests, then running tools.
        nextListener({ type: "extension_ui_request", id: "dialog-b", method: "confirm", title: "Run?" });
        nextListener({ type: "extension_ui_request", id: "panel-c", method: "custom", lines: [] });
        nextListener({ type: "tool_execution_start", toolCallId: "call-1", toolName: "bash" });
        return () => {};
      },
    }),
  );
  const reader = stream.getReader();
  assert.equal(decoder.decode((await readWithin(reader)).value), ":\n\n");

  const connected = decodeData(await readWithin(reader));
  assert.deepEqual(connected.pendingExtensionUiIds, ["dialog-b", "panel-c"]);
  // The replayed requests follow it, so the client re-queues what it had dropped.
  assert.equal(decodeData(await readWithin(reader)).id, "dialog-b");
  assert.equal(decodeData(await readWithin(reader)).id, "panel-c");
  abortController.abort();
});

const BIG_PAYLOAD = "x".repeat(30_000);

function toolUpdate(toolCallId = "call-1", partialResult = BIG_PAYLOAD) {
  return {
    type: "tool_execution_update",
    toolCallId,
    toolName: "bash",
    partialResult,
  };
}

/** Non-droppable, so it always survives and marks the end of the queued batch. */
function sentinelEvent() {
  return { type: "agent_end" };
}

/** Wait until the stream has flushed the tool updates it was coalescing. */
function afterCoalesceWindow() {
  return new Promise((resolve) => setTimeout(resolve, TOOL_UPDATE_COALESCE_MS * 2));
}

test("terminates the stream when an unread, non-rebuildable backlog exceeds the limit", async () => {
  const previousLimit = process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES;
  process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES = String(64 * 1024);
  try {
    const { reader, listener } = await connectedStream("backlog-session");

    // Stop reading here: message snapshots cannot be rebuilt client-side, so
    // they must hit the hard limit instead of being dropped.
    const message = { role: "assistant", content: [{ type: "text", text: BIG_PAYLOAD }] };
    for (let index = 0; index < 8; index += 1) {
      listener({ type: "message_start", message });
    }

    let queuedChunks = 0;
    await assert.rejects(async () => {
      for (;;) {
        const next = await readWithin(reader);
        if (next.done) return;
        queuedChunks += 1;
        assert.ok(queuedChunks < 8, "stream kept queueing past the backlog limit");
      }
    }, /client backlog exceeded/);
    assert.equal(hasActiveSessionLivenessProvider({ sessionId: "backlog-session" }), false);
  } finally {
    if (previousLimit === undefined) delete process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES;
    else process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES = previousLimit;
  }
});

test("drops rebuildable deltas while the client is behind instead of disconnecting it", async () => {
  const previousLimit = process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES;
  process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES = String(8 * 1024 * 1024);
  try {
    const { reader, listener, abortController } = await connectedStream("behind-session");

    // Updates of different tool calls survive coalescing and are written in one flush.
    const emitted = 60;
    for (let index = 0; index < emitted; index += 1) listener(toolUpdate(`call-${index}`));
    await afterCoalesceWindow();
    listener(sentinelEvent());

    // Whatever was queued before the water mark is still delivered…
    let delivered = 0;
    let sawSentinel = false;
    while (!sawSentinel) {
      const next = await readWithin(reader);
      assert.equal(next.done, false);
      const event = decodeData(next);
      if (event.type === "agent_end") sawSentinel = true;
      else delivered += 1;
    }
    assert.ok(delivered > 0 && delivered < emitted, `expected drops, delivered ${delivered} of ${emitted}`);
    assert.equal(hasActiveSessionLivenessProvider({ sessionId: "behind-session" }), true);

    // …and the stream stays usable once the client catches up.
    listener(toolUpdate());
    const afterCatchUp = await readWithin(reader);
    assert.equal(afterCatchUp.done, false);
    assert.equal(decodeData(afterCatchUp).type, "tool_execution_update");
    abortController.abort();
  } finally {
    if (previousLimit === undefined) delete process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES;
    else process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES = previousLimit;
  }
});

test("keeps the start and end of a streamed block while dropping its deltas", async (t) => {
  const previousLimit = process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES;
  process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES = String(8 * 1024 * 1024);
  try {
    const { reader, listener, abortController } = await connectedStream("block-session");
    t.after(() => abortController.abort());
    const update = (assistantMessageEvent) => ({
      type: "message_update",
      message: { role: "assistant", content: [] },
      assistantMessageEvent,
    });

    listener(update({ type: "text_start", contentIndex: 0 }));
    for (let index = 0; index < 60; index += 1) {
      listener(update({ type: "text_delta", contentIndex: 0, delta: BIG_PAYLOAD }));
    }
    // The client's reducer replaces the block with this content, repairing any dropped delta.
    listener(update({ type: "text_end", contentIndex: 0, content: "final text" }));
    listener(sentinelEvent());

    const kinds = [];
    for (;;) {
      const event = decodeData(await readWithin(reader));
      if (event.type === "agent_end") break;
      kinds.push(event.assistantMessageEvent.type);
    }
    assert.equal(kinds[0], "text_start");
    assert.equal(kinds.at(-1), "text_end");
    assert.ok(kinds.length < 62, `expected dropped deltas, got ${kinds.length} events`);
  } finally {
    if (previousLimit === undefined) delete process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES;
    else process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES = previousLimit;
  }
});

test("delivers every update to a client that reads promptly", async () => {
  const { reader, listener, abortController } = await connectedStream("prompt-session");
  for (let index = 0; index < 5; index += 1) {
    listener(toolUpdate("call-1", `${index}:${BIG_PAYLOAD}`));
    const next = await readWithin(reader);
    assert.equal(next.done, false);
    const event = decodeData(next);
    assert.equal(event.type, "tool_execution_update");
    assert.equal(event.partialResult, `${index}:${BIG_PAYLOAD}`);
  }
  abortController.abort();
});

test("coalesces a burst of tool updates into the latest one per tool call", async (t) => {
  const { reader, listener, abortController } = await connectedStream("coalesce-session");
  t.after(() => abortController.abort());

  // A codemode script publishes a snapshot each time a nested call starts.
  for (let index = 0; index < 50; index += 1) {
    if (index % 10 === 0) {
      listener({
        type: "tool_execution_start",
        toolCallId: `call-codemode/${index + 1}`,
        toolName: "read",
        args: { path: `file-${index}` },
        parentToolCallId: "call-codemode",
      });
      // The nested call's own progress never reaches the client.
      listener({
        ...toolUpdate(`call-codemode/${index + 1}`, `nested ${index}`),
        toolName: "read",
        parentToolCallId: "call-codemode",
      });
    }
    listener({ ...toolUpdate("call-codemode", `snapshot ${index}`), toolName: "codemode" });
  }
  listener(toolUpdate("call-bash", "bash tail"));

  // Starts are never held back for the updates around them.
  const starts = [];
  for (let index = 0; index < 5; index += 1) starts.push(decodeData(await readWithin(reader)));
  assert.deepEqual(starts.map((event) => event.toolCallId), [
    "call-codemode/1",
    "call-codemode/11",
    "call-codemode/21",
    "call-codemode/31",
    "call-codemode/41",
  ]);
  assert.deepEqual(starts[0], {
    type: "tool_execution_start",
    toolCallId: "call-codemode/1",
    toolName: "read",
    parentToolCallId: "call-codemode",
  });

  const updates = [decodeData(await readWithin(reader)), decodeData(await readWithin(reader))];
  assert.deepEqual(
    updates.map((event) => [event.type, event.toolCallId, event.partialResult]),
    [
      ["tool_execution_update", "call-codemode", "snapshot 49"],
      ["tool_execution_update", "call-bash", "bash tail"],
    ],
  );

  await afterCoalesceWindow();
  listener(sentinelEvent());
  assert.deepEqual(decodeData(await readWithin(reader)), { type: "agent_end" });
});

test("never delivers a tool update after that tool call's end", async (t) => {
  const { reader, listener, abortController } = await connectedStream("end-session");
  t.after(() => abortController.abort());

  listener(toolUpdate("call-1", "partial"));
  listener(toolUpdate("call-2", "still running"));
  listener({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "bash",
    result: { content: [{ type: "text", text: BIG_PAYLOAD }] },
    isError: false,
  });

  assert.deepEqual(decodeData(await readWithin(reader)), {
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "bash",
    isError: false,
  });
  // Only the ended call's pending update is discarded.
  const other = decodeData(await readWithin(reader));
  assert.equal(other.toolCallId, "call-2");
  assert.equal(other.partialResult, "still running");

  await afterCoalesceWindow();
  listener(sentinelEvent());
  assert.deepEqual(decodeData(await readWithin(reader)), { type: "agent_end" });
});

test("discards pending tool updates when the run ends", async (t) => {
  const { reader, listener, abortController } = await connectedStream("run-end-session");
  t.after(() => abortController.abort());

  listener(toolUpdate("call-1", "no end ever came"));
  listener(sentinelEvent());
  assert.deepEqual(decodeData(await readWithin(reader)), { type: "agent_end" });

  await afterCoalesceWindow();
  listener({ type: "agent_settled" });
  assert.deepEqual(decodeData(await readWithin(reader)), { type: "agent_settled" });
});

test("replays a running tool's start and latest update after the snapshot", async () => {
  const abortController = new AbortController();
  const stream = createAgentEventStream(
    new Request("http://localhost/events", { signal: abortController.signal }),
    "replay-session",
    Promise.resolve({
      isStreaming: true,
      streamingMessage: undefined,
      onEvent(listener) {
        // AgentSessionWrapper.onEvent() replays active tool calls synchronously.
        listener({ type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "make" } });
        listener(toolUpdate("call-1", "latest output"));
        return () => {};
      },
    }),
  );
  const reader = stream.getReader();
  await readWithin(reader);

  assert.equal(decodeData(await readWithin(reader)).type, "connected");
  assert.deepEqual(decodeData(await readWithin(reader)), {
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "bash",
    args: { command: "make" },
  });
  assert.deepEqual(decodeData(await readWithin(reader)), toolUpdate("call-1", "latest output"));
  abortController.abort();
});
