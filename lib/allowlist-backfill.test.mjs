import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { syncAllowlist, pruneAllowlistProviders, ensureAllowlistSegments } = await jiti.import("./allowlist-backfill.ts");

function fakeSettings(enabledModels) {
  const state = { enabledModels, saved: null };
  return {
    state,
    getEnabledModels: () => state.enabledModels,
    setEnabledModels: (next) => {
      state.saved = next;
      state.enabledModels = next;
    },
  };
}

function fakeRuntime(providers) {
  const models = providers.flatMap((p) => [{ provider: p, id: `${p}-a` }, { provider: p, id: `${p}-b` }]);
  return { getAvailable: async () => models };
}

// ---- syncAllowlist (availability-based prune; deliberately NO backfill) ----

test("syncAllowlist prunes entries of providers missing from the available list", async () => {
  const settings = fakeSettings(["opencode-go/model-a", "anthropic/claude-x:low"]);
  const result = await syncAllowlist(fakeRuntime(["anthropic"]), settings);
  assert.equal(result.changed, true);
  assert.deepEqual(result.removed, ["opencode-go/model-a"]);
  assert.deepEqual(settings.state.saved, ["anthropic/claude-x:low"]);
});

test("syncAllowlist does NOT backfill missing providers (B1: would revive trimmed-to-empty ones)", async () => {
  // "hidden-p" was trimmed to zero models: absent from a non-empty allowlist.
  // syncAllowlist must leave it absent.
  const settings = fakeSettings(["anthropic/claude-x:low"]);
  const result = await syncAllowlist(fakeRuntime(["anthropic", "hidden-p"]), settings);
  assert.equal(result.changed, false);
  assert.deepEqual(result.added, []);
  assert.equal(settings.state.saved, null);
});

test("syncAllowlist keepProviders protects a temporarily unavailable provider", async () => {
  const settings = fakeSettings(["flaky/model-a:high", "flaky/*", "stable/model-b"]);
  const result = await syncAllowlist(fakeRuntime(["stable"]), settings, undefined, { keepProviders: ["flaky"] });
  assert.equal(result.changed, false);
  assert.equal(settings.state.saved, null);
});

test("syncAllowlist is a no-op in allow-all mode", async () => {
  const empty = fakeSettings([]);
  assert.deepEqual(await syncAllowlist(fakeRuntime(["anthropic"]), empty), { changed: false, added: [], removed: [] });
  assert.equal(empty.state.saved, null);
});

test("syncAllowlist reports a warning instead of throwing when the runtime fails", async () => {
  const settings = fakeSettings(["anthropic/*"]);
  const runtime = { getAvailable: async () => { throw new Error("catalog offline"); } };
  const result = await syncAllowlist(runtime, settings);
  assert.equal(result.changed, false);
  assert.match(result.warning, /catalog offline/);
  assert.equal(settings.state.saved, null);
});

// ---- ensureAllowlistSegments (named-provider backfill) ----

test("ensureAllowlistSegments seeds only the named providers that have no entry", () => {
  const settings = fakeSettings(["anthropic/*"]);
  const result = ensureAllowlistSegments(settings, ["anthropic", "coding-plan", "xiaomi"]);
  assert.equal(result.changed, true);
  assert.deepEqual(result.added, ["coding-plan/*", "xiaomi/*"]);
  assert.deepEqual(settings.state.saved, ["anthropic/*", "coding-plan/*", "xiaomi/*"]);
});

test("ensureAllowlistSegments never touches a trimmed-to-empty provider absent from its list (B1 regression)", () => {
  const settings = fakeSettings(["anthropic/*"]);
  ensureAllowlistSegments(settings, ["coding-plan"]);
  assert.deepEqual(settings.state.saved, ["anthropic/*", "coding-plan/*"]); // "hidden-p" untouched
});

test("ensureAllowlistSegments is a no-op in allow-all mode and when every provider has an entry", () => {
  const empty = fakeSettings([]);
  assert.deepEqual(ensureAllowlistSegments(empty, ["anthropic"]), { changed: false, added: [], removed: [] });
  assert.equal(empty.state.saved, null);

  const seeded = fakeSettings(["anthropic/*", "coding-plan/*"]);
  assert.deepEqual(ensureAllowlistSegments(seeded, ["anthropic", "coding-plan"]), { changed: false, added: [], removed: [] });
  assert.equal(seeded.state.saved, null);
});

// ---- pruneAllowlistProviders (explicit-name prune) ----

test("pruneAllowlistProviders removes every attributable entry of the given providers", () => {
  const settings = fakeSettings([
    "opencode-go/deepseek-v4-flash",
    "opencode-go/deepseek-v4-flash-vision-exp:high",
    "opencode-go/*",
    "opencode-go",
    "anthropic/claude-x:low",
  ]);
  const result = pruneAllowlistProviders(settings, ["opencode-go"]);
  assert.equal(result.changed, true);
  assert.deepEqual(result.removed, [
    "opencode-go/deepseek-v4-flash",
    "opencode-go/deepseek-v4-flash-vision-exp:high",
    "opencode-go/*",
    "opencode-go",
  ]);
  assert.deepEqual(settings.state.saved, ["anthropic/claude-x:low"]);
});

test("pruneAllowlistProviders keeps bare patterns and wildcard-provider globs", () => {
  const entries = ["*", "my-*", "some-model-id", "*/kept", "gone/model"];
  const settings = fakeSettings(entries);
  const result = pruneAllowlistProviders(settings, ["gone"]);
  assert.equal(result.changed, true);
  assert.deepEqual(settings.state.saved, ["*", "my-*", "some-model-id", "*/kept"]);
});

test("pruneAllowlistProviders is a no-op in allow-all mode and when nothing matches", () => {
  const empty = fakeSettings([]);
  assert.deepEqual(pruneAllowlistProviders(empty, ["gone"]), { changed: false, added: [], removed: [] });
  assert.equal(empty.state.saved, null);

  const untouched = fakeSettings(["anthropic/*"]);
  assert.deepEqual(pruneAllowlistProviders(untouched, ["gone"]), { changed: false, added: [], removed: [] });
  assert.equal(untouched.state.saved, null);
});

test("pruneAllowlistProviders removedModels drops exact/level entries but keeps globs", () => {
  const settings = fakeSettings([
    "acme/deleted-model",
    "acme/deleted-model:high",
    "acme/kept-model:low",
    "acme/*",
    "acme/api-*",
  ]);
  const result = pruneAllowlistProviders(settings, [], { acme: ["deleted-model"] });
  assert.equal(result.changed, true);
  assert.deepEqual(settings.state.saved, [
    "acme/kept-model:low",
    "acme/*",
    "acme/api-*",
  ]);
});

test("pruneAllowlistProviders removedModels only strips real thinking-level suffixes", () => {
  const settings = fakeSettings(["acme/model:v2", "acme/model:high"]);
  pruneAllowlistProviders(settings, [], { acme: ["model"] });
  // ":v2" is not a thinking level, so the model id of "acme/model:v2" is
  // "model:v2" which no longer equals the deleted "model" — only ":high" goes.
  assert.deepEqual(settings.state.saved, ["acme/model:v2"]);
});
