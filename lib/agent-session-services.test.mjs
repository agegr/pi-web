import assert from "node:assert/strict";
import test from "node:test";

import { runAgentServiceLoad } from "./agent-session-services.ts";

const SINGLETON_KEY = "__piChromeProfileBridgeLoaded__";

function clearSingleton() {
  delete globalThis[SINGLETON_KEY];
}

test.afterEach(clearSingleton);

test("transient model discovery releases a pi-chrome singleton it created", async () => {
  clearSingleton();
  const token = { token: Symbol("model-discovery") };

  const result = await runAgentServiceLoad(async () => {
    globalThis[SINGLETON_KEY] = token;
    return "models";
  }, { transientExtensions: true });

  assert.equal(result, "models");
  assert.equal(globalThis[SINGLETON_KEY], undefined);
});

test("transient model discovery preserves an existing session singleton", async () => {
  const existing = { token: Symbol("active-session") };
  globalThis[SINGLETON_KEY] = existing;

  await runAgentServiceLoad(async () => {
    assert.equal(globalThis[SINGLETON_KEY], existing);
  }, { transientExtensions: true });

  assert.equal(globalThis[SINGLETON_KEY], existing);
});

test("session service creation keeps the pi-chrome singleton", async () => {
  clearSingleton();
  const token = { token: Symbol("session") };

  await runAgentServiceLoad(async () => {
    globalThis[SINGLETON_KEY] = token;
  });

  assert.equal(globalThis[SINGLETON_KEY], token);
});

test("service loads are serialized so discovery cannot race session startup", async () => {
  clearSingleton();
  const order = [];
  let releaseDiscovery;

  const discovery = runAgentServiceLoad(async () => {
    order.push("discovery:start");
    globalThis[SINGLETON_KEY] = { token: Symbol("discovery") };
    await new Promise((resolve) => { releaseDiscovery = resolve; });
    order.push("discovery:end");
  }, { transientExtensions: true });

  await Promise.resolve();
  const session = runAgentServiceLoad(async () => {
    order.push("session:start");
    assert.equal(globalThis[SINGLETON_KEY], undefined);
  });

  await Promise.resolve();
  assert.deepEqual(order, ["discovery:start"]);
  releaseDiscovery();
  await Promise.all([discovery, session]);
  assert.deepEqual(order, ["discovery:start", "discovery:end", "session:start"]);
});
