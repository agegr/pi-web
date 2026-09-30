import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENTS_REFRESH_ACTIVATION_MS,
  AGENTS_REFRESH_POLL_MS,
  createAgentsRefreshController,
  shouldRefreshAgents,
} from "./useAgentsRefresh.ts";

/**
 * The poll reads `document.visibilityState` and the visibilitychange nudge, so
 * the tests drive a stub with both. Timers stay real until a test asks for fake
 * ones.
 */
function fakeDocument(visibilityState = "visible") {
  const listeners = new Set();
  return {
    visibilityState,
    listeners,
    addEventListener(type, handler) {
      if (type === "visibilitychange") listeners.add(handler);
    },
    removeEventListener(type, handler) {
      if (type === "visibilitychange") listeners.delete(handler);
    },
  };
}

const visibleGate = { active: true, draftDirty: false, busy: false };

test("a poll needs the visible section, a visible tab, a clean draft, and no write", () => {
  assert.equal(shouldRefreshAgents(visibleGate, "visible"), true);
  assert.equal(shouldRefreshAgents({ ...visibleGate, active: false }, "visible"), false);
  assert.equal(shouldRefreshAgents(visibleGate, "hidden"), false);
  assert.equal(shouldRefreshAgents({ ...visibleGate, draftDirty: true }, "visible"), false);
  assert.equal(shouldRefreshAgents({ ...visibleGate, busy: true }, "visible"), false);
});

test("refetches on the hidden -> visible edge but not on the panel's own mount", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const refresh = t.mock.fn(async () => {});
  const controller = createAgentsRefreshController({
    gate: () => visibleGate,
    refresh,
    pollDocument: fakeDocument(),
  });

  controller.sync(true);
  t.mock.timers.tick(AGENTS_REFRESH_ACTIVATION_MS * 4);
  // Mounting loadProfiles already fetched; activating again would double-fetch.
  assert.equal(refresh.mock.callCount(), 0);

  controller.sync(false);
  controller.sync(true);
  t.mock.timers.tick(AGENTS_REFRESH_ACTIVATION_MS - 1);
  assert.equal(refresh.mock.callCount(), 0, "the refetch waits out the debounce");
  t.mock.timers.tick(1);
  assert.equal(refresh.mock.callCount(), 1);

  // Stale-hidden edges stay debounced away instead of queueing more fetches.
  controller.sync(false);
  controller.sync(true);
  controller.sync(false);
  t.mock.timers.tick(AGENTS_REFRESH_ACTIVATION_MS * 2);
  assert.equal(refresh.mock.callCount(), 1);
  controller.dispose();
});

test("the activation refetch re-checks the gate instead of bypassing it", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const gate = { ...visibleGate, draftDirty: false };
  const refresh = t.mock.fn(async () => {});
  const controller = createAgentsRefreshController({
    gate: () => gate,
    refresh,
    pollDocument: fakeDocument(),
  });

  controller.sync(true);
  controller.sync(false);
  controller.sync(true);
  // The draft goes dirty while the debounce is still pending, so the refetch that
  // lands after it must read the gate rather than the edge that queued it.
  gate.draftDirty = true;
  t.mock.timers.tick(AGENTS_REFRESH_ACTIVATION_MS);
  assert.equal(refresh.mock.callCount(), 0, "a dirty draft outranks the activation refetch");

  // Clean again: the next activation edge refetches, exactly once.
  gate.draftDirty = false;
  controller.sync(false);
  controller.sync(true);
  t.mock.timers.tick(AGENTS_REFRESH_ACTIVATION_MS - 1);
  assert.equal(refresh.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.equal(refresh.mock.callCount(), 1);
  controller.dispose();
});

test("polls while visible and skips hidden tabs until the tab returns", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const document = fakeDocument("hidden");
  const refresh = t.mock.fn(async () => {});
  const controller = createAgentsRefreshController({
    gate: () => visibleGate,
    refresh,
    pollDocument: document,
  });

  controller.sync(true);
  t.mock.timers.tick(AGENTS_REFRESH_POLL_MS * 3);
  // A background tab has no reason to re-read the same files.
  assert.equal(refresh.mock.callCount(), 0);

  document.visibilityState = "visible";
  t.mock.timers.tick(AGENTS_REFRESH_POLL_MS);
  assert.equal(refresh.mock.callCount(), 1);
  document.visibilityState = "hidden";
  t.mock.timers.tick(AGENTS_REFRESH_POLL_MS * 3);
  assert.equal(refresh.mock.callCount(), 1);
  controller.dispose();
});

