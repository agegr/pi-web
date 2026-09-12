import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getSessionTitleSettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "settings.json");
}

function parseSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error("Invalid settings.json: expected an object");
  return parsed;
}

export async function readSessionTitleModel(
  settingsPath = getSessionTitleSettingsPath(),
): Promise<string> {
  if (!existsSync(settingsPath)) return "inherit";
  const release = await lockfile.lock(settingsPath, { realpath: false, retries: 10 });
  try {
    const settings = parseSettings(settingsPath);
    if (typeof settings.sessionTitleModel === "string" && settings.sessionTitleModel.trim()) {
      return settings.sessionTitleModel.trim();
    }
    return "inherit";
  } finally {
    await release();
  }
}

export async function writeSessionTitleModel(
  model: string,
  settingsPath = getSessionTitleSettingsPath(),
): Promise<string> {
  const normalized = model.trim() || "inherit";

  mkdirSync(dirname(settingsPath), { recursive: true });
  try {
    writeFileSync(settingsPath, "{}", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const release = await lockfile.lock(settingsPath, { realpath: false, retries: 10 });
  try {
    const settings = parseSettings(settingsPath);
    if (normalized === "inherit") {
      delete settings.sessionTitleModel;
    } else {
      settings.sessionTitleModel = normalized;
    }
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
    chmodSync(settingsPath, 0o600);
  } finally {
    await release();
  }
  return normalized;
}
