import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createServerDictationProvider } = await jiti.import("./server-dictation.ts");

function installMediaRecorder() {
  const previous = {
    navigator: globalThis.navigator,
    MediaRecorder: globalThis.MediaRecorder,
    FormData: globalThis.FormData,
    File: globalThis.File,
    fetch: globalThis.fetch,
  };
  const tracks = [{ stop() {} }];
  const stream = { getTracks: () => tracks };
  class FakeMediaRecorder {
    static instance;
    static isTypeSupported(type) { return type === "audio/webm;codecs=opus"; }
    state = "inactive";
    mimeType = "audio/webm;codecs=opus";
    ondataavailable = null;
    onerror = null;
    onstop = null;
    constructor() { FakeMediaRecorder.instance = this; }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
      this.onstop?.();
    }
  }
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => stream } },
  });
  Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: FakeMediaRecorder });
  return { previous, stream, FakeMediaRecorder };
}

function restore(previous) {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: previous.navigator });
  Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: previous.MediaRecorder });
  Object.defineProperty(globalThis, "FormData", { configurable: true, value: previous.FormData });
  Object.defineProperty(globalThis, "File", { configurable: true, value: previous.File });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: previous.fetch });
}

test("server dictation submits one recording and emits its transcript", async () => {
  const { previous, FakeMediaRecorder } = installMediaRecorder();
  const requests = [];
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ transcript: "hello from server" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } });
  const events = [];
  const session = createServerDictationProvider({ endpoint: "/api/test-dictation" }).start({
    onFinalText: (text) => events.push(["final", text]),
    onInterimText: (text) => events.push(["interim", text]),
    onError: (error) => events.push(["error", error]),
    onEnd: () => events.push("end"),
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(FakeMediaRecorder.instance.state, "recording");
  session.stop();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/test-dictation");
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(events, [["final", "hello from server"], ["interim", ""], "end"]);
  restore(previous);
});

test("server dictation stops a pending microphone request", async () => {
  const { previous } = installMediaRecorder();
  let resolveMicrophone;
  globalThis.navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => {
    resolveMicrophone = resolve;
  });
  const events = [];
  const session = createServerDictationProvider().start({
    onFinalText() {},
    onInterimText: (text) => events.push(["interim", text]),
    onError: (error) => events.push(["error", error]),
    onEnd: () => events.push("end"),
  });
  session.abort();
  resolveMicrophone({ getTracks: () => [{ stop() { events.push("track-stop"); } }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [["interim", ""], "end", "track-stop"]);
  restore(previous);
});
