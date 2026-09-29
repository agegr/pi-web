import assert from "node:assert/strict";
import test, { mock } from "node:test";

const listeners = new Map();
globalThis.self = {
  location: {
    href: "https://pi.test/sw.js?v=test",
    origin: "https://pi.test",
  },
  addEventListener: (type, listener) => listeners.set(type, listener),
  clients: null,
};

await import("./sw.js");

function dispatchNotificationClick(data) {
  let pending;
  let closed = false;
  listeners.get("notificationclick")({
    notification: {
      data,
      close: () => { closed = true; },
    },
    waitUntil: (promise) => { pending = promise; },
  });
  return { pending, wasClosed: () => closed };
}

function dispatchPush(payload, clients) {
  let pending;
  const shown = [];
  self.clients = {
    matchAll: async () => clients,
    openWindow: async () => assert.fail("push must not open windows"),
  };
  self.registration = {
    showNotification: async (title, options) => { shown.push({ title, options }); },
  };
  listeners.get("push")({
    data: { json: () => payload },
    waitUntil: (promise) => { pending = promise; },
  });
  return { pending, shown };
}

test("push always shows a notification, even when a window is visible", async () => {
  const event = dispatchPush(
    {
      title: "Session complete",
      body: "Task finished.",
      url: "/?session=session-1",
      tag: "pi-session-complete:session-1",
    },
    [
      { url: "https://pi.test/?session=other", visibilityState: "hidden" },
      { url: "https://pi.test/?session=session-1", visibilityState: "visible" },
    ],
  );
  await event.pending;

  // iOS revokes the push subscription when a push is handled without a
  // notification, so the notification must never be suppressed.
  assert.deepEqual(event.shown, [{
    title: "Session complete",
    options: {
      body: "Task finished.",
      data: { url: "/?session=session-1" },
      tag: "pi-session-complete:session-1",
      renotify: true,
    },
  }]);
});

test("push ignores malformed payloads", async () => {
  const event = dispatchPush(
    { title: "", body: 42 },
    [],
  );
  await event.pending;

  assert.deepEqual(event.shown, []);
});

test("notification click focuses an existing client at the session URL", async () => {
  const calls = [];
  const focusedClient = {
    url: "https://pi.test/?session=session-1",
    focus: async () => { calls.push("focus"); },
    navigate: async () => assert.fail("exact client should not navigate"),
  };
  self.clients = {
    matchAll: async () => [focusedClient],
    openWindow: async () => assert.fail("existing client should be reused"),
  };

  const event = dispatchNotificationClick({ url: "/?session=session-1" });
  await event.pending;

  assert.equal(event.wasClosed(), true);
  assert.deepEqual(calls, ["focus"]);
});

test("notification click navigates an existing client to the session", async () => {
  const calls = [];
  const navigatedClient = {
    focus: async () => { calls.push("focus"); },
  };
  const existingClient = {
    url: "https://pi.test/?session=other-session",
    navigate: async (url) => {
      calls.push(["navigate", url]);
      return navigatedClient;
    },
    focus: async () => assert.fail("the navigated client should be focused"),
  };
  self.clients = {
    matchAll: async () => [existingClient],
    openWindow: async () => assert.fail("existing client should be reused"),
  };

  const event = dispatchNotificationClick({ url: "/?session=session-1" });
  await event.pending;

  assert.deepEqual(calls, [
    ["navigate", "https://pi.test/?session=session-1"],
    "focus",
  ]);
});

test("notification click opens a window and rejects cross-origin targets", async () => {
  const opened = [];
  self.clients = {
    matchAll: async () => [],
    openWindow: async (url) => { opened.push(url); },
  };

  const event = dispatchNotificationClick({ url: "https://example.com/redirect" });
  await event.pending;

  assert.deepEqual(opened, ["https://pi.test/"]);
});

// A reachable port backed by a dead upstream answers nothing at all, so these
// tests drive fetch() with a stub that only settles once the worker aborts it.
function installOfflineStub() {
  const offline = new Response("<!doctype html><title>Pi Web is offline</title>", {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
  globalThis.caches = {
    match: async (request) => ((typeof request === "string" ? request : request.url).endsWith("/offline.html")
      ? offline
      : undefined),
    open: async () => ({ put: async () => {} }),
  };
}

function dispatchFetch(url, { mode = "cors", method = "GET" } = {}) {
  let pending;
  const request = new Request(url, { method });
  Object.defineProperty(request, "mode", { value: mode });
  listeners.get("fetch")({
    request,
    respondWith: (promise) => { pending = promise; },
  });
  return pending;
}

/** fetch() that never settles until the signal it was handed is aborted. */
function installHungNetwork() {
  let aborted = false;
  globalThis.fetch = (_request, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  return () => aborted;
}

/**
 * Let a handler's await chain reach its fetch (and schedule its timer) before
 * the fake clock is ticked. setImmediate is not faked, unlike setTimeout.
 */
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

test("a stalled navigation falls back to offline.html", async () => {
  installOfflineStub();
  const wasAborted = installHungNetwork();

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const pending = dispatchFetch("https://pi.test/", { mode: "navigate" });
    await flushMicrotasks();
    mock.timers.tick(8000);
    const response = await pending;

    assert.equal(wasAborted(), true, "a hung upstream must be aborted, not awaited forever");
    assert.match(await response.text(), /Pi Web is offline/);
  } finally {
    mock.timers.reset();
  }
});

test("a stalled static asset request is bounded as well", async () => {
  installOfflineStub();
  const wasAborted = installHungNetwork();

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const pending = dispatchFetch("https://pi.test/_next/static/chunks/app.js");
    // cacheFirst awaits the cache lookup before it reaches the network.
    await flushMicrotasks();
    mock.timers.tick(8000);

    assert.equal(wasAborted(), true);
    await assert.rejects(pending, /abort/i);
  } finally {
    mock.timers.reset();
  }
});

test("a response that arrives in time is not cut off mid-stream", async () => {
  installOfflineStub();
  let signal;
  globalThis.fetch = async (_request, init) => {
    signal = init.signal;
    return new Response("<!doctype html><title>Pi Web</title>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  };

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const response = await dispatchFetch("https://pi.test/", { mode: "navigate" });
    // The budget only covers time to first byte: a long-lived body keeps
    // streaming past it (Next.js streams its SSR payload).
    mock.timers.tick(60000);

    assert.equal(signal.aborted, false);
    assert.match(await response.text(), /<title>Pi Web<\/title>/);
  } finally {
    mock.timers.reset();
  }
});
