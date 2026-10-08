import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import * as fonts from "../lib/font-preferences.ts";

const source = readFileSync(new URL("./useFontPreferences.ts", import.meta.url), "utf8");
const script = new Script(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText);

function fixture({ initial = {}, blocked = false, server = false } = {}) {
  const stored = new Map(Object.entries(initial));
  const applied = new Map();
  const events = new Map();
  const storage = {
    getItem(key) { if (blocked) throw new Error("blocked"); return stored.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw new Error("blocked"); stored.set(key, value); },
    removeItem(key) { if (blocked) throw new Error("blocked"); stored.delete(key); },
  };
  const exports = {};
  script.runInNewContext({
    exports,
    require(id) {
      if (id === "@/lib/font-preferences") return fonts;
      if (id === "react") return { useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() };
      throw new Error(`Unexpected import ${id}`);
    },
    ...(!server && {
      window: {
        localStorage: storage,
        addEventListener(type, listener) { assert.equal(events.has(type), false); events.set(type, listener); },
        removeEventListener(type, listener) { assert.equal(events.get(type), listener); events.delete(type); },
      },
      document: { documentElement: { style: {
        setProperty(key, value) { applied.set(key, value); },
        removeProperty(key) { applied.delete(key); },
      } } },
    }),
  });
  return { ...exports, stored, applied, events };
}

test("server rendering uses stable defaults without touching browser APIs", () => {
  const store = fixture({ server: true });
  assert.equal(store.useFontPreferences().ui, "");
  assert.equal(store.useFontPreferences().mono, "");
  assert.equal(store.useFontPreferences().uiWeight, 400);
  assert.equal(store.useFontPreferences().monoWeight, 400);
});

test("mounting restores both fonts without opening Settings", () => {
  const store = fixture({ initial: { [fonts.FONT_STORAGE_KEYS.ui]: "Georgia", [fonts.FONT_STORAGE_KEYS.mono]: "Menlo" } });
  assert.equal(store.useFontPreferences().ui, "Georgia");
  assert.equal(store.useFontPreferences().mono, "Menlo");
  assert.equal(store.applied.get("--font-ui"), '"Georgia", var(--font-ui-default)');
  assert.equal(store.applied.get("--font-mono"), '"Menlo", var(--font-mono-default)');
});

test("weight edits preserve font names, notify consumers and reset one font atomically", () => {
  const store = fixture({ initial: {
    [fonts.FONT_STORAGE_KEYS.ui]: "Georgia",
    [fonts.FONT_STORAGE_KEYS.mono]: "Menlo",
    [fonts.FONT_STORAGE_KEYS.monoWeight]: "600",
    "pi-chat-content-font-size": "18",
  } });
  let notifications = 0;
  const stop = store.subscribeFontPreferences(() => notifications++);
  assert.equal(store.useFontPreferences().uiWeight, 400, "older preferences retain Regular");
  assert.equal(store.useFontPreferences().monoWeight, 600);
  assert.equal(store.applied.get("--font-mono-weight"), "600");
  store.setFontWeight("ui", 500);
  assert.equal(store.useFontPreferences().ui, "Georgia");
  assert.equal(store.applied.get("--font-ui-weight"), "500");
  assert.equal(store.stored.get(fonts.FONT_STORAGE_KEYS.uiWeight), "500");
  store.setFontPreference("ui", "Arial");
  assert.equal(store.useFontPreferences().uiWeight, 500, "a new family keeps the chosen weight");
  store.setFontWeight("ui", 500);
  assert.equal(notifications, 2, "an unchanged weight does not notify");
  store.resetFontPreference("ui");
  assert.equal(notifications, 3, "resetting family and weight is one update");
  assert.equal(store.useFontPreferences().ui, "");
  assert.equal(store.useFontPreferences().uiWeight, 400);
  assert.equal(store.applied.has("--font-ui"), false);
  assert.equal(store.applied.has("--font-ui-weight"), false);
  assert.equal(store.stored.has(fonts.FONT_STORAGE_KEYS.uiWeight), false);
  assert.equal(store.useFontPreferences().mono, "Menlo");
  assert.equal(store.useFontPreferences().monoWeight, 600);
  assert.equal(store.stored.get("pi-chat-content-font-size"), "18");
  store.setFontWeight("mono", 400);
  assert.equal(store.applied.has("--font-mono-weight"), false);
  assert.equal(store.stored.has(fonts.FONT_STORAGE_KEYS.monoWeight), false);
  assert.equal(store.useFontPreferences().mono, "Menlo");
  stop();
});

