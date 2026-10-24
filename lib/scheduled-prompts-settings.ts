import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

export function getScheduledPromptsSettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "scheduled-prompts", "settings.json");
}

function readStored(settingsPath: string): Record<string, unknown> {
  if (!existsSync(settingsPath)) return {};
  const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid scheduled prompts settings: expected an object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * On unless switched off. Damaged settings fail closed: a file the user wrote to
 * turn the feature off must not leave it running because of a typo.
 */
export function isScheduledPromptsEnabled(settingsPath = getScheduledPromptsSettingsPath()): boolean {
  try {
    return readStored(settingsPath).enabled !== false;
  } catch {
    return false;
  }
}

export function writeScheduledPromptsEnabled(enabled: boolean, settingsPath = getScheduledPromptsSettingsPath()): boolean {
  const stored = (() => {
    try {
      return readStored(settingsPath);
    } catch {
      return {};
    }
  })();
  mkdirSync(dirname(settingsPath), { recursive: true });
  writePrivateFileAtomicSync(settingsPath, JSON.stringify({ ...stored, version: 1, enabled }, null, 2));
  return enabled;
}
