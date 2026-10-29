import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  SESSION_LIVENESS_REGISTRY_KEY,
  hasActiveSessionLivenessProvider,
  isValidLivenessHolder,
  listRegisteredSessionLivenessProviders,
  listSessionLivenessProviders,
  registerSessionLivenessProvider,
} = await jiti.import("./session-liveness.ts");

test("documented global registry contract remains compatible with extensions", (t) => {
  assert.equal(SESSION_LIVENESS_REGISTRY_KEY, "@agegr/pi-web/session-liveness/v1");
  const liveness = globalThis[Symbol.for(SESSION_LIVENESS_REGISTRY_KEY)];
  assert.equal(liveness?.version, 1);
  assert.equal(typeof liveness?.register, "function");
  assert.equal(typeof liveness?.hasActiveProvider, "function");

  const release = liveness.register({
    name: "global-contract-provider",
    sessionId: "session-global-contract",
    isActive: () => true,
  });
  t.after(release);

  assert.equal(liveness.hasActiveProvider({ sessionId: "session-global-contract" }), true);
});

test("session liveness providers are matched by exact session id or file", (t) => {
  const dispose = registerSessionLivenessProvider({
    name: "test-provider",
    sessionId: "session-a",
    sessionFile: "/tmp/session-a.jsonl",
    isActive: () => true,
  });
  t.after(dispose);

  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-a" }), true);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "alias", sessionFile: "/tmp/session-a.jsonl" }), true);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session" }), false);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-a-suffix" }), false);
});

test("each registration receives an independent idempotent disposer", () => {
  const provider = {
    name: "reloadable-provider",
    sessionId: "session-reload",
    isActive: () => true,
  };
  const disposeOld = registerSessionLivenessProvider(provider);
  const disposeReplacement = registerSessionLivenessProvider(provider);

  disposeOld();
  disposeOld();
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-reload" }), true);

  disposeReplacement();
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-reload" }), false);
});

test("malformed registrations are rejected", () => {
  assert.throws(() => registerSessionLivenessProvider({
    name: "invalid-provider",
    sessionId: "",
    isActive: () => true,
  }), /sessionId must be a non-empty string/);
});

test("provider failures preserve the matching session", (t) => {
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(" "));
  t.after(() => { console.error = originalError; });
  const disposeThrowing = registerSessionLivenessProvider({
    name: "broken-provider",
    sessionId: "session-broken",
    isActive: () => {
      throw new Error("probe failed");
    },
  });
  const disposeMalformed = registerSessionLivenessProvider({
    name: "malformed-provider",
    sessionId: "session-malformed",
    isActive: () => "yes",
  });
  t.after(disposeThrowing);
  t.after(disposeMalformed);

  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-broken" }), true);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-malformed" }), true);
  assert.match(errors.join("\n"), /broken-provider.*probe failed/);
  assert.match(errors.join("\n"), /malformed-provider.*must return a boolean/);
});

test("non-stringifiable provider failures preserve the session until recovery", (t) => {
  t.mock.method(console, "error", () => {});
  const error = Object.create(null);
  let failing = true;
  t.after(registerSessionLivenessProvider({
    name: "non-stringifiable-provider",
    sessionId: "session-non-stringifiable",
    isActive: () => {
      if (failing) throw error;
      return false;
    },
  }));

  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-non-stringifiable" }), true);
  failing = false;
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-non-stringifiable" }), false);
});

// ── Debug panel: listing providers ───────────────────────────────────────────

test("lists extensions' providers, asking only one session's whether they are active, without logging", (t) => {
  const errors = t.mock.method(console, "error", () => {});
  let asked = 0;
  const register = (provider) => t.after(registerSessionLivenessProvider(provider));
  register({ name: "busy", sessionId: "session-providers", isActive: () => { asked += 1; return true; } });
  register({ name: "throws", sessionId: "session-providers", isActive: () => { asked += 1; throw new Error("probe failed"); } });
  register({ name: "not-boolean", sessionId: "session-providers", isActive: () => { asked += 1; return "yes"; } });
  register({ name: "by-file", sessionId: "other-id", sessionFile: "/tmp/session-providers.jsonl", isActive: () => { asked += 1; return false; } });
  register({ name: "elsewhere", sessionId: "session-elsewhere", isActive: () => { asked += 1; return true; } });

  const registered = listRegisteredSessionLivenessProviders()
    .filter((provider) => ["session-providers", "other-id", "session-elsewhere"].includes(provider.sessionId));
  assert.deepEqual(registered.map((provider) => provider.name), ["busy", "throws", "not-boolean", "by-file", "elsewhere"]);
  assert.deepEqual(registered[3], { name: "by-file", sessionId: "other-id", sessionFile: "/tmp/session-providers.jsonl" });
  assert.equal(asked, 0, "a registered-provider listing runs no extension code");

  const listed = listSessionLivenessProviders({ sessionId: "session-providers", sessionFile: "/tmp/session-providers.jsonl" });
  assert.deepEqual(listed.map(({ name, active, byFile }) => ({ name, active, byFile })), [
    { name: "busy", active: true, byFile: false },
    { name: "throws", active: "error", byFile: false },
    { name: "not-boolean", active: "error", byFile: false },
    { name: "by-file", active: false, byFile: true },
  ]);
  assert.equal(asked, 4, "only the session's own providers are asked");
  assert.equal(errors.mock.callCount(), 0);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-elsewhere" }), true, "listing changed no registration");
});

test("a registry made by older code cannot list its providers", async (t) => {
  const key = Symbol.for(SESSION_LIVENESS_REGISTRY_KEY);
  const current = globalThis[key];
  // What a registry from before list() existed looks like after a hot reload.
  globalThis[key] = { version: 1, register: () => () => {}, hasActiveProvider: () => false };
  t.after(() => { globalThis[key] = current; });
  const fresh = await createJiti(import.meta.url, { moduleCache: false }).import("./session-liveness.ts");
  assert.equal(fresh.listRegisteredSessionLivenessProviders(), null);
  assert.equal(fresh.listSessionLivenessProviders({ sessionId: "session-a" }), null);
});

test("a holder id is 1-64 letters, digits, - or _", () => {
  for (const holder of ["a", "page-1_X", "x".repeat(64)]) assert.equal(isValidLivenessHolder(holder), true, holder);
  for (const holder of [null, undefined, "", "x".repeat(65), "bad holder", "a\nb", "ünï", 7]) {
    assert.equal(isValidLivenessHolder(holder), false, String(holder));
  }
});