test("a tab that becomes visible again refreshes without waiting for the next interval", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const document = fakeDocument("hidden");
  const refresh = t.mock.fn(async () => {});
  const controller = createAgentsRefreshController({
    gate: () => visibleGate,
    refresh,
    pollDocument: document,
  });

  controller.sync(true);
  document.visibilityState = "visible";
  for (const handler of document.listeners) handler();
  assert.equal(refresh.mock.callCount(), 1);
  assert.equal(document.listeners.size, 1);
  controller.dispose();
});

test("a draft with unsaved edits suspends polling until it is clean again", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const gate = { ...visibleGate, draftDirty: true };
  const refresh = t.mock.fn(async () => {});
  const controller = createAgentsRefreshController({
    gate: () => gate,
    refresh,
    pollDocument: fakeDocument(),
  });

  controller.sync(true);
  t.mock.timers.tick(AGENTS_REFRESH_POLL_MS * 3);
  assert.equal(refresh.mock.callCount(), 0);

  gate.draftDirty = false;
  t.mock.timers.tick(AGENTS_REFRESH_POLL_MS);
  assert.equal(refresh.mock.callCount(), 1);
  controller.dispose();
});

test("a save, override or eject in flight suspends polling without queueing a fetch", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const gate = { ...visibleGate, busy: true };
  const refresh = t.mock.fn(async () => {});
  const controller = createAgentsRefreshController({
    gate: () => gate,
    refresh,
    pollDocument: fakeDocument(),
  });

  controller.sync(true);
  t.mock.timers.tick(AGENTS_REFRESH_POLL_MS * 3);
  assert.equal(refresh.mock.callCount(), 0);

  gate.busy = false;
  t.mock.timers.tick(AGENTS_REFRESH_POLL_MS);
  assert.equal(refresh.mock.callCount(), 1);
  controller.dispose();
});

test("an in-flight refresh swallows interval ticks until it settles", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let release;
  const refresh = t.mock.fn(() => new Promise((resolve) => { release = resolve; }));
  const controller = createAgentsRefreshController({
    gate: () => visibleGate,
    refresh,
    pollDocument: fakeDocument(),
  });

  controller.sync(true);
  t.mock.timers.tick(AGENTS_REFRESH_POLL_MS);
  t.mock.timers.tick(AGENTS_REFRESH_POLL_MS * 3);
  assert.equal(refresh.mock.callCount(), 1);

  release();
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(AGENTS_REFRESH_POLL_MS);
  assert.equal(refresh.mock.callCount(), 2);
  controller.dispose();
});

test("disposing and deactivating stop the interval, the nudge and an in-flight refresh", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const document = fakeDocument();
  let aborted = false;
  const refresh = t.mock.fn((signal) => {
    signal.addEventListener("abort", () => { aborted = true; });
    return new Promise(() => {});
  });
  const controller = createAgentsRefreshController({
    gate: () => visibleGate,
    refresh,
    pollDocument: document,
  });

  controller.sync(true);
  t.mock.timers.tick(AGENTS_REFRESH_POLL_MS);
  assert.equal(refresh.mock.callCount(), 1);
  assert.equal(document.listeners.size, 1);

  controller.dispose();
  assert.equal(document.listeners.size, 0);
  assert.equal(aborted, true, "the in-flight request is cancelled with the panel");
  t.mock.timers.tick(AGENTS_REFRESH_POLL_MS * 3);
  assert.equal(refresh.mock.callCount(), 1);

  // Strict Mode's dispose/re-run cycle must leave polling working, not dead.
  controller.sync(true);
  t.mock.timers.tick(AGENTS_REFRESH_POLL_MS);
  assert.equal(refresh.mock.callCount(), 2);

  controller.sync(false);
  t.mock.timers.tick(AGENTS_REFRESH_POLL_MS * 3);
  assert.equal(refresh.mock.callCount(), 2);
  controller.dispose();
});
