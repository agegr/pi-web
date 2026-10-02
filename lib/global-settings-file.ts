import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";

// Locked read-modify-write of the global `settings.json` for the keys pi's
// SettingsManager has no setter for (`defaultTools`). The lock is the one
// SettingsManager takes on the same path, so neither overwrites the other.

export function getGlobalSettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "settings.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error("Invalid settings.json: expected an object");
  return parsed;
}

/** The raw `defaultTools` entries, `+name` / `-name` modifiers included; undefined when unset. */
export function defaultToolEntries(settings: Record<string, unknown>): string[] | undefined {
  if (settings.defaultTools === undefined) return undefined;
  if (
    !Array.isArray(settings.defaultTools)
    || settings.defaultTools.some((name) => typeof name !== "string")
  ) {
    throw new Error("Invalid settings.json: defaultTools must be an array of strings");
  }
  return [...settings.defaultTools as string[]];
}

/** Read the settings under the lock; a missing file reads as `{}` without being created. */
export async function readGlobalSettings<T>(
  settingsPath: string,
  read: (settings: Record<string, unknown>) => T,
): Promise<T> {
  if (!existsSync(settingsPath)) return read({});
  const release = await lockfile.lock(settingsPath, { realpath: false, retries: 10 });
  try {
    return read(parseSettings(settingsPath));
  } finally {
    await release();
  }
}

/**
 * Change the settings under the lock and write them back with mode 0600. `update`
 * mutates the object it is given; a file that does not parse is left untouched.
 */
export async function updateGlobalSettings<T>(
  settingsPath: string,
  update: (settings: Record<string, unknown>) => T,
): Promise<T> {
  mkdirSync(dirname(settingsPath), { recursive: true });
  try {
    writeFileSync(settingsPath, "{}", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const release = await lockfile.lock(settingsPath, { realpath: false, retries: 10 });
  try {
    const settings = parseSettings(settingsPath);
    const result = update(settings);
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
    chmodSync(settingsPath, 0o600);
    return result;
  } finally {
    await release();
  }
}
