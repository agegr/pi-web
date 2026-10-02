import { join } from "node:path";
import { CONFIG_DIR_NAME, SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  defaultToolEntries,
  getGlobalSettingsPath,
  readGlobalSettings,
  updateGlobalSettings,
} from "./global-settings-file";
import { resolveDefaultToolEntries } from "./powershell-settings";
import { PROJECT_SETTINGS_MAX_BYTES, readRegularFileText } from "./regular-file";

// Code mode offers one choice (ADR 0006, "Code mode"):
// - "automatic" writes nothing: `codemode` registers inactive, and the MCP
//   extension activates it when a server with `codemode` exposure connects.
// - "always" adds `+codemode` to the global `defaultTools`, so every new
//   session starts with it active.
// There is no "never": MCP tools with `codemode` exposure cannot be called
// without it. `codemode.mode`, `codemode.inlineBudget`, and
// `autoEnableCodemode` stay file-only.

export const CODEMODE_PREFERENCES = ["automatic", "always"] as const;
export type CodemodePreference = typeof CODEMODE_PREFERENCES[number];

const CODEMODE = "codemode";

export function isCodemodePreference(value: unknown): value is CodemodePreference {
  return typeof value === "string" && (CODEMODE_PREFERENCES as readonly string[]).includes(value);
}

function isToolModifier(entry: string): boolean {
  return entry.startsWith("+") || entry.startsWith("-");
}

function namesCodemode(entry: string): boolean {
  return (isToolModifier(entry) ? entry.slice(1) : entry) === CODEMODE;
}

/** "always" when the resolved `defaultTools` list starts sessions with `codemode` active. */
export function codemodePreferenceOf(entries: readonly string[] | undefined): CodemodePreference {
  return entries !== undefined && resolveDefaultToolEntries(entries).includes(CODEMODE) ? "always" : "automatic";
}

/**
 * The `defaultTools` entries for `preference`, edited minimally: every entry
 * naming `codemode` is dropped, and "always" appends `+codemode`, which adds it
 * to a plain list and to pi's defaults alike. Undefined means "remove the key":
 * a list that held only modifiers and ends up empty would otherwise read as
 * "no tools at all" instead of pi's defaults.
 */
export function withCodemodePreference(
  entries: readonly string[] | undefined,
  preference: CodemodePreference,
): string[] | undefined {
  const kept = (entries ?? []).filter((entry) => !namesCodemode(entry));
  if (preference === "always") return [...kept, `+${CODEMODE}`];
  if (kept.length > 0) return kept;
  return entries !== undefined && entries.some((entry) => !isToolModifier(entry)) ? [] : undefined;
}

export async function readCodemodePreference(settingsPath = getGlobalSettingsPath()): Promise<CodemodePreference> {
  return readGlobalSettings(settingsPath, (settings) => codemodePreferenceOf(defaultToolEntries(settings)));
}

/** Writes the global settings only when the preference changes them. */
export async function writeCodemodePreference(
  preference: CodemodePreference,
  settingsPath = getGlobalSettingsPath(),
): Promise<CodemodePreference> {
  if (await readCodemodePreference(settingsPath) === preference) return preference;
  return updateGlobalSettings(settingsPath, (settings) => {
    const next = withCodemodePreference(defaultToolEntries(settings), preference);
    if (next === undefined) delete settings.defaultTools;
    else settings.defaultTools = next;
    return codemodePreferenceOf(next);
  });
}

// ---------------------------------------------------------------------------
// A project's own defaultTools
// ---------------------------------------------------------------------------

/** What a trusted project's `.pi/settings.json` makes of Code mode for its sessions, whatever the global choice. */
export interface ProjectCodemodeOverride {
  settingsPath: string;
  /** "always" when its sessions start with `codemode` active, "automatic" when they start without it. */
  preference: CodemodePreference;
}

/** Global settings for each choice, reduced to what decides Code mode: other entries never do. */
const GLOBAL_SETTINGS_FOR: Record<CodemodePreference, string | undefined> = {
  automatic: undefined,
  always: JSON.stringify({ defaultTools: [`+${CODEMODE}`] }),
};

/** Whether a session starts with `codemode` active, merged and resolved by pi's own SettingsManager. */
function startsWithCodemode(globalText: string | undefined, projectText: string): boolean {
  const texts = { global: globalText, project: projectText };
  const storage: Parameters<typeof SettingsManager.fromStorage>[0] = {
    withLock: (scope, fn) => {
      fn(texts[scope]);
    },
  };
  return SettingsManager.fromStorage(storage, { projectTrusted: true }).getDefaultTools()?.includes(CODEMODE) === true;
}

/**
 * The Code mode a project's settings text gives its sessions when the global
 * choice no longer matters there, undefined when the global choice still
 * decides. A project `defaultTools` list with a plain tool name replaces the
 * global list, `+codemode` and all; one of only modifiers is appended to it,
 * so a `+codemode` or `-codemode` there has the last word. The SDK merges and
 * resolves both global choices with the project's text, so its rules apply
 * exactly, malformed values included; the two agreeing is what overriding
 * means. A text that does not parse reads as empty, as pi reads it.
 */
export function projectCodemodePreference(projectText: string | undefined): CodemodePreference | undefined {
  if (projectText === undefined) return undefined;
  const automatic = startsWithCodemode(GLOBAL_SETTINGS_FOR.automatic, projectText);
  if (automatic !== startsWithCodemode(GLOBAL_SETTINGS_FOR.always, projectText)) return undefined;
  return automatic ? "always" : "automatic";
}

export function projectSettingsPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, "settings.json");
}

/**
 * Whether the project at `cwd` decides Code mode for its sessions through its
 * `.pi/settings.json`. Call it only for a project whose settings sessions read
 * (a trusted one): an untrusted project's file never reaches a session. The
 * file is read without pi's lock, as `readBuiltinExtensionSwitches()` reads
 * it, so a write caught halfway reads as unparsable and reports nothing until
 * the next load. It goes through `readRegularFileText()`, as that read does,
 * so a FIFO, a device or a file past `PROJECT_SETTINGS_MAX_BYTES` reports
 * nothing rather than stalling the request.
 */
export function readProjectCodemodeOverride(cwd: string): ProjectCodemodeOverride | undefined {
  const settingsPath = projectSettingsPath(cwd);
  let text: string | undefined;
  try {
    text = readRegularFileText(settingsPath, PROJECT_SETTINGS_MAX_BYTES);
  } catch {
    // Unreadable, or not a regular file: pi reads one it cannot read as empty too.
    return undefined;
  }
  const preference = projectCodemodePreference(text);
  return preference ? { settingsPath, preference } : undefined;
}
