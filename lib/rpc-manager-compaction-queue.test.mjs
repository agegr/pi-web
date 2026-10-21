import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

const COMPACTING_REFUSAL =
  "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.";

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A compacting SDK session that refuses prompts the way `AgentSession.prompt()`
 * does, with the queue, event and prompt surfaces the wrapper touches. `promptImpl`
 * is swapped per phase of a test: refusal while compacting, a recorder for the flush.
 */
function makeInner(manager, promptImpl) {
  const listeners = new Set();
  const inner = {
    sessionId: manager.getSessionId(),
    sessionFile: manager.getSessionFile(),
    sessionManager: manager,
    isStreaming: false,
    isCompacting: true,
    isBashRunning: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    pendingMessageCount: 0,
    model: undefined,
    systemPrompt: "",
    agent: { state: {} },
    extensionRunner: {},
    steering: [],
    followUp: [],
    prompt: (message, options) => promptImpl(message, options),
    getSteeringMessages: () => [...inner.steering],
    getFollowUpMessages: () => [...inner.followUp],
    clearQueue: () => {
      const steering = inner.steering;
      const followUp = inner.followUp;
      inner.steering = [];
      inner.followUp = [];
      return { steering: [...steering], followUp: [...followUp] };
    },
    getContextUsage: () => undefined,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {},
  };
  inner.emit = (event) => {
    for (const listener of [...listeners]) listener(event);
  };
  return inner;
}

/** The SDK's refusal during compaction; a registered extension command still runs. */
function refuseDuringCompaction(registeredCommand) {
  return (message, options) => {
    if (message.startsWith("/") && message.slice(1).split(" ")[0] === registeredCommand) {
      options?.preflightResult?.("handled");
      return Promise.resolve();
    }
    return Promise.reject(new Error(COMPACTING_REFUSAL));
  };
}

/** The flush's side: record the call, answer the disposition, resolve (or fail). */
function recordDeliveries(calls, { fail = false, dispositions = [] } = {}) {
  return (message, options) => {
    const disposition = dispositions[calls.length] ?? (calls.length === 0 ? "started" : "queued");
    calls.push({
      message,
      streamingBehavior: options?.streamingBehavior,
      images: options?.images,
      source: options?.source,
      disposition,
    });
    options?.preflightResult?.(disposition);
    return fail ? Promise.reject(new Error("Model not found: p/m")) : Promise.resolve();
  };
}

async function makeSessionDir(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const sessionDir = join(root, "sessions");
  await mkdir(sessionDir);
  return { root, sessionDir };
}

test("prompts sent while compaction runs park and flush FIFO at compaction end", async (t) => {
  const { root, sessionDir } = await makeSessionDir("pi-web-compact-queue-");
  const manager = SessionManager.create(root, sessionDir);
  const inner = makeInner(manager, refuseDuringCompaction("mcp"));
  const wrapper = new AgentSessionWrapper(inner);
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  wrapper.start();
  t.after(async () => {
    wrapper.destroy();
    await rm(root, { recursive: true, force: true });
  });

  // Both submissions are accepted (the composer never errors out mid-compaction).
  assert.equal(await wrapper.send({ type: "prompt", message: "first" }), null);
  assert.equal(await wrapper.send({ type: "prompt", message: "second", streamingBehavior: "steer" }), null);

  let state = await wrapper.send({ type: "get_state" });
  assert.deepEqual(state.queuedMessages, { steering: ["second"], followUp: ["first"] });
  assert.equal(state.isCompacting, true);
  // Parked prompts keep their admission outstanding: the wrapper is not idle.
  assert.equal(state.isPromptRunning, true);
  assert.equal(wrapper.isRunning(), true);
  assert.ok(events.some((event) => event.type === "queue_update"
    && event.steering?.join() === "second" && event.followUp?.join() === "first"));

  // An extension command typed during compaction runs instead of parking.
  assert.equal(await wrapper.send({ type: "prompt", message: "/mcp now" }), null);
  state = await wrapper.send({ type: "get_state" });
  assert.deepEqual(state.queuedMessages, { steering: ["second"], followUp: ["first"] });

  // Only the delivery that started a run completes its client's prompt (the
  // extension command above already emitted its own prompt_done).
  const promptDoneBefore = events.filter((event) => event.type === "prompt_done").length;
  const deliveries = [];
  inner.prompt = recordDeliveries(deliveries);
  inner.isCompacting = false;
  inner.emit({ type: "compaction_end" });
  await nextTurn();

  // FIFO, each with a streamingBehavior so the SDK decides start-or-join: the
  // plain parked prompt goes out as a followUp of whatever run is left.
  assert.deepEqual(deliveries.map(({ message, streamingBehavior, source }) => ({ message, streamingBehavior, source })), [
    { message: "first", streamingBehavior: "followUp", source: "rpc" },
    { message: "second", streamingBehavior: "steer", source: "rpc" },
  ]);
  // Only the delivery that started a run completes its client's prompt.
  assert.equal(
    events.filter((event) => event.type === "prompt_done").length - promptDoneBefore,
    1,
  );

  state = await wrapper.send({ type: "get_state" });
  assert.deepEqual(state.queuedMessages, { steering: [], followUp: [] });
  assert.equal(state.isPromptRunning, false);
  assert.ok(events.some((event) => event.type === "queue_update"
    && event.steering?.length === 0 && event.followUp?.length === 0));
});

