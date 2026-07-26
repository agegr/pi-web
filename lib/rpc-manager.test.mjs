import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const lifecycle = { destroy: 0, abort: 0, shutdown: 0, send: 0, prompt: 0 };

function makeAgent() {
  return {
    sessionId: "test-session",
    sessionFile: "",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    agent: { state: { systemPrompt: "" } },
    extensionRunner: {},
    subscribe() { return () => {}; },
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

test("认证失败、过期、API 401、SSE 断开和改密不触碰 Agent 生命周期", async () => {
  const configDirectory = await mkdtemp(join(tmpdir(), "pi-web-rpc-auth-"));
  const previousConfigPath = process.env.PI_WEB_AUTH_CONFIG_PATH;
  const previousSessions = globalThis.__piSessions;
  let wrapper;
  const originalNow = Date.now;
  process.env.PI_WEB_AUTH_CONFIG_PATH = join(configDirectory, "auth.json");
  try {
    const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
    const load = (path) => jiti.import(path);
    const { AgentSessionWrapper } = await load("./rpc-manager.ts");
    const auth = await load("./pi-web-auth.ts");
    const { POST: login } = await load("../app/api/auth/login/route.ts");
    const { POST: logout } = await load("../app/api/auth/logout/route.ts");
    const { POST: changePassword } = await load("../app/api/auth/password/route.ts");
    const { GET: events } = await load("../app/api/agent/[id]/events/route.ts");
    const { proxy } = await load("../proxy.ts");

    await auth.initializeAuth(auth.getSetupTokenForTests(), "old-password");
    const sessionToken = auth.createSession();
    wrapper = new AgentSessionWrapper(makeAgent());
    wrapper.start();
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
      headers: { accept: "application/json", cookie: `pi_web_session=${sessionToken}` },
    }));
    assert.equal(unauthorized.status, 401);

    const expiredSse = await proxy(new Request("http://localhost/api/agent/test-session/events", {
      headers: { accept: "text/event-stream", cookie: `pi_web_session=${sessionToken}` },
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
    const streamResponse = await events(new Request("http://localhost/api/agent/test-session/events", {
      signal: controller.signal,
    }), { params: Promise.resolve({ id: "test-session" }) });
    assert.equal(streamResponse.status, 200);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(lifecycle, before);
    assert.equal(lifecycle.send, before.send);
    assert.equal(lifecycle.prompt, before.prompt);
    assert.equal(lifecycle.abort, before.abort);
    assert.equal(lifecycle.shutdown, before.shutdown);
    assert.equal(lifecycle.destroy, before.destroy);
    assert.equal(wrapper.isAlive(), true);
    assert.equal(sessionToken.length, 64);

    const logoutResponse = await logout(new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `pi_web_session=${sessionToken}` },
      body: "{}",
    }));
    assert.equal(logoutResponse.status, 200);
    assert.equal(auth.getSession(sessionToken).valid, false);
  } finally {
    Date.now = originalNow;
    if (wrapper?.isAlive()) wrapper.destroy();
    globalThis.__piSessions = previousSessions;
    process.env.PI_WEB_AUTH_CONFIG_PATH = previousConfigPath;
    await rm(configDirectory, { recursive: true, force: true });
  }
});
