import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

/**
 * The write half of pi-subagents' `subagents.agentOverrides` settings: the
 * catalog module already reads the user/project files (disable ladder), but
 * nothing wrote them, so a built-in or package agent could not be disabled from
 * the panel.
 *
 * Only the global settings file is written. The path is the same
 * `<agentDir>/settings.json` the SDK's own `FileSettingsStorage` derives, so
 * reading `getAgentDir()` here can never disagree with the runtime.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getUserSubagentSettingsPath(): string {
  return join(getAgentDir(), "settings.json");
}

/** Read the settings object, refusing to replace a file that is not one. */
function readSettingsObject(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  // pi's own FileSettingsStorage strips a BOM before parsing; match that so a
  // file pi accepts never reads as malformed here.
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  if (!isRecord(parsed)) throw new Error("Invalid settings.json: expected an object");
  return parsed;
}

/**
 * The real path an atomic write must target. `renameSync` replaces the path
 * itself, so writing a symlinked settings path directly would turn a
 * dotfile-managed link into a regular file. Resolving first keeps the link and
 * updates the file behind it.
 */
function settingsWritePath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

/** Atomic replace, keeping the existing file's permission bits when it has any. */
function writeSettingsObject(filePath: string, settings: Record<string, unknown>): void {
  const target = settingsWritePath(filePath);
  const dir = dirname(target);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const mode = existsSync(target) ? statSync(target).mode & 0o777 : undefined;
  writePrivateFileAtomicSync(target, `${JSON.stringify(settings, null, 2)}\n`);
  if (mode !== undefined) chmodSync(target, mode);
}

/**
 * Disable or enable a pi-subagents agent through its user-scope settings
 * override. Disabling sets `subagents.agentOverrides.<name>.disabled = true`;
 * enabling removes that key and prunes the override entry, `agentOverrides`,
 * and `subagents` once they become empty — the same cleanup pi-subagents'
 * `enable` action performs.
 *
 * Every unrelated settings key survives untouched (JSON read, targeted mutate,
 * write). `cwd` is accepted for the route's parity with the profiles route;
 * this phase writes user scope only, and any other scope is rejected.
 */
export function setSubagentOverrideDisabled(
  cwd: string,
  name: string,
  disabled: boolean,
  scope: "user" = "user",
): void {
  if (scope !== "user") {
    throw new Error(`Agent override scope "${scope}" is not supported (cwd: ${cwd})`);
  }

  const filePath = getUserSubagentSettingsPath();
  const settings = readSettingsObject(filePath);
  const subagents = isRecord(settings.subagents) ? { ...settings.subagents } : {};
  const agentOverrides = isRecord(subagents.agentOverrides) ? { ...subagents.agentOverrides } : {};
  const currentEntry = isRecord(agentOverrides[name]) ? { ...agentOverrides[name] } : {};

  if (disabled) {
    currentEntry.disabled = true;
    agentOverrides[name] = currentEntry;
  } else {
    if (!Object.prototype.hasOwnProperty.call(agentOverrides, name)) return;
    delete currentEntry.disabled;
    if (Object.keys(currentEntry).length > 0) agentOverrides[name] = currentEntry;
    else delete agentOverrides[name];
  }

  if (Object.keys(agentOverrides).length > 0) subagents.agentOverrides = agentOverrides;
  else delete subagents.agentOverrides;

  if (Object.keys(subagents).length > 0) settings.subagents = subagents;
  else delete settings.subagents;

  writeSettingsObject(filePath, settings);
}
