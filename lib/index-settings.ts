import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error("Invalid settings.json: expected an object");
  return parsed;
}

function readSessionIndexObject(settings: Record<string, unknown>): Record<string, unknown> | undefined {
  if (settings.sessionIndex === undefined) return undefined;
  if (!isRecord(settings.sessionIndex)) {
    throw new Error("Invalid settings.json: sessionIndex must be an object");
  }
  return settings.sessionIndex;
}

function readEnabled(obj: Record<string, unknown> | undefined): boolean {
  return obj?.enabled === undefined ? false : obj.enabled === true;
}

export function getSessionIndexSettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "settings.json");
}

export interface SessionIndexSettingsSnapshot {
  enabled: boolean;
}

export async function readSessionIndexSettings(
  settingsPath = getSessionIndexSettingsPath(),
): Promise<SessionIndexSettingsSnapshot> {
  if (!existsSync(settingsPath)) return { enabled: false };
  const release = await lockfile.lock(settingsPath, { realpath: false, retries: 10 });
  try {
    const settings = parseSettings(settingsPath);
    const obj = readSessionIndexObject(settings);
    return { enabled: readEnabled(obj) };
  } finally {
    await release();
  }
}

export async function writeSessionIndexSettings(
  snapshot: Partial<SessionIndexSettingsSnapshot>,
  settingsPath = getSessionIndexSettingsPath(),
): Promise<SessionIndexSettingsSnapshot> {
  mkdirSync(dirname(settingsPath), { recursive: true });
  try {
    writeFileSync(settingsPath, "{}", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const release = await lockfile.lock(settingsPath, { realpath: false, retries: 10 });
  try {
    const settings = parseSettings(settingsPath);
    let obj = readSessionIndexObject(settings);
    if (!obj) {
      obj = {};
      settings.sessionIndex = obj;
    }
    if (snapshot.enabled !== undefined) {
      if (typeof snapshot.enabled !== "boolean") throw new Error("enabled must be a boolean");
      obj.enabled = snapshot.enabled;
    }
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
    chmodSync(settingsPath, 0o600);
    return { enabled: readEnabled(obj) };
  } finally {
    await release();
  }
}
