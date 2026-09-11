import assert from "node:assert/strict";
import test from "node:test";

const listeners = new Map();
globalThis.self = {
  location: {
    href: "https://pi.test/sw.js?v=test",
    origin: "https://pi.test",
  },
  addEventListener: (type, listener) => listeners.set(type, listener),
  clients: null,
  // Present on ServiceWorkerGlobalScope; called by install/activate.
  skipWaiting: async () => {},
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

// ---------------------------------------------------------------------------
// Offline app shell
// ---------------------------------------------------------------------------

// Minimal Cache API stub: enough to exercise the navigation strategies.
function installCacheStub() {
  const stores = new Map();

  const openStore = (name) => {
    if (!stores.has(name)) {
      const entries = new Map();
      stores.set(name, {
        entries,
        put: async (request, response) => { entries.set(request.url, response); },
        addAll: async (requests) => {
          for (const request of requests) {
            const url = typeof request === "string" ? request : request.url;
            entries.set(url, new Response("", { status: 200 }));
          }
        },
        match: async (request, options) => {
          const key = typeof request === "string" ? request : request.url;
          if (options?.ignoreSearch) {
            const bare = key.split("?")[0];
            for (const [url, response] of entries) {
              if (url.split("?")[0] === bare) return response;
            }
            return undefined;
          }
          return entries.get(key);
        },
        keys: async () => [...entries.keys()].map((url) => ({ url })),
        delete: async (key) => entries.delete(typeof key === "string" ? key : key.url),
      });
    }
    return stores.get(name);
  };

  globalThis.caches = {
    open: async (name) => openStore(name),
    match: async (request) => {
      for (const store of stores.values()) {
        const found = await store.match(request);
        if (found) return found;
      }
      return undefined;
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    _stores: stores,
  };

  globalThis.fetch = async () => { throw new TypeError("no network in this test"); };

  return { stores, openStore };
}

/** Build a same-origin response the way a real fetch would. */
function basicResponse(body, url, headers = { "Content-Type": "text/html" }) {
  const response = new Response(body, { status: 200, headers });
  Object.defineProperty(response, "url", { value: url });
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

function dispatchFetch(url, { mode = "cors" } = {}) {
  let pending;
  const request = new Request(url);
  Object.defineProperty(request, "mode", { value: mode });
  listeners.get("fetch")({
    request,
    respondWith: (promise) => { pending = promise; },
  });
  return pending;
}

function dispatchInstall() {
  let pending;
  listeners.get("install")({ waitUntil: (promise) => { pending = promise; } });
  return pending;
}

test("navigation serves the cached shell when the network is unreachable", async () => {
  installCacheStub();

  globalThis.fetch = async (request) => basicResponse(
    "<!doctype html><title>Pi Web</title>",
    typeof request === "string" ? request : request.url,
  );
  const online = await dispatchFetch("https://pi.test/", { mode: "navigate" });
  assert.match(await online.text(), /<title>Pi Web<\/title>/);
  // Let the fire-and-forget cache write land.
  await new Promise((resolve) => setTimeout(resolve, 0));

  globalThis.fetch = async () => { throw new TypeError("offline"); };
  const offline = await dispatchFetch("https://pi.test/", { mode: "navigate" });
  const body = await offline.text();
  assert.match(body, /<title>Pi Web<\/title>/, "the cached shell must be replayed");
  assert.doesNotMatch(body, /is offline/, "the offline placeholder must not be used");
});

test("a navigation with a query string reuses the cached shell", async () => {
  installCacheStub();

  globalThis.fetch = async (request) => basicResponse(
    "<!doctype html><title>Pi Web</title>",
    typeof request === "string" ? request : request.url,
  );
  await dispatchFetch("https://pi.test/", { mode: "navigate" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  globalThis.fetch = async () => { throw new TypeError("offline"); };
  const offline = await dispatchFetch("https://pi.test/?session=abc", { mode: "navigate" });
  assert.match(await offline.text(), /<title>Pi Web<\/title>/);
});

test("install primes the shell cache so the first visit is already offline-capable", async () => {
  const { openStore } = installCacheStub();
  globalThis.fetch = async (request) => basicResponse(
    "<!doctype html><title>Pi Web</title>",
    typeof request === "string" ? request : request.url,
  );
  void openStore;

  await dispatchInstall();

  const shell = await caches.open("pi-web-shell-test").then((cache) => cache.keys());
  assert.equal(shell.length, 1, "install must prime the shell cache");
  assert.equal(shell[0].url, "https://pi.test/");
});

test("install survives an unreachable server", async () => {
  installCacheStub();
  globalThis.fetch = async () => { throw new TypeError("offline"); };

  // Must not reject: an offline install still has to activate.
  await dispatchInstall();

  const shell = await caches.open("pi-web-shell-test").then((cache) => cache.keys());
  assert.equal(shell.length, 0);
});

test("a redirected navigation is not stored as the app shell", async () => {
  const { openStore } = installCacheStub();
  // fetch follows redirects, so the login page arrives with a different URL.
  globalThis.fetch = async () => basicResponse(
    "<html>login</html>",
    "https://pi.test/login",
  );

  await dispatchFetch("https://pi.test/", { mode: "navigate" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const shell = await openStore("pi-web-shell-test");
  assert.equal(shell.entries.size, 0, "login HTML must not be cached as the shell");
});

test("api traffic is never intercepted", async () => {
  installCacheStub();
  const pending = dispatchFetch("https://pi.test/api/sessions");
  assert.equal(pending, undefined, "the worker must leave /api/ untouched");
});