test("recall returns parked prompts to the input and settles their admissions", async (t) => {
  const { root, sessionDir } = await makeSessionDir("pi-web-compact-recall-");
  const manager = SessionManager.create(root, sessionDir);
  const deliveries = [];
  const inner = makeInner(manager, refuseDuringCompaction("mcp"));
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  t.after(async () => {
    wrapper.destroy();
    await rm(root, { recursive: true, force: true });
  });

  await wrapper.send({ type: "prompt", message: "first" });
  await wrapper.send({ type: "prompt", message: "second", streamingBehavior: "followUp" });

  inner.prompt = recordDeliveries(deliveries);
  const cleared = await wrapper.send({ type: "clear_queue" });
  assert.deepEqual(cleared, { steering: [], followUp: ["first", "second"] });
  assert.deepEqual(deliveries, []);

  const state = await wrapper.send({ type: "get_state" });
  assert.deepEqual(state.queuedMessages, { steering: [], followUp: [] });
  assert.equal(state.isPromptRunning, false);
});

test("clear_queue returns pi's own queue beside the parked prompts", async (t) => {
  const { root, sessionDir } = await makeSessionDir("pi-web-compact-clear-");
  const manager = SessionManager.create(root, sessionDir);
  const inner = makeInner(manager, refuseDuringCompaction("mcp"));
  inner.steering = ["sdk-steer"];
  inner.followUp = ["sdk-follow-up"];
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  t.after(async () => {
    wrapper.destroy();
    await rm(root, { recursive: true, force: true });
  });

  await wrapper.send({ type: "prompt", message: "parked" });
  const cleared = await wrapper.send({ type: "clear_queue" });
  assert.deepEqual(cleared, { steering: ["sdk-steer"], followUp: ["sdk-follow-up", "parked"] });

  const state = await wrapper.send({ type: "get_state" });
  assert.deepEqual(state.queuedMessages, { steering: [], followUp: [] });
});

test("a failed flush puts the prompt back in the queue and reports the error", async (t) => {
  const { root, sessionDir } = await makeSessionDir("pi-web-compact-flushfail-");
  const manager = SessionManager.create(root, sessionDir);
  const inner = makeInner(manager, refuseDuringCompaction("mcp"));
  const wrapper = new AgentSessionWrapper(inner);
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  wrapper.start();
  t.after(async () => {
    wrapper.destroy();
    await rm(root, { recursive: true, force: true });
  });

  await wrapper.send({ type: "prompt", message: "doomed" });
  inner.prompt = recordDeliveries([], { fail: true });
  inner.isCompacting = false;
  inner.emit({ type: "compaction_end" });
  await nextTurn();

  const state = await wrapper.send({ type: "get_state" });
  // Back in the queue, still admitted: Recall or the next flush takes it again.
  assert.deepEqual(state.queuedMessages, { steering: [], followUp: ["doomed"] });
  assert.equal(state.isPromptRunning, true);
  assert.ok(events.some((event) => event.type === "prompt_error" && event.errorMessage === "Model not found: p/m"));
  // The plain prompt's client is released even though the delivery failed.
  assert.ok(events.some((event) => event.type === "prompt_done"));
});

test("parked prompts carry their images through the flush", async (t) => {
  const { root, sessionDir } = await makeSessionDir("pi-web-compact-images-");
  const manager = SessionManager.create(root, sessionDir);
  const inner = makeInner(manager, refuseDuringCompaction("mcp"));
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  t.after(async () => {
    wrapper.destroy();
    await rm(root, { recursive: true, force: true });
  });

  const images = [{ type: "image", data: "aGk=", mimeType: "image/png" }];
  await wrapper.send({ type: "prompt", message: "look", images });
  const deliveries = [];
  inner.prompt = recordDeliveries(deliveries);
  inner.isCompacting = false;
  inner.emit({ type: "auto_compaction_end" });
  await nextTurn();

  assert.equal(deliveries.length, 1);
  assert.deepEqual(deliveries[0].images, images);
  assert.equal(deliveries[0].disposition, "started");
});
