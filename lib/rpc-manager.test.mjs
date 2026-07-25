import assert from "node:assert/strict";
import test from "node:test";

const lifecycle = { destroy: 0, abort: 0, shutdown: 0, send: 0 };

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
    async prompt() { lifecycle.send += 1; },
    async reload() {},
    sessionManager: { getSessionFile() { return ""; } },
    modelRuntime: { getModel() { return null; }, async reloadConfig() {} },
  };
}

test("认证失败、过期、API 401、SSE 断开和改密不触碰 Agent 生命周期", async (t) => {
  let createJiti;
  try {
    ({ createJiti } = await import("jiti"));
  } catch {
    t.skip("缺少 jiti，无法加载真实 TypeScript AgentSessionWrapper");
    return;
  }

  const jiti = createJiti(import.meta.url);
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
  const auth = await jiti.import("./pi-web-auth.ts");
  const { POST: changePassword } = await jiti.import("../app/api/auth/password/route.ts");
  const { GET: events } = await jiti.import("../app/api/agent/[id]/events/route.ts");
  const { proxy } = await jiti.import("../proxy.ts");

  await auth.resetAuthStateForTests();
  await auth.initializeAuth("setup-token", "old-password");
  const sessionToken = auth.createSession();
  const wrapper = new AgentSessionWrapper(makeAgent());
  wrapper.start();
  globalThis.__piSessions = new Map([["test-session", wrapper]]);
  const destroy = wrapper.destroy.bind(wrapper);
  wrapper.destroy = () => {
    lifecycle.destroy += 1;
    destroy();
  };
  const before = { ...lifecycle };

  assert.equal(auth.getSession("expired-token").valid, false);
  const unauthorized = await proxy(new Request("http://localhost/api/agent/test-session", {
    headers: { accept: "application/json" },
  }));
  assert.equal(unauthorized.status, 401);
  assert.equal((await changePassword(new Request("http://localhost/api/auth/password", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "pi_web_session=expired-token" },
    body: JSON.stringify({ currentPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password" }),
  }))).status, 401);

  const controller = new AbortController();
  const streamResponse = await events(new Request("http://localhost/api/agent/test-session/events", {
    signal: controller.signal,
  }), { params: Promise.resolve({ id: "test-session" }) });
  assert.equal(streamResponse.status, 200);
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await auth.changePassword("old-password", "new-password");

  assert.deepEqual(lifecycle, before);
  assert.equal(wrapper.isAlive(), true);
  assert.equal(sessionToken.length, 64);
  wrapper.destroy();
  assert.equal(lifecycle.destroy, before.destroy + 1);
});
