import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createAgentEventStream } = await jiti.import("./agent-event-stream.ts");
const decode = (chunk) => JSON.parse(new TextDecoder().decode(chunk.value).slice(6));

test("connected snapshots carry the same committed completion id as live events", async (t) => {
  const abort = new AbortController();
  let listener;
  const session = {
    isStreaming: false,
    streamingMessage: undefined,
    completionId: "100",
    onEvent(next) { listener = next; return () => {}; },
  };
  const stream = createAgentEventStream(new Request("http://localhost/events", { signal: abort.signal }), "root", Promise.resolve(session));
  t.after(() => abort.abort());
  const reader = stream.getReader();
  await reader.read(); // Transport prelude.
  const connected = decode(await reader.read());
  assert.equal(connected.completionId, "100");
  session.completionId = "101";
  listener({ type: "session_complete", completionId: session.completionId });
  assert.deepEqual(decode(await reader.read()), { type: "session_complete", completionId: "101" });
});

test("a completion during subscription stays live instead of being swallowed by the initial baseline", async (t) => {
  const abort = new AbortController();
  const session = {
    isStreaming: false,
    streamingMessage: undefined,
    completionId: undefined,
    onEvent(next) {
      session.completionId = "200";
      next({ type: "session_complete", completionId: "200" });
      return () => {};
    },
  };
  const stream = createAgentEventStream(new Request("http://localhost/events", { signal: abort.signal }), "root", Promise.resolve(session));
  t.after(() => abort.abort());
  const reader = stream.getReader();
  await reader.read();
  assert.equal(decode(await reader.read()).completionId, undefined);
  assert.deepEqual(decode(await reader.read()), { type: "session_complete", completionId: "200" });
});
