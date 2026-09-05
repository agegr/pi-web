import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  SESSION_LIVENESS_REGISTRY_KEY,
  hasActiveSessionLivenessProvider,
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
