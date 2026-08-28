import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  readPiWebSettings,
  isAutoSessionTitleEnabled,
  writeAutoSessionTitleEnabled,
} = await jiti.import("./auto-title-settings.ts");

function tempSettingsPath() {
  return join(mkdtempSync(join(tmpdir(), "pi-web-settings-")), "pi-web.json");
}

test("missing settings file defaults to enabled", () => {
  const path = tempSettingsPath();
  assert.deepEqual(readPiWebSettings(path), { autoSessionTitle: true });
});

test("readPiWebSettings reflects an explicit disabled flag", () => {
  const path = tempSettingsPath();
  writeAutoSessionTitleEnabled(false, path);
  assert.deepEqual(readPiWebSettings(path), { autoSessionTitle: false });
  writeAutoSessionTitleEnabled(true, path);
  assert.deepEqual(readPiWebSettings(path), { autoSessionTitle: true });
});

test("a wrong-typed autoSessionTitle field falls back to the default", () => {
  const path = tempSettingsPath();
  writeFileSync(path, JSON.stringify({ autoSessionTitle: "no" }), "utf8");
  assert.deepEqual(readPiWebSettings(path), { autoSessionTitle: true });
});

test("an unparseable settings file fail-closes the automatic title hook", () => {
  const path = tempSettingsPath();
  writeFileSync(path, "{ not json", "utf8");
  assert.throws(() => readPiWebSettings(path), /JSON/);
  assert.equal(isAutoSessionTitleEnabled(path), false);
});

test("a valid disabled file disables the hook", () => {
  const path = tempSettingsPath();
  writeAutoSessionTitleEnabled(false, path);
  assert.equal(isAutoSessionTitleEnabled(path), false);
});

test("a non-object settings file throws", () => {
  const path = tempSettingsPath();
  writeFileSync(path, "[1,2]", "utf8");
  assert.throws(() => readPiWebSettings(path), /expected an object/);
});

test("writing preserves unknown sibling fields", () => {
  const path = tempSettingsPath();
  writeFileSync(path, JSON.stringify({ futureField: { keep: true } }), "utf8");
  writeAutoSessionTitleEnabled(false, path);
  const stored = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(stored.futureField.keep, true);
  assert.equal(stored.autoSessionTitle, false);
  assert.equal(stored.version, 1);
});

test("writing creates the settings directory on demand", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "pi-web-settings-")), "nested", "deep");
  const path = join(dir, "pi-web.json");
  mkdirSync(dir, { recursive: true });
  writeAutoSessionTitleEnabled(true, path);
  assert.deepEqual(readPiWebSettings(path), { autoSessionTitle: true });
});
