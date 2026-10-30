import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  DEFAULT_PI_WEB_SETTINGS,
  PI_WEB_SETTINGS_VERSION,
  applyPiWebSettingsPatch,
  normalizePiWebSettings,
  parsePiWebSettingsRequest,
  piWebSettingsDocument,
  piWebSettingsFromResponse,
} = await jiti.import("./pi-web-settings-shared.ts");

test("the defaults are all off, with Enter sending", () => {
  assert.deepEqual({ ...DEFAULT_PI_WEB_SETTINGS }, {
    thinkingExpandedDefault: false,
    quoteSelection: false,
    enterSendMode: "enter",
  });
});

test("a file's contents read as settings, unknown or misspelled values taking their defaults", () => {
  assert.deepEqual(normalizePiWebSettings({ version: 1 }), { ...DEFAULT_PI_WEB_SETTINGS });
  assert.deepEqual(
    normalizePiWebSettings({ version: 1, thinkingExpandedDefault: true, quoteSelection: true, enterSendMode: "ctrlEnter" }),
    { thinkingExpandedDefault: true, quoteSelection: true, enterSendMode: "ctrlEnter" },
  );
  // A hand edit: unknown fields are the caller's, wrong types fall back.
  assert.deepEqual(
    normalizePiWebSettings({ version: 1, thinkingExpandedDefault: "yes", quoteSelection: true, enterSendMode: "escape", future: 1 }),
    { ...DEFAULT_PI_WEB_SETTINGS, quoteSelection: true },
  );
  // Not settings at all, or another version's.
  assert.equal(normalizePiWebSettings(null), null);
  assert.equal(normalizePiWebSettings([]), null);
  assert.equal(normalizePiWebSettings("x"), null);
  assert.equal(normalizePiWebSettings({ version: 2 }), null);
});

test("a request is any subset of the settings, each in its own type", () => {
  assert.deepEqual(parsePiWebSettingsRequest({ quoteSelection: true }), { ok: true, patch: { quoteSelection: true } });
  assert.deepEqual(
    parsePiWebSettingsRequest({ thinkingExpandedDefault: true, enterSendMode: "ctrlEnter", unknown: 1 }),
    { ok: true, patch: { thinkingExpandedDefault: true, enterSendMode: "ctrlEnter" } },
  );
  assert.deepEqual(parsePiWebSettingsRequest({}), {
    ok: false,
    error: "Send at least one of thinkingExpandedDefault, quoteSelection or enterSendMode",
  });
  assert.equal(parsePiWebSettingsRequest({ thinkingExpandedDefault: 1 }).ok, false);
  assert.equal(parsePiWebSettingsRequest({ quoteSelection: "on" }).ok, false);
  assert.equal(parsePiWebSettingsRequest({ enterSendMode: "tab" }).ok, false);
  assert.equal(parsePiWebSettingsRequest(null).ok, false);
  assert.equal(parsePiWebSettingsRequest([]).ok, false);
});

test("applying a patch says whether anything changed", () => {
  const state = { ...DEFAULT_PI_WEB_SETTINGS };
  assert.deepEqual(applyPiWebSettingsPatch(state, {}), { settings: state, changed: false });
  assert.deepEqual(applyPiWebSettingsPatch(state, { enterSendMode: "enter" }), { settings: state, changed: false });
  assert.deepEqual(applyPiWebSettingsPatch(state, { enterSendMode: "ctrlEnter" }).changed, true);
  assert.deepEqual(
    applyPiWebSettingsPatch(state, { thinkingExpandedDefault: true, quoteSelection: true }),
    { settings: { ...state, thinkingExpandedDefault: true, quoteSelection: true }, changed: true },
  );
});

test("the file keeps only what differs from the defaults, and unknown fields", () => {
  assert.deepEqual(piWebSettingsDocument({ ...DEFAULT_PI_WEB_SETTINGS }), { version: PI_WEB_SETTINGS_VERSION });
  assert.deepEqual(
    piWebSettingsDocument({ thinkingExpandedDefault: true, quoteSelection: false, enterSendMode: "ctrlEnter" }),
    { version: PI_WEB_SETTINGS_VERSION, thinkingExpandedDefault: true, enterSendMode: "ctrlEnter" },
  );
  // The server only ever passes fields it does not know (a newer build's).
  assert.deepEqual(
    piWebSettingsDocument({ ...DEFAULT_PI_WEB_SETTINGS }, { future: "kept" }),
    { version: PI_WEB_SETTINGS_VERSION, future: "kept" },
  );
});

test("a response's settings are read without a version of their own", () => {
  assert.deepEqual(
    piWebSettingsFromResponse({ thinkingExpandedDefault: true, quoteSelection: false, enterSendMode: "ctrlEnter" }),
    { thinkingExpandedDefault: true, quoteSelection: false, enterSendMode: "ctrlEnter" },
  );
  assert.equal(piWebSettingsFromResponse(null), null);
  assert.equal(piWebSettingsFromResponse("nope"), null);
});
