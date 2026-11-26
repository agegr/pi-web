import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  describeSettingsError,
  initialFieldValues,
  localizedText,
  normalizeSettingsSection,
  normalizeSettingsSections,
  normalizeSettingsStatus,
  MAX_SECTION_FIELDS,
  MAX_SETTINGS_SECTIONS,
} = await jiti.import("./settings-sections.ts");

const text = (en) => ({ en });

function section(overrides = {}) {
  return {
    id: "ext:example",
    label: text("Example"),
    fields: [{ kind: "text", key: "url", label: text("Address") }],
    ...overrides,
  };
}

test("nothing declared and nothing renderable means no sections", () => {
  assert.equal(normalizeSettingsSections(undefined).length, 0);
  assert.equal(normalizeSettingsSections("nope").length, 0);
  assert.equal(normalizeSettingsSections([]).length, 0);
});

test("keeps the descriptors this build can render", () => {
  const kept = normalizeSettingsSections([
    section(),
    section({ id: "ext:second", icon: "sync", applyLabel: text("Apply"), notes: [text("A note")], fields: [
      { kind: "password", key: "token", label: text("Token") },
      { kind: "switch", key: "on", label: text("On") },
      { kind: "select", key: "mode", label: text("Mode"), options: [{ value: "a", label: text("A") }] },
      { kind: "readonly", label: text("Server"), value: "http://127.0.0.1:1", mono: true },
    ] }),
  ]);
  assert.deepEqual(kept.map((item) => item.id), ["ext:example", "ext:second"]);
  assert.equal(kept[1].icon, "sync");
  assert.equal(kept[1].applyLabel.en, "Apply");
  assert.equal(kept[1].fields.length, 4);
  assert.equal(kept[1].fields[2].options.length, 1);
  assert.equal(kept[1].fields[3].mono, true);
  assert.equal(kept[1].notes[0].en, "A note");
});

test("drops a descriptor with any part this build cannot draw", () => {
  const rejected = [
    section({ id: "mcp" }),                   // a built-in's name
    section({ id: "example" }),               // no ext: prefix
    section({ id: "ext:Bad_Case" }),
    section({ fields: [] }),
    section({ fields: [{ kind: "textarea", key: "a", label: text("A") }] }),
    section({ label: "   " }),
    section({ fields: [{ kind: "text", key: "with space", label: text("A") }] }),
    section({ fields: [{ kind: "select", key: "mode", label: text("Mode"), options: [{ value: "a" }] }] }),
    section({ notes: [text("a"), text("b"), text("c"), text("d"), text("e")] }),
    section({ fields: Array.from({ length: MAX_SECTION_FIELDS + 1 }, (_, index) => (
      { kind: "text", key: `k${index}`, label: text(`K${index}`) }
    )) }),
    null,
    42,
  ];
  for (const entry of rejected) assert.equal(normalizeSettingsSection(entry), null, JSON.stringify(entry)?.slice(0, 60));
  assert.equal(normalizeSettingsSections(rejected).length, 0);
});

test("bounds the number of sections and keeps the first of a repeated id", () => {
  const many = Array.from({ length: MAX_SETTINGS_SECTIONS + 4 }, (_, index) => section({ id: `ext:s${index}` }));
  assert.equal(normalizeSettingsSections(many).length, MAX_SETTINGS_SECTIONS);

  const repeated = normalizeSettingsSections([
    section({ id: "ext:same", label: text("First") }),
    section({ id: "ext:same", label: text("Second") }),
  ]);
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].label.en, "First");
});

test("reads a label in the active language, falling back to en", () => {
  const label = { en: "Service", "zh-CN": "服务" };
  assert.equal(localizedText(label, "en"), "Service");
  assert.equal(localizedText(label, "zh-CN"), "服务");
  assert.equal(localizedText(label, "zh-TW"), "Service");
  assert.equal(localizedText("plain", "zh-CN"), "plain");
});

test("a status line needs a known state and a text", () => {
  assert.deepEqual(normalizeSettingsStatus({ state: "ok", text: text("Running") }), { state: "ok", text: { en: "Running" } });
  assert.equal(normalizeSettingsStatus({ state: "green", text: text("Running") }), null);
  assert.equal(normalizeSettingsStatus({ state: "ok" }), null);
  assert.equal(normalizeSettingsStatus(undefined), null);
});

test("the form starts from the declared fields only", () => {
  const descriptor = normalizeSettingsSection(section({ fields: [
    { kind: "text", key: "url", label: text("Address") },
    { kind: "switch", key: "enabled", label: text("Enabled") },
    { kind: "readonly", label: text("Server"), value: "http://127.0.0.1:1" },
  ] }));

  assert.deepEqual(initialFieldValues(descriptor), { url: "", enabled: false });
  // A value the extension did not declare never reaches the form, and a switch is true only when it is true.
  assert.deepEqual(initialFieldValues(descriptor, { url: 7, enabled: "true", extra: "kept out" }), { url: "", enabled: false });
  assert.deepEqual(initialFieldValues(descriptor, { url: "http://hub", enabled: true }), { url: "http://hub", enabled: true });
});

test("a rejection shows the extension's own message", () => {
  assert.equal(describeSettingsError(new Error("Address is required"), "fallback"), "Address is required");
  assert.equal(describeSettingsError("  offline  ", "fallback"), "offline");
  assert.equal(describeSettingsError(undefined, "fallback"), "fallback");
  assert.equal(describeSettingsError({}, "fallback"), "fallback");
});
