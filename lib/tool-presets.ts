export interface ToolEntry {
  name: string;
  description: string;
  active: boolean;
  /** Active, but left out of requests: the model calls it only from codemode scripts. */
  declarationHidden?: boolean;
  parameters?: Record<string, unknown>;
  promptGuidelines?: string[];
}

/** Presets that pin an explicit tool list onto the session. */
export const CONCRETE_TOOL_PRESET_VALUES = ["none", "read-only", "default", "full"] as const;
export type ConcreteToolPreset = typeof CONCRETE_TOOL_PRESET_VALUES[number];

/**
 * "configured" is not a tool list: it means "send no override", so pi resolves the
 * loadout from settings.json defaultTools exactly like the `pi` CLI does. Sessions
 * left on it stay unpinned and keep following the setting as it changes.
 */
export const CONFIGURED_TOOL_PRESET = "configured";
export const TOOL_PRESET_VALUES = ["configured", "none", "read-only", "default", "full"] as const;
export type ToolPreset = typeof TOOL_PRESET_VALUES[number];

export const PRESET_NONE: string[] = [];
export const PRESET_READ_ONLY: string[] = ["read", "grep", "find", "ls"];
export const PRESET_DEFAULT: string[] = ["read", "bash", "edit", "write"];
export const PRESET_FULL: string[] = ["bash", "read", "edit", "write", "grep", "find", "ls"];

const BUILTIN_TOOL_NAMES = new Set([...PRESET_FULL, "powershell"]);

export function isToolPreset(value: unknown): value is ToolPreset {
  return typeof value === "string" && (TOOL_PRESET_VALUES as readonly string[]).includes(value);
}

export function isConcreteToolPreset(value: unknown): value is ConcreteToolPreset {
  return typeof value === "string" && (CONCRETE_TOOL_PRESET_VALUES as readonly string[]).includes(value);
}

export function getPresetFromTools(tools: ToolEntry[]): ConcreteToolPreset {
  const activeTools = tools.filter((t) => t.active);
  return getPresetFromToolNames(activeTools.map((tool) => tool.name));
}

export function getPresetFromToolNames(toolNames: readonly string[]): ConcreteToolPreset {
  if (toolNames.length === 0) return "none";

  const active = toolNames
    .map((name) => name === "powershell" ? "bash" : name)
    .filter((name) => BUILTIN_TOOL_NAMES.has(name))
    .sort()
    .join(",");

  if (active === [...PRESET_READ_ONLY].sort().join(",")) return "read-only";
  if (active === [...PRESET_DEFAULT].sort().join(",")) return "default";
  if (active === [...PRESET_FULL].sort().join(",")) return "full";
  return "default";
}

/** Undefined means "no explicit selection": let pi resolve settings.json defaultTools. */
export function getToolNamesForPreset(preset: ToolPreset): string[] | undefined {
  if (preset === CONFIGURED_TOOL_PRESET) return undefined;
  if (preset === "none") return [...PRESET_NONE];
  if (preset === "read-only") return [...PRESET_READ_ONLY];
  if (preset === "full") return [...PRESET_FULL];
  return [...PRESET_DEFAULT];
}

/**
 * The built-in tools the tool menu lists one by one, read-only ones first. They are the
 * names a session's selection may hold (`validateSessionToolSelection()`); `powershell`
 * stands in for `bash` the way the presets treat it.
 */
export const SELECTABLE_BUILTIN_TOOLS: readonly string[] = ["read", "grep", "find", "ls", "edit", "write", "bash"];

/** A pinned selection that no preset spells exactly. Display only: never sent or stored. */
export const CUSTOM_TOOL_SELECTION = "custom";
export type ToolSelectionLabel = ToolPreset | typeof CUSTOM_TOOL_SELECTION;

function toSelectableBuiltinNames(toolNames: readonly string[]): string[] {
  const names = new Set(toolNames.map((name) => name === "powershell" ? "bash" : name));
  return SELECTABLE_BUILTIN_TOOLS.filter((name) => names.has(name));
}

/** The active built-in tools of a session's tool list, in menu order; extension and MCP tools are left out. */
export function getActiveBuiltinToolNames(tools: readonly ToolEntry[]): string[] {
  return toSelectableBuiltinNames(tools.filter((tool) => tool.active).map((tool) => tool.name));
}

/**
 * The preset a selection spells exactly, else custom. Unlike `getPresetFromToolNames()`,
 * which files every unmatched set under "default", this tells "read, grep" apart from
 * the four default tools. Undefined (no pin) is the configured preset.
 */
export function getToolSelectionLabel(toolNames: readonly string[] | undefined): ToolSelectionLabel {
  if (toolNames === undefined) return CONFIGURED_TOOL_PRESET;
  const key = toSelectableBuiltinNames(toolNames).join(",");
  const preset = CONCRETE_TOOL_PRESET_VALUES.find((candidate) => (
    toSelectableBuiltinNames(getToolNamesForPreset(candidate) ?? []).join(",") === key
  ));
  return preset ?? CUSTOM_TOOL_SELECTION;
}

/**
 * One checkbox of the tool menu. Its tools are unknown (null) until an unpinned
 * session reports them, and one switch runs at a time. The last checked tool stays
 * on: an empty selection is Chat only, which also drops extensions and skills, so
 * that stays the preset's to choose.
 */
export function getBuiltinToolCheckboxState(
  selected: readonly string[] | null,
  name: string,
  pending: boolean,
): { checked: boolean; disabled: boolean; isLastChecked: boolean } {
  const checked = selected?.includes(name) ?? false;
  const isLastChecked = checked && selected?.length === 1;
  return { checked, isLastChecked, disabled: selected === null || pending || isLastChecked };
}

/** The selection with one built-in tool switched on or off, in menu order. */
export function toggleBuiltinToolName(toolNames: readonly string[], name: string): string[] {
  const current = toSelectableBuiltinNames(toolNames);
  return current.includes(name)
    ? current.filter((tool) => tool !== name)
    : toSelectableBuiltinNames([...current, name]);
}
