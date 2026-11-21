import { CONFIGURED_TOOL_PRESET, isToolPreset, type ToolPreset } from "./tool-presets";
import { getBrowserStorage } from "./browser-storage";

const STORAGE_KEY = "pi-tool-preset";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Only an explicit pick from the tool dropdown is ever stored, so a missing value
 * means "never chose". Those users fall back to the configured preset rather than
 * silently pinning pi-web's four built-ins over settings.json defaultTools (#700).
 */
export function getPreferredToolPreset(
  storage: StorageLike | null = getBrowserStorage(),
): ToolPreset {
  if (!storage) return CONFIGURED_TOOL_PRESET;
  try {
    const value = storage.getItem(STORAGE_KEY);
    return isToolPreset(value) ? value : CONFIGURED_TOOL_PRESET;
  } catch {
    return CONFIGURED_TOOL_PRESET;
  }
}

export function setPreferredToolPreset(
  preset: ToolPreset,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, preset);
  } catch {
    // Browser storage is best-effort.
  }
}
