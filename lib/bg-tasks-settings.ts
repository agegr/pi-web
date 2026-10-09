import { existsSync, readFileSync } from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getGlobalSettingsPath, readGlobalSettings, updateGlobalSettings } from "./global-settings-file";

// The `bgTasksEnabled` key of the global settings.json: opt-in switch for the
// background bash extension. Absent reads as disabled; `true` turns it on.
export async function readBgTasksEnabled(settingsPath = getGlobalSettingsPath()): Promise<boolean> {
  return readGlobalSettings(settingsPath, (settings) => settings.bgTasksEnabled === true);
}

/** Sync gate for session setup: built when the session's extensions load. */
export function isBgTasksEnabled(settingsPath = getGlobalSettingsPath(getAgentDir())): boolean {
  try {
    if (!existsSync(settingsPath)) return false;
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
    return typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>).bgTasksEnabled === true;
  } catch {
    return false;
  }
}

export async function writeBgTasksEnabled(
  enabled: boolean,
  settingsPath = getGlobalSettingsPath(),
): Promise<boolean> {
  return updateGlobalSettings(settingsPath, (settings) => {
    if (enabled) settings.bgTasksEnabled = true;
    else delete settings.bgTasksEnabled;
    return enabled;
  });
}
