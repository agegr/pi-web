import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error("Invalid settings.json: expected an object");
  return parsed;
}

function readRetryObject(settings: Record<string, unknown>): Record<string, unknown> | undefined {
  if (settings.retry === undefined) return undefined;
  if (!isRecord(settings.retry)) {
    throw new Error("Invalid settings.json: retry must be an object");
  }
  return settings.retry;
}

function readRetryEnabled(retry: Record<string, unknown> | undefined): boolean {
  return retry?.enabled === undefined ? true : retry.enabled === true;
}

function readMaxRetries(retry: Record<string, unknown> | undefined): number {
  const value = retry?.maxRetries;
  if (value === undefined || !isNumber(value) || !Number.isInteger(value) || value < 0 || value > 20) {
    return 3;
  }
  return value;
}

function readBaseDelayMs(retry: Record<string, unknown> | undefined): number {
  const value = retry?.baseDelayMs;
  if (value === undefined || !isNumber(value) || !Number.isInteger(value) || value < 100 || value > 60000) {
    return 2000;
  }
  return value;
}

export function getRetrySettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "settings.json");
}

export interface RetrySettingsSnapshot {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
}

export async function readRetrySettings(
  settingsPath = getRetrySettingsPath(),
): Promise<RetrySettingsSnapshot> {
  if (!existsSync(settingsPath)) {
    return { enabled: true, maxRetries: 3, baseDelayMs: 2000 };
  }
  const release = await lockfile.lock(settingsPath, { realpath: false, retries: 10 });
  try {
    const settings = parseSettings(settingsPath);
    const retry = readRetryObject(settings);
    return {
      enabled: readRetryEnabled(retry),
      maxRetries: readMaxRetries(retry),
      baseDelayMs: readBaseDelayMs(retry),
    };
  } finally {
    await release();
  }
}

export async function writeRetrySettings(
  snapshot: Partial<RetrySettingsSnapshot>,
  settingsPath = getRetrySettingsPath(),
): Promise<RetrySettingsSnapshot> {
  mkdirSync(dirname(settingsPath), { recursive: true });
  try {
    writeFileSync(settingsPath, "{}", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const release = await lockfile.lock(settingsPath, { realpath: false, retries: 10 });
  try {
    const settings = parseSettings(settingsPath);
    let retry = readRetryObject(settings);
    if (!retry) {
      retry = {};
      settings.retry = retry;
    }
    if (snapshot.enabled !== undefined) {
      if (typeof snapshot.enabled !== "boolean") {
        throw new Error("enabled must be a boolean");
      }
      retry.enabled = snapshot.enabled;
    }
    if (snapshot.maxRetries !== undefined) {
      if (typeof snapshot.maxRetries !== "number" || !Number.isInteger(snapshot.maxRetries) || snapshot.maxRetries < 0 || snapshot.maxRetries > 20) {
        throw new Error("maxRetries must be an integer between 0 and 20");
      }
      retry.maxRetries = snapshot.maxRetries;
    }
    if (snapshot.baseDelayMs !== undefined) {
      if (typeof snapshot.baseDelayMs !== "number" || !Number.isInteger(snapshot.baseDelayMs) || snapshot.baseDelayMs < 100 || snapshot.baseDelayMs > 60000) {
        throw new Error("baseDelayMs must be an integer between 100 and 60000");
      }
      retry.baseDelayMs = snapshot.baseDelayMs;
    }
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
    chmodSync(settingsPath, 0o600);
    return {
      enabled: readRetryEnabled(retry),
      maxRetries: readMaxRetries(retry),
      baseDelayMs: readBaseDelayMs(retry),
    };
  } finally {
    await release();
  }
}
