import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  getPreferredToolPreset,
  setPreferredToolPreset,
} = await jiti.import("./tool-preset-preference.ts");
const { TOOL_PRESET_VALUES } = await jiti.import("./tool-presets.ts");

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("defaults missing or invalid preferences to the configured preset", () => {
  // Never having picked must not pin pi-web's built-ins over settings.json (#700).
  assert.equal(getPreferredToolPreset(createStorage()), "configured");
  assert.equal(
    getPreferredToolPreset(createStorage({ "pi-tool-preset": "legacy-value" })),
    "configured",
  );
  // An explicit earlier pick is still honoured.
  assert.equal(
    getPreferredToolPreset(createStorage({ "pi-tool-preset": "full" })),
    "full",
  );
});

test("round-trips every supported tool preset", () => {
  const storage = createStorage();
  for (const preset of TOOL_PRESET_VALUES) {
    setPreferredToolPreset(preset, storage);
    assert.equal(storage.values.get("pi-tool-preset"), preset);
    assert.equal(getPreferredToolPreset(storage), preset);
  }
});

test("falls back safely when browser storage is unavailable", () => {
  const unavailable = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };

  assert.equal(getPreferredToolPreset(unavailable), "configured");
  assert.doesNotThrow(() => setPreferredToolPreset("full", unavailable));
  assert.equal(getPreferredToolPreset(null), "configured");
  assert.doesNotThrow(() => setPreferredToolPreset("full", null));
});

test("falls back when accessing window.localStorage throws", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const blockedWindow = {};
  Object.defineProperty(blockedWindow, "localStorage", {
    get() { throw new DOMException("blocked", "SecurityError"); },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: blockedWindow,
  });

  try {
    assert.equal(getPreferredToolPreset(), "configured");
    assert.doesNotThrow(() => setPreferredToolPreset("full"));
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});
