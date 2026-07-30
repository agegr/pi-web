import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const lifecycle = { destroy: 0, abort: 0, shutdown: 0, send: 0, prompt: 0, subscribeCleanup: 0 };

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /createAgentSessionServices\(/);
  assert.match(startupSource, /createAgentSessionFromServices\(/);
  assert.doesNotMatch(startupSource, /await createAgentSession\(/);
});

test("custom extension UI receives the fixed headless terminal facade", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const customUiSource = source.slice(
    source.indexOf("private requestExtensionCustomUi"),
    source.indexOf("private requestExtensionUi"),
  );

  assert.match(customUiSource, /createHeadlessCustomUiTui\(/);
  assert.match(customUiSource, /width,/);
});

test("file watch SSE closes its watcher when the Web session is invalidated", async () => {
  const source = await readFile(new URL("../app/api/files/[...path]/route.ts", import.meta.url), "utf8");
  const watchSource = source.slice(
    source.indexOf('if (type === "watch")'),
    source.indexOf('// type === "list"'),
  );

  assert.match(watchSource, /subscribeSessionInvalidation\(/);
  assert.match(watchSource, /watcher\?\.close\(\)/);
  assert.match(watchSource, /if \(closed\) return;\s+const sessionToken = getSessionToken/);
});

function makeAgent() {
  return {
    sessionId: "test-session",
    sessionFile: "",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    agent: { state: { systemPrompt: "" } },
    extensionRunner: {},
    subscribe() { return () => { lifecycle.subscribeCleanup += 1; }; },
    getAllTools() { return []; },
    getContextUsage() { return null; },
    getSteeringMessages() { return []; },
    getFollowUpMessages() { return []; },
    get pendingMessageCount() { return 0; },
    async abort() { lifecycle.abort += 1; },
    async shutdown() { lifecycle.shutdown += 1; },
    async prompt() { lifecycle.prompt += 1; },
    async reload() {},
    sessionManager: { getSessionFile() { return ""; } },
    modelRuntime: { getModel() { return null; }, async reloadConfig() {} },
  };
}

test("authentication failures, expiration, API 401, SSE disconnects, and password changes do not touch the Agent lifecycle", async () => {
  const configDirectory = await mkdtemp(join(tmpdir(), "pi-web-rpc-auth-"));
  const previousConfigPath = process.env.PI_WEB_AUTH_CONFIG_PATH;
  const previousSessions = globalThis.__piSessions;
  let wrapper;
  const originalNow = Date.now;
  process.env.PI_WEB_AUTH_CONFIG_PATH = join(configDirectory, "auth.json");
  try {
    const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
    const load = (path) => jiti.import(path);
    const { AgentSessionWrapper, getRunningRpcSessionIds } = await load("./rpc-manager.ts");
    const auth = await load("./pi-web-auth.ts");
    const { POST: login } = await load("../app/api/auth/login/route.ts");
    const { POST: logout } = await load("../app/api/auth/logout/route.ts");
    const { POST: changePassword } = await load("../app/api/auth/password/route.ts");
    const { GET: events } = await load("../app/api/agent/[id]/events/route.ts");
    const { GET: runningEvents } = await load("../app/api/agent/running/events/route.ts");
    const { proxy } = await load("../proxy.ts");

    await auth.initializeAuth(auth.getSetupTokenForTests(), "old-password");
    const sessionToken = auth.createSession();
    wrapper = new AgentSessionWrapper(makeAgent());
    wrapper.start();
    wrapper.inner.isStreaming = true;
    globalThis.__piSessions = new Map([["test-session", wrapper]]);
    const send = wrapper.send.bind(wrapper);
    wrapper.send = async (...args) => {
      lifecycle.send += 1;
      return send(...args);
    };
    const destroy = wrapper.destroy.bind(wrapper);
    wrapper.destroy = () => {
      lifecycle.destroy += 1;
      destroy();
    };
    const before = { ...lifecycle };

    const failedLogin = await login(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong-password" }),
    }));
    assert.equal(failedLogin.status, 401);

    Date.now = () => originalNow() + 24 * 60 * 60 * 1000;
    try {
      assert.equal(auth.getSession(sessionToken).valid, false);
      const expiredPasswordChange = await changePassword(new Request("http://localhost/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `pi_web_session=${sessionToken}` },
        body: JSON.stringify({ currentPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password" }),
      }));
      assert.equal(expiredPasswordChange.status, 401);
    } finally {
      Date.now = originalNow;
    }

    const unauthorized = await proxy(new Request("http://localhost/api/agent/test-session", {
      headers: { accept: "application/json", cookie: `pi_web_session=${sessionToken}`, host: "localhost" },
    }));
    assert.equal(unauthorized.status, 401);

    const expiredSse = await proxy(new Request("http://localhost/api/agent/test-session/events", {
      headers: { accept: "text/event-stream", cookie: `pi_web_session=${sessionToken}`, host: "localhost" },
    }));
    assert.equal(expiredSse.status, 401);

    const validSession = auth.createSession();
    const changed = await changePassword(new Request("http://localhost/api/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `pi_web_session=${validSession}` },
      body: JSON.stringify({ currentPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password" }),
    }));
    assert.equal(changed.status, 200);
    assert.equal(auth.getSession(validSession).valid, false);

    const controller = new AbortController();
    let eventCleanup = 0;
    const originalOnEvent = wrapper.onEvent.bind(wrapper);
    wrapper.onEvent = (listener) => {
      const unsubscribe = originalOnEvent(listener);
      return () => {
        eventCleanup += 1;
        unsubscribe();
      };
    };
    const streamResponse = await events(new Request("http://localhost/api/agent/test-session/events", {
      signal: controller.signal,
    }), { params: Promise.resolve({ id: "test-session" }) });
    assert.equal(streamResponse.status, 200);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(eventCleanup, 1);

    const liveSseToken = auth.createSession();
    const liveController = new AbortController();
    const liveStream = await events(new Request("http://localhost/api/agent/test-session/events", {
      signal: liveController.signal,
      headers: { cookie: `pi_web_session=${liveSseToken}` },
    }), { params: Promise.resolve({ id: "test-session" }) });
    assert.equal(liveStream.status, 200);
    await auth.revokeAllSessions();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(eventCleanup, 2);
    liveController.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(getRunningRpcSessionIds(), ["test-session"]);
    const runningListeners = globalThis.__piRunningListeners;
    const runningListenerCountBefore = runningListeners?.size ?? 0;
    const runningController = new AbortController();
    const runningStreamResponse = await runningEvents(new Request("http://localhost/api/agent/running/events", {
      signal: runningController.signal,
    }));
    assert.equal(runningStreamResponse.status, 200);
    runningController.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(globalThis.__piRunningListeners?.size, runningListenerCountBefore);
    assert.deepEqual(getRunningRpcSessionIds(), ["test-session"]);
    assert.equal(wrapper.isAlive(), true);

    const runningSseToken = auth.createSession();
    const authenticatedRunningStream = await runningEvents(new Request("http://localhost/api/agent/running/events", {
      headers: { cookie: `pi_web_session=${runningSseToken}` },
    }));
    assert.equal(globalThis.__piRunningListeners?.size, runningListenerCountBefore + 1);
    auth.revokeSession(runningSseToken);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(globalThis.__piRunningListeners?.size, runningListenerCountBefore);
    await authenticatedRunningStream.body?.cancel().catch(() => {});

    const logoutResponse = await logout(new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `pi_web_session=${sessionToken}` },
      body: "{}",
    }));
    assert.equal(logoutResponse.status, 200);
    assert.equal(auth.getSession(sessionToken).valid, false);

    assert.deepEqual(lifecycle, before);
    assert.equal(lifecycle.send, before.send);
    assert.equal(lifecycle.prompt, before.prompt);
    assert.equal(lifecycle.abort, before.abort);
    assert.equal(lifecycle.shutdown, before.shutdown);
    assert.equal(lifecycle.destroy, before.destroy);
    assert.equal(lifecycle.subscribeCleanup, before.subscribeCleanup);
    assert.equal(wrapper.isAlive(), true);
    assert.equal(sessionToken.length, 64);
  } finally {
    Date.now = originalNow;
    if (wrapper?.isAlive()) wrapper.destroy();
    globalThis.__piSessions = previousSessions;
    process.env.PI_WEB_AUTH_CONFIG_PATH = previousConfigPath;
    await rm(configDirectory, { recursive: true, force: true });
  }
});

