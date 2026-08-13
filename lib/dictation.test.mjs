import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
});
const { createWebSpeechDictationProvider } = await jiti.import("./dictation.ts");

test("Web Speech provider reports unsupported outside a browser", () => {
  assert.equal(createWebSpeechDictationProvider().isSupported(), false);
});

test("Web Speech provider uses requested language and options", () => {
  const previousWindow = globalThis.window;
  class FakeRecognition {
    constructor() { FakeRecognition.instance = this; }
    continuous = false;
    interimResults = false;
    lang = "";
    maxAlternatives = 0;
    onresult = null;
    onerror = null;
    onend = null;
    start() {}
    stop() {}
    abort() {}
  }

  globalThis.window = { webkitSpeechRecognition: FakeRecognition };
  const session = createWebSpeechDictationProvider().start({
    onFinalText() {},
    onInterimText() {},
    onError() {},
    onEnd() {},
  }, { language: "zh-CN", continuous: true, interimResults: false });

  assert.equal(FakeRecognition.instance.lang, "zh-CN");
  assert.equal(FakeRecognition.instance.continuous, true);
  assert.equal(FakeRecognition.instance.interimResults, false);
  session.abort();
  globalThis.window = previousWindow;
});

test("Web Speech provider reports start failures without leaking handlers", () => {
  const previousWindow = globalThis.window;
  class FakeRecognition {
    constructor() {
      FakeRecognition.instance = this;
    }
    continuous = false;
    interimResults = false;
    lang = "";
    maxAlternatives = 0;
    onresult = null;
    onerror = null;
    onend = null;
    start() { throw new Error("already started"); }
    stop() {}
    abort() {}
  }

  globalThis.window = { SpeechRecognition: FakeRecognition };
  assert.throws(() => createWebSpeechDictationProvider().start({
    onFinalText() {},
    onInterimText() {},
    onError() {},
    onEnd() {},
  }), /already started/);
  assert.equal(FakeRecognition.instance.onresult, null);
  assert.equal(FakeRecognition.instance.onerror, null);
  assert.equal(FakeRecognition.instance.onend, null);
  globalThis.window = previousWindow;
});

test("Web Speech provider forwards final and interim results", () => {
  const events = [];
  let recognition;
  class FakeRecognition {
    static instance;
    constructor() { FakeRecognition.instance = this; }
    continuous = false;
    interimResults = false;
    lang = "";
    maxAlternatives = 0;
    onresult = null;
    onerror = null;
    onend = null;
    start() { events.push("start"); }
    stop() { events.push("stop"); if (this.onend) this.onend(); }
    abort() { events.push("abort"); if (this.onend) this.onend(); }
  }

  globalThis.window = { SpeechRecognition: FakeRecognition };
  const previousNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "en-US" } });
  const provider = createWebSpeechDictationProvider();
  assert.equal(provider.isSupported(), true);

  const callbacks = {
    onFinalText: (text) => events.push(["final", text]),
    onInterimText: (text) => events.push(["interim", text]),
    onError: (error) => events.push(["error", error]),
    onEnd: () => events.push("end"),
  };
  const session = provider.start(callbacks);
  recognition = FakeRecognition.instance;
  assert.ok(session);
  assert.ok(recognition);
  assert.deepEqual(events, ["start"]);

  recognition.onresult({
    resultIndex: 0,
    results: [
      { isFinal: false, 0: { transcript: "partial" } },
      { isFinal: true, 0: { transcript: " complete" } },
    ],
  });
  assert.deepEqual(events.slice(1), [["final", "complete"], ["interim", "partial"]]);

  session.stop();
  assert.equal(events.at(-2), "stop");
  assert.equal(events.at(-1), "end");
  delete globalThis.window;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: previousNavigator });
});