test("edits notify all consumers, preserve typed spaces and reset each font independently", () => {
  const store = fixture();
  let notifications = 0;
  const stop = store.subscribeFontPreferences(() => notifications++);
  let terminalNotifications = 0;
  const stopTerminal = store.subscribeFontPreferences(() => terminalNotifications++);
  store.setFontPreference("ui", "Times New ");
  store.setFontPreference("mono", "Menlo");
  assert.equal(store.useFontPreferences().ui, "Times New ");
  assert.equal(store.stored.get(fonts.FONT_STORAGE_KEYS.ui), "Times New ");
  assert.equal(notifications, 2);
  assert.equal(terminalNotifications, 2);
  store.setFontPreference("mono", "Menlo");
  assert.equal(notifications, 2, "unchanged values do not notify");
  store.setFontPreference("ui", "");
  assert.equal(store.applied.has("--font-ui"), false);
  assert.equal(store.stored.has(fonts.FONT_STORAGE_KEYS.ui), false);
  assert.equal(store.useFontPreferences().mono, "Menlo");
  assert.equal(store.applied.get("--font-mono"), '"Menlo", var(--font-mono-default)');
  stop();
  assert.equal(store.events.has("storage"), true);
  stopTerminal();
  assert.equal(store.events.size, 0);
});

test("storage changes in another tab, including clear, update the current page", () => {
  const store = fixture();
  let notifications = 0;
  const stop = store.subscribeFontPreferences(() => notifications++);
  store.stored.set(fonts.FONT_STORAGE_KEYS.ui, "Arial");
  store.events.get("storage")({ key: "unrelated" });
  assert.equal(notifications, 0);
  store.events.get("storage")({ key: fonts.FONT_STORAGE_KEYS.ui });
  assert.equal(store.useFontPreferences().ui, "Arial");
  assert.equal(store.applied.get("--font-ui"), '"Arial", var(--font-ui-default)');
  store.stored.set(fonts.FONT_STORAGE_KEYS.uiWeight, "500");
  store.events.get("storage")({ key: fonts.FONT_STORAGE_KEYS.uiWeight });
  assert.equal(store.useFontPreferences().uiWeight, 500);
  assert.equal(store.applied.get("--font-ui-weight"), "500");
  store.stored.clear();
  store.events.get("storage")({ key: null });
  assert.equal(store.useFontPreferences().ui, "");
  assert.equal(store.applied.size, 0);
  assert.equal(store.useFontPreferences().uiWeight, 400);
  assert.equal(notifications, 3);
  stop();
});

test("blocked storage and malformed saved values leave usable defaults and live editing", () => {
  const invalid = fixture({ initial: {
    [fonts.FONT_STORAGE_KEYS.ui]: "a".repeat(fonts.FONT_FAMILY_MAX_LENGTH + 1),
    [fonts.FONT_STORAGE_KEYS.uiWeight]: "Light",
    [fonts.FONT_STORAGE_KEYS.monoWeight]: "1000",
  } });
  assert.equal(invalid.useFontPreferences().ui, "");
  assert.equal(invalid.useFontPreferences().uiWeight, 400);
  assert.equal(invalid.useFontPreferences().monoWeight, 400);
  assert.equal(invalid.applied.size, 0);
  const blocked = fixture({ blocked: true });
  assert.equal(blocked.useFontPreferences().mono, "");
  blocked.setFontPreference("mono", "monospace");
  assert.equal(blocked.useFontPreferences().mono, "monospace");
  assert.equal(blocked.applied.get("--font-mono"), "monospace, var(--font-mono-default)");
  blocked.setFontWeight("mono", 300);
  assert.equal(blocked.useFontPreferences().monoWeight, 300);
  assert.equal(blocked.applied.get("--font-mono-weight"), "300");
  blocked.resetFontPreference("mono");
  assert.equal(blocked.applied.size, 0);
});