test("Agent SSE does not start a subscription when the request is already aborted on entry", async () => {
  const previousSessions = globalThis.__piSessions;
  let subscribed = 0;
  globalThis.__piSessions = new Map([[
    "pre-aborted-session",
    {
      isAlive: () => true,
      onEvent: () => {
        subscribed += 1;
        return () => {};
      },
    },
  ]]);

  try {
    const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
    const { GET } = await jiti.import("../app/api/agent/[id]/events/route.ts");
    const client = new AbortController();
    client.abort();
    const response = await GET(new Request("http://localhost/api/agent/pre-aborted-session/events", {
      signal: client.signal,
    }), { params: Promise.resolve({ id: "pre-aborted-session" }) });

    assert.equal(subscribed, 0);
    assert.equal(response.status, 204);
  } finally {
    globalThis.__piSessions = previousSessions;
  }
});

test("Agent SSE does not register a subscription or heartbeat when aborted during startRpcSession", async () => {
  const previousSessions = globalThis.__piSessions;
  const previousStart = globalThis.__piTestStartRpcSession;
  const startRelease = deferred();
  let subscribed = 0;
  globalThis.__piSessions = new Map();
  globalThis.__piTestStartRpcSession = async () => {
    await startRelease.promise;
    return {
      session: {
        isAlive: () => true,
        onEvent: () => {
          subscribed += 1;
          return () => {};
        },
      },
    };
  };

  try {
    const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
    const sessionReader = await jiti.import("./session-reader.ts");
    const rpc = await jiti.import("./rpc-manager.ts");
    sessionReader.resolveSessionPath = async () => "/tmp/deferred-agent-session.jsonl";
    rpc.startRpcSession = (...args) => globalThis.__piTestStartRpcSession(...args);
    const { GET } = await jiti.import("../app/api/agent/[id]/events/route.ts");
    const client = new AbortController();
    const responsePromise = GET(new Request("http://localhost/api/agent/deferred/events", {
      signal: client.signal,
    }), { params: Promise.resolve({ id: "deferred" }) });

    await new Promise((resolve) => setTimeout(resolve, 0));
    client.abort();
    startRelease.resolve();
    const response = await responsePromise;

    assert.equal(subscribed, 0);
    assert.equal(response.status, 204);
    await response.body?.cancel();
  } finally {
    globalThis.__piTestStartRpcSession = previousStart;
    globalThis.__piSessions = previousSessions;
  }
});

test("reloading a session invalidates the models cache", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const reloadSource = source.slice(
    source.indexOf('case "reload"'),
    source.indexOf('case "abort_compaction"'),
  );

  assert.match(reloadSource, /await this\.inner\.reload\(\)/);
  assert.match(reloadSource, /this\.applyForcedEmptySystemPrompt\(\);\s*invalidateModelsCache\(\)/);
});
