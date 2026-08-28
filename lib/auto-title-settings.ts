import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

/**
 * Pi-web-owned settings stored at ~/.pi/agent/pi-web.json. Only fields pi-web
 * itself defines live here; unknown fields are preserved on write.
 *
 * `autoSessionTitle` defaults to true when absent. A file that exists but
 * cannot be parsed throws, which fail-closes the automatic title hook.
 */
export interface PiWebSettings {
  autoSessionTitle: boolean;
}

type StoredPiWebSettings = Record<string, unknown> & {
  version?: unknown;
  autoSessionTitle?: unknown;
};

export function getPiWebSettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web.json");
}

function readStoredSettings(settingsPath: string): StoredPiWebSettings {
  const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid pi-web settings: expected an object");
  }
  return parsed as StoredPiWebSettings;
}

export function readPiWebSettings(
  settingsPath = getPiWebSettingsPath(),
): PiWebSettings {
  // No file yet: the feature default applies (enabled).
  if (!existsSync(settingsPath)) return { autoSessionTitle: true };
  const stored = readStoredSettings(settingsPath);
  return { autoSessionTitle: stored.autoSessionTitle !== false };
}

export function isAutoSessionTitleEnabled(settingsPath = getPiWebSettingsPath()): boolean {
  try {
    return readPiWebSettings(settingsPath).autoSessionTitle;
  } catch (error) {
    console.error(
      "[pi-web] failed to read pi-web settings, automatic session titles disabled:",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

export function writeAutoSessionTitleEnabled(
  enabled: boolean,
  settingsPath = getPiWebSettingsPath(),
): PiWebSettings {
  const stored = existsSync(settingsPath) ? readStoredSettings(settingsPath) : {};
  mkdirSync(dirname(settingsPath), { recursive: true });
  writePrivateFileAtomicSync(settingsPath, JSON.stringify({
    ...stored,
    version: 1,
    autoSessionTitle: enabled,
  }, null, 2));
  return { autoSessionTitle: enabled };
}
