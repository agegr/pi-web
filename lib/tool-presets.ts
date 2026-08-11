export interface ToolEntry {
  name: string;
  description: string;
  active: boolean;
}

export const TOOL_PRESET_VALUES = ["none", "read-only", "default", "full"] as const;
export type ToolPreset = typeof TOOL_PRESET_VALUES[number];

export const PRESET_NONE: string[] = [];
export const PRESET_READ_ONLY: string[] = ["read", "grep", "find", "ls"];
export const PRESET_DEFAULT: string[] = ["read", "bash", "edit", "write"];
export const PRESET_FULL: string[] = ["bash", "read", "edit", "write", "grep", "find", "ls"];

const BUILTIN_TOOL_NAMES = new Set(PRESET_FULL);

export function isToolPreset(value: unknown): value is ToolPreset {
  return typeof value === "string" && (TOOL_PRESET_VALUES as readonly string[]).includes(value);
}

export function getPresetFromTools(tools: ToolEntry[]): ToolPreset {
  const activeTools = tools.filter((t) => t.active);
  if (activeTools.length === 0) return "none";

  const active = activeTools
    .map((t) => t.name)
    .filter((name) => BUILTIN_TOOL_NAMES.has(name))
    .sort()
    .join(",");

  if (active === [...PRESET_READ_ONLY].sort().join(",")) return "read-only";
  if (active === [...PRESET_DEFAULT].sort().join(",")) return "default";
  if (active === [...PRESET_FULL].sort().join(",")) return "full";
  return "default";
}

export function getToolNamesForPreset(preset: ToolPreset): string[] {
  if (preset === "none") return [...PRESET_NONE];
  if (preset === "read-only") return [...PRESET_READ_ONLY];
  if (preset === "full") return [...PRESET_FULL];
  return [...PRESET_DEFAULT];
}
