import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  CONCRETE_TOOL_PRESET_VALUES,
  CONFIGURED_TOOL_PRESET,
  TOOL_PRESET_VALUES,
  PRESET_DEFAULT,
  PRESET_FULL,
  PRESET_NONE,
  PRESET_READ_ONLY,
  CUSTOM_TOOL_SELECTION,
  SELECTABLE_BUILTIN_TOOLS,
  getActiveBuiltinToolNames,
  getBuiltinToolCheckboxState,
  getPresetFromToolNames,
  getPresetFromTools,
  getToolNamesForPreset,
  getToolSelectionLabel,
  isConcreteToolPreset,
  isToolPreset,
  toggleBuiltinToolName,
} = await jiti.import("./tool-presets.ts");

const BUILTIN_NAMES = ["bash", "powershell", "read", "edit", "write", "grep", "find", "ls"];

function toolEntries(activeNames, customNames = []) {
  const active = new Set(activeNames);
  return [...BUILTIN_NAMES, ...customNames].map((name) => ({
    name,
    description: name,
    active: active.has(name),
  }));
}

test("maps every tool preset to its built-in tools", () => {
  assert.deepEqual(getToolNamesForPreset("none"), PRESET_NONE);
  assert.deepEqual(getToolNamesForPreset("read-only"), PRESET_READ_ONLY);
  assert.deepEqual(getToolNamesForPreset("default"), PRESET_DEFAULT);
  assert.deepEqual(getToolNamesForPreset("full"), PRESET_FULL);
  assert.deepEqual(PRESET_READ_ONLY, ["read", "grep", "find", "ls"]);
});

test("recognizes presets while ignoring active custom tools", () => {
  const customNames = ["web_search", "delegate"];

  assert.equal(getPresetFromTools(toolEntries([], customNames)), "none");
  assert.equal(
    getPresetFromTools(toolEntries([...PRESET_READ_ONLY, ...customNames], customNames)),
    "read-only",
  );
  assert.equal(
    getPresetFromTools(toolEntries([...PRESET_DEFAULT, ...customNames], customNames)),
    "default",
  );
  assert.equal(
    getPresetFromTools(toolEntries([...PRESET_FULL, ...customNames], customNames)),
    "full",
  );
});

test("returns fresh tool arrays that callers can safely modify", () => {
  const names = getToolNamesForPreset("read-only");
  names.push("custom");
  assert.deepEqual(getToolNamesForPreset("read-only"), PRESET_READ_ONLY);
});

test("recognizes PowerShell as the shell in standard presets", () => {
  assert.equal(
    getPresetFromTools(toolEntries(["read", "powershell", "edit", "write"])),
    "default",
  );
  assert.equal(
    getPresetFromTools(toolEntries(["powershell", "read", "edit", "write", "grep", "find", "ls"])),
    "full",
  );
});

test("the configured preset stands for \"no explicit override\"", () => {
  // Undefined is what makes callers omit toolNames, so pi resolves defaultTools (#700).
  assert.equal(getToolNamesForPreset(CONFIGURED_TOOL_PRESET), undefined);
  assert.equal(CONFIGURED_TOOL_PRESET, "configured");

  assert.ok(isToolPreset(CONFIGURED_TOOL_PRESET));
  assert.ok(!isConcreteToolPreset(CONFIGURED_TOOL_PRESET));
  assert.deepEqual(
    TOOL_PRESET_VALUES.filter((preset) => !CONCRETE_TOOL_PRESET_VALUES.includes(preset)),
    [CONFIGURED_TOOL_PRESET],
  );

  // Every concrete preset still resolves to a real tool list.
  for (const preset of CONCRETE_TOOL_PRESET_VALUES) {
    assert.ok(Array.isArray(getToolNamesForPreset(preset)), preset);
  }
});

test("an active tool set never maps back to the configured preset", () => {
  for (const tools of [PRESET_NONE, PRESET_READ_ONLY, PRESET_DEFAULT, PRESET_FULL, ["read", "grep"]]) {
    assert.ok(isConcreteToolPreset(getPresetFromToolNames(tools)), tools.join(","));
  }
});

test("labels a selection with the preset it spells exactly, else custom", () => {
  assert.equal(getToolSelectionLabel(undefined), CONFIGURED_TOOL_PRESET);
  for (const preset of CONCRETE_TOOL_PRESET_VALUES) {
    assert.equal(getToolSelectionLabel(getToolNamesForPreset(preset)), preset);
  }
  // Order does not matter, and powershell stands in for bash as in the presets.
  assert.equal(getToolSelectionLabel(["write", "edit", "powershell", "read"]), "default");
  // getPresetFromToolNames() files these under "default"; the label must not.
  assert.equal(getToolSelectionLabel(["read", "grep"]), CUSTOM_TOOL_SELECTION);
  assert.equal(getToolSelectionLabel(["bash"]), CUSTOM_TOOL_SELECTION);
});

test("lists a session's active built-in tools in menu order, without extension tools", () => {
  const tools = toolEntries(["ls", "powershell", "read"], ["lookup_clause_rule", "mcp__docs__search"])
    .map((tool) => tool.name === "lookup_clause_rule" ? { ...tool, active: true } : tool);
  assert.deepEqual(getActiveBuiltinToolNames(tools), ["read", "ls", "bash"]);
  assert.deepEqual(getActiveBuiltinToolNames(toolEntries([])), []);
});

test("toggles one built-in tool and keeps the menu order", () => {
  assert.deepEqual(toggleBuiltinToolName([], "read"), ["read"]);
  assert.deepEqual(toggleBuiltinToolName(["bash", "read"], "grep"), ["read", "grep", "bash"]);
  assert.deepEqual(toggleBuiltinToolName(["read", "grep"], "read"), ["grep"]);
  assert.deepEqual(toggleBuiltinToolName(["powershell"], "bash"), []);
  // Every selectable tool is one the server accepts in a pinned selection.
  assert.deepEqual([...SELECTABLE_BUILTIN_TOOLS].sort(), [...PRESET_FULL].sort());
});

test("keeps the last checked tool on and waits for unknown or pending tools", () => {
  assert.deepEqual(getBuiltinToolCheckboxState(["read", "grep"], "read", false), { checked: true, disabled: false, isLastChecked: false });
  assert.deepEqual(getBuiltinToolCheckboxState(["read"], "read", false), { checked: true, disabled: true, isLastChecked: true });
  assert.deepEqual(getBuiltinToolCheckboxState(["read"], "bash", false), { checked: false, disabled: false, isLastChecked: false });
  // An unpinned session with no built-in tools can still switch one on.
  assert.deepEqual(getBuiltinToolCheckboxState([], "read", false), { checked: false, disabled: false, isLastChecked: false });
  assert.equal(getBuiltinToolCheckboxState(null, "read", false).disabled, true);
  assert.equal(getBuiltinToolCheckboxState(["read", "grep"], "grep", true).disabled, true);
});
