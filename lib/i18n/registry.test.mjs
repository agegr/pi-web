import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getLocalePlugin,
  getSupportedLocales,
  registerLocale,
  resolveBrowserLocale,
} from "./registry.ts";

test("uses the first supported browser language and falls back to English", () => {
  assert.equal(resolveBrowserLocale(["zh-CN", "en-US"]), "zh-CN");
  assert.equal(resolveBrowserLocale(["zh", "en-US"]), "zh-CN");
  assert.equal(resolveBrowserLocale(["en-US", "zh-CN"]), "en");
  assert.equal(resolveBrowserLocale(["fr-FR", "zh-CN"]), "zh-CN");
  assert.equal(resolveBrowserLocale(["fr-FR"]), "en");
  assert.equal(resolveBrowserLocale([]), "en");
});

test("returns only registered locales", () => {
  assert.deepEqual(getSupportedLocales(), ["en", "zh-CN"]);
  assert.equal(getLocalePlugin("en").id, "en");
  assert.equal(getLocalePlugin("missing"), undefined);
});

test("allows a new locale plugin and rejects duplicate ids", () => {
  registerLocale({ id: "test", label: "Test", messages: { "common.ok": "OK" } });
  assert.equal(getLocalePlugin("test")?.label, "Test");
  assert.throws(() => registerLocale({ id: "test", label: "Again", messages: {} }));
});

test("动态注册的语言 id 可通过设置页安全传递给 i18n 上下文", async () => {
  registerLocale({ id: "third-party", label: "Third Party", messages: { "common.ok": "Okay" } });
  assert.equal(getLocalePlugin("third-party")?.id, "third-party");

  const directory = path.dirname(fileURLToPath(import.meta.url));
  const [types, hook, settings] = await Promise.all([
    readFile(path.join(directory, "types.ts"), "utf8"),
    readFile(path.join(directory, "../../hooks/useI18n.tsx"), "utf8"),
    readFile(path.join(directory, "../../components/SettingsModal.tsx"), "utf8"),
  ]);
  assert.match(types, /export type Locale = string;/);
  assert.match(hook, /setLocale: \(locale: Locale\) => void;/);
  assert.match(settings, /onChange=\{event => setLocale\(event\.target\.value\)\}/);
  assert.doesNotMatch(settings, /as Locale/);
});
