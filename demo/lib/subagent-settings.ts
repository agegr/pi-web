import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

export interface SubagentSettings {
  builtInEnabled: boolean;
  /** Built-in profiles switched off, in the spelling the file uses. */
  disabledBuiltIns: string[];
  maxConcurrent: number;
}

type StoredSubagentSettings = Record<string, unknown> & {
  version?: unknown;
  builtInEnabled?: unknown;
  disabledBuiltIns?: unknown;
  maxConcurrent?: unknown;
};

export const DEFAULT_SUBAGENT_MAX_CONCURRENT = 10;
export const MAX_SUBAGENT_MAX_CONCURRENT = 32;

function readMaxConcurrent(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SUBAGENT_MAX_CONCURRENT
    ? value
    : DEFAULT_SUBAGENT_MAX_CONCURRENT;
}

/**
 * Built-in profiles have no file to carry `enabled: false`, so their off state is
 * stored here by name. Entries are kept as authored and matched case-insensitively;
 * a name no built-in claims is preserved rather than dropped, because it usually
 * means the file was written by a newer build.
 */
function readDisabledBuiltIns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const name = entry.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function settingsValue(
  builtInEnabled: boolean,
  maxConcurrent: number,
  disabledBuiltIns: string[],
): SubagentSettings {
  return Object.defineProperty({ builtInEnabled, disabledBuiltIns }, "maxConcurrent", {
    value: maxConcurrent,
    enumerable: false,
    configurable: true,
  }) as SubagentSettings;
}

export function getSubagentSettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "agents", "settings.json");
}

function readStoredSettings(settingsPath: string): StoredSubagentSettings {
  if (!existsSync(settingsPath)) return {};
  const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid subagent settings: expected an object");
  }
  return parsed as StoredSubagentSettings;
}

export function readSubagentSettings(
  settingsPath = getSubagentSettingsPath(),
): SubagentSettings {
  const stored = readStoredSettings(settingsPath);
  return settingsValue(
    stored.builtInEnabled === true,
    readMaxConcurrent(stored.maxConcurrent),
    readDisabledBuiltIns(stored.disabledBuiltIns),
  );
}

/**
 * Lowercased names of the built-in profiles switched off.
 *
 * Damaged settings fail *open* here, unlike `isBuiltInSubagentsEnabled`: an
 * unreadable file must not make built-in profiles vanish from the Agents panel,
 * and the feature switch it also holds has already failed closed by then.
 */
export function disabledBuiltInSubagents(
  settingsPath = getSubagentSettingsPath(),
): ReadonlySet<string> {
  try {
    return new Set(readSubagentSettings(settingsPath).disabledBuiltIns.map((name) => name.toLowerCase()));
  } catch {
    return new Set();
  }
}

export function isBuiltInSubagentsEnabled(
  settingsPath = getSubagentSettingsPath(),
): boolean {
  try {
    return readSubagentSettings(settingsPath).builtInEnabled;
  } catch {
    return false;
  }
}

export function writeBuiltInSubagentsEnabled(
  enabled: boolean,
  settingsPath = getSubagentSettingsPath(),
): SubagentSettings {
  const stored = readStoredSettings(settingsPath);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writePrivateFileAtomicSync(settingsPath, JSON.stringify({
    ...stored,
    version: 1,
    builtInEnabled: enabled,
  }, null, 2));
  return readSubagentSettings(settingsPath);
}

/** Minimal edit of the stored list: names this call did not touch are left as authored. */
export function writeDisabledBuiltInSubagent(
  name: string,
  disabled: boolean,
  settingsPath = getSubagentSettingsPath(),
): SubagentSettings {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Sub-agent name is required");
  const stored = readStoredSettings(settingsPath);
  const current = readDisabledBuiltIns(stored.disabledBuiltIns);
  const key = trimmed.toLowerCase();
  const alreadyDisabled = current.some((entry) => entry.toLowerCase() === key);
  // Nothing to record: leave the file exactly as it is, unnormalized keys included.
  if (disabled === alreadyDisabled) return readSubagentSettings(settingsPath);
  const disabledBuiltIns = disabled
    ? alreadyDisabled ? current : [...current, trimmed]
    : current.filter((entry) => entry.toLowerCase() !== key);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writePrivateFileAtomicSync(settingsPath, JSON.stringify({
    ...stored,
    version: 1,
    disabledBuiltIns,
  }, null, 2));
  return readSubagentSettings(settingsPath);
}

export function writeSubagentMaxConcurrent(
  maxConcurrent: number,
  settingsPath = getSubagentSettingsPath(),
): SubagentSettings {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > MAX_SUBAGENT_MAX_CONCURRENT) {
    throw new Error(`maxConcurrent must be an integer between 1 and ${MAX_SUBAGENT_MAX_CONCURRENT}`);
  }
  const stored = readStoredSettings(settingsPath);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writePrivateFileAtomicSync(settingsPath, JSON.stringify({
    ...stored,
    version: 1,
    maxConcurrent,
  }, null, 2));
  return readSubagentSettings(settingsPath);
}
