import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const adapterSource = await readFile(new URL("../src/routes/api/agent/$id/events.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });

test("TanStack event route adapts plain params to the existing handler", () => {
  assert.match(adapterSource, /params: Promise\.resolve\(\{ id: params\.id \}\)/);
});

test("event handler preserves headers and abort cleanup", async (t) => {
  const previous = globalThis.__piSessions;
  let unsubscribeCount = 0;
  const id = "tanstack-sse-test";
  globalThis.__piSessions = new Map([[id, {
    isAlive: () => true,
    isStreaming: false,
    streamingMessage: undefined,
    onEvent() {
      return () => { unsubscribeCount += 1; };
    },
  }]]);
  t.after(() => { globalThis.__piSessions = previous; });

  const { GET } = await jiti.import("../app/api/agent/[id]/events/route.ts");
  const controller = new AbortController();
  const response = await GET(
    new Request(`http://localhost/api/agent/${id}/events`, { signal: controller.signal }),
    { params: Promise.resolve({ id }) },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
  assert.equal(response.headers.get("connection"), "keep-alive");
  assert.equal(response.headers.get("x-accel-buffering"), "no");

  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), ":\n\n");
  controller.abort();
  // The abort handler closes the stream synchronously, but a `connected`
  // event may already be buffered in the queue (ReadableStream.close() keeps
  // queued chunks readable). Drain until done; abort cleanup must still fire.
  const second = await reader.read();
  assert.ok(
    second.done
    || new TextDecoder().decode(second.value).includes('"type":"connected"'),
  );
  assert.equal((await reader.read()).done, true);
  assert.equal(unsubscribeCount, 1);
});
