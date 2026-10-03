import { join } from "node:path";
import { CONFIG_DIR_NAME, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { CodemodeInlineBudgetSetting, CodemodeMode, CodemodeModeSetting } from "./api-types";
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
// without it. Beside it, Settings › MCP edits the global `codemode` object
// (below): `codemode.mode` and `codemode.inlineBudget`. `autoEnableCodemode`
// stays file-only.

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

/** Global and project settings texts merged by pi's own SettingsManager, as a trusted project's session merges them. */
function mergedSettings(globalText: string | undefined, projectText: string): SettingsManager {
  const texts = { global: globalText, project: projectText };
  const storage: Parameters<typeof SettingsManager.fromStorage>[0] = {
    withLock: (scope, fn) => {
      fn(texts[scope]);
    },
  };
  return SettingsManager.fromStorage(storage, { projectTrusted: true });
}

/** Whether a session starts with `codemode` active, merged and resolved by pi's own SettingsManager. */
function startsWithCodemode(globalText: string | undefined, projectText: string): boolean {
  return mergedSettings(globalText, projectText).getDefaultTools()?.includes(CODEMODE) === true;
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
  const preference = projectCodemodePreference(readProjectSettingsText(settingsPath));
  return preference ? { settingsPath, preference } : undefined;
}

function readProjectSettingsText(settingsPath: string): string | undefined {
  try {
    return readRegularFileText(settingsPath, PROJECT_SETTINGS_MAX_BYTES);
  } catch {
    // Unreadable, or not a regular file: pi reads one it cannot read as empty too.
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// The `codemode` object: codemode.mode and codemode.inlineBudget
// ---------------------------------------------------------------------------

type CodemodeKey = "mode" | "inlineBudget";

function isSettingsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One key of `codemode`. A `codemode` that is not an object holds none, as `settings.codemode?.[key]` reads it. */
function codemodeValueOf(settings: Record<string, unknown>, key: CodemodeKey): unknown {
  return isSettingsObject(settings.codemode) ? settings.codemode[key] : undefined;
}

const INVALID_VALUE_MAX_CHARS = 60;

/** A value pi does not use, as JSON shortened for a notice. */
function invalidValueText(raw: unknown): string {
  const json = JSON.stringify(raw) ?? String(raw);
  return json.length > INVALID_VALUE_MAX_CHARS ? `${json.slice(0, INVALID_VALUE_MAX_CHARS - 1)}…` : json;
}

/** Both global `codemode` settings, in one read. */
export async function readCodemodeSettings(settingsPath = getGlobalSettingsPath()): Promise<{
  mode: CodemodeModeSetting;
  inlineBudget: CodemodeInlineBudgetSetting;
}> {
  return readGlobalSettings(settingsPath, (settings) => ({
    mode: codemodeModeOf(settings),
    inlineBudget: codemodeInlineBudgetOf(settings),
  }));
}

/**
 * Stores `value` as the global `codemode[key]`, or, for undefined, removes the
 * key (and the `codemode` object when nothing else is left in it). The other
 * `codemode` key is kept. A `codemode` that is not an object is refused rather
 * than replaced, and settings whose stored value `unchanged` accepts are not
 * rewritten. Answers what is stored afterwards, read by `setting`.
 */
async function writeCodemodeValue<T>(
  settingsPath: string,
  key: CodemodeKey,
  value: unknown,
  setting: (raw: unknown) => T,
  unchanged: (stored: unknown) => boolean = (stored) => stored === value,
): Promise<T> {
  const stored = await readGlobalSettings(settingsPath, (settings) => codemodeValueOf(settings, key));
  if (unchanged(stored)) return setting(stored);
  return updateGlobalSettings(settingsPath, (settings) => {
    const codemode = settings.codemode;
    if (codemode !== undefined && !isSettingsObject(codemode)) {
      throw new Error("Invalid settings.json: codemode must be an object");
    }
    if (value !== undefined) {
      if (codemode) codemode[key] = value;
      else settings.codemode = { [key]: value };
    } else if (codemode) {
      delete codemode[key];
      if (Object.keys(codemode).length === 0) delete settings.codemode;
    }
    return setting(codemodeValueOf(settings, key));
  });
}

/** The merged `codemode[key]` a trusted project's session reads, with `globalValue` in the global settings. */
function mergedCodemodeValue(key: CodemodeKey, globalValue: unknown, projectText: string): unknown {
  const globalText = JSON.stringify({ codemode: { [key]: globalValue } });
  return codemodeValueOf({ codemode: mergedSettings(globalText, projectText).getSettings().codemode }, key);
}

/**
 * The raw `codemode[key]` a project's settings text gives its sessions when
 * the global value no longer matters there, undefined when the global value
 * still decides. pi merges both layers and the codemode extension reads the
 * merged `codemode`, so a project's `codemode[key]` replaces the global one,
 * and so does a project `codemode` that is not an object, which leaves no
 * value at all. Merged by the SDK itself under two global values that differ
 * for the extension, the project decides when both give the same value.
 */
function projectCodemodeValue(
  key: CodemodeKey,
  globalValues: readonly [unknown, unknown],
  projectText: string | undefined,
): { raw: unknown } | undefined {
  if (projectText === undefined) return undefined;
  const first = mergedCodemodeValue(key, globalValues[0], projectText);
  if (JSON.stringify(first) !== JSON.stringify(mergedCodemodeValue(key, globalValues[1], projectText))) return undefined;
  return { raw: first };
}

// ---------------------------------------------------------------------------
// codemode.mode
// ---------------------------------------------------------------------------

export const CODEMODE_MODES = ["on", "only"] as const satisfies readonly CodemodeMode[];

export function isCodemodeMode(value: unknown): value is CodemodeMode {
  return typeof value === "string" && (CODEMODE_MODES as readonly string[]).includes(value);
}

/**
 * A raw `codemode.mode` as the codemode extension reads it (`readMode()`):
 * "only" when it is exactly that, anything else "on".
 */
function codemodeModeSetting(raw: unknown): CodemodeModeSetting {
  if (raw === "only") return { value: "only" };
  if (raw === undefined || raw === "on") return { value: "on" };
  return { value: "on", invalid: invalidValueText(raw) };
}

/** The `codemode.mode` of one settings object. */
export function codemodeModeOf(settings: Record<string, unknown>): CodemodeModeSetting {
  return codemodeModeSetting(codemodeValueOf(settings, "mode"));
}

/**
 * Stores the global `codemode.mode`: "only" as itself, "on" by removing the
 * key, pi's default, which also drops a value pi reads as "on" without it
 * being a mode. `codemode.inlineBudget` is kept, a `codemode` that is not an
 * object is refused (it already reads as "on"), and settings that already give
 * `mode` are not rewritten. Answers what is stored afterwards.
 */
export async function writeCodemodeMode(
  mode: CodemodeMode,
  settingsPath = getGlobalSettingsPath(),
): Promise<CodemodeModeSetting> {
  return writeCodemodeValue(
    settingsPath,
    "mode",
    mode === "only" ? "only" : undefined,
    codemodeModeSetting,
    (stored) => (mode === "only" ? stored === "only" : stored === undefined || stored === "on"),
  );
}

/** What a trusted project's `.pi/settings.json` makes of the mode for its sessions, whatever the global value. */
export interface ProjectCodemodeMode extends CodemodeModeSetting {
  settingsPath: string;
}

/**
 * The mode a project's settings text gives its sessions when the global value
 * no longer matters there, undefined when the global value still decides
 * (`projectCodemodeValue()`).
 */
export function projectCodemodeMode(projectText: string | undefined): CodemodeModeSetting | undefined {
  const decided = projectCodemodeValue("mode", ["on", "only"], projectText);
  return decided && codemodeModeSetting(decided.raw);
}

/**
 * Whether the project at `cwd` decides the mode for its sessions through its
 * `.pi/settings.json`; read as `readProjectCodemodeOverride()` reads it, and
 * only for a project whose settings sessions read.
 */
export function readProjectCodemodeMode(cwd: string): ProjectCodemodeMode | undefined {
  const settingsPath = projectSettingsPath(cwd);
  const mode = projectCodemodeMode(readProjectSettingsText(settingsPath));
  return mode ? { settingsPath, ...mode } : undefined;
}

// ---------------------------------------------------------------------------
// codemode.inlineBudget
// ---------------------------------------------------------------------------

/**
 * pi's `DEFAULT_CODEMODE_INLINE_BUDGET`: the estimated tokens (characters / 4)
 * the codemode tool's description spends on tool declarations when the
 * setting is unset or ignored. The SDK root does not export it;
 * `lib/codemode-settings.test.mjs` pins it to the SDK's value.
 */
export const CODEMODE_INLINE_BUDGET_DEFAULT = 3000;
/** The largest budget Settings saves. pi itself takes any finite number of 0 or more. */
export const CODEMODE_INLINE_BUDGET_MAX = 1_000_000;

/** A budget Settings may write: a whole number from 0 to `CODEMODE_INLINE_BUDGET_MAX`. */
export function isCodemodeInlineBudget(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= CODEMODE_INLINE_BUDGET_MAX;
}

/**
 * A raw `codemode.inlineBudget` as the codemode extension reads it
 * (`readInlineBudget()`): a finite number of 0 or more is used, anything else
 * leaves the default.
 */
function inlineBudgetSetting(raw: unknown): CodemodeInlineBudgetSetting {
  if (raw === undefined) return {};
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return { value: raw };
  return { invalid: invalidValueText(raw) };
}

/** The `codemode.inlineBudget` of one settings object. */
export function codemodeInlineBudgetOf(settings: Record<string, unknown>): CodemodeInlineBudgetSetting {
  return inlineBudgetSetting(codemodeValueOf(settings, "inlineBudget"));
}

/**
 * Stores `budget` as the global `codemode.inlineBudget`, or, for undefined,
 * removes the key so sessions get pi's default. `codemode.mode` is kept, a
 * `codemode` that is not an object is refused, and settings that already
 * hold the budget are not rewritten. Answers what is stored afterwards.
 */
export async function writeCodemodeInlineBudget(
  budget: number | undefined,
  settingsPath = getGlobalSettingsPath(),
): Promise<CodemodeInlineBudgetSetting> {
  return writeCodemodeValue(settingsPath, "inlineBudget", budget, inlineBudgetSetting);
}

/** What a trusted project's `.pi/settings.json` makes of the budget for its sessions, whatever the global value. */
export interface ProjectCodemodeInlineBudget extends CodemodeInlineBudgetSetting {
  settingsPath: string;
}

/**
 * The budget a project's settings text gives its sessions when the global
 * value no longer matters there, undefined when the global value still
 * decides (`projectCodemodeValue()`).
 */
export function projectCodemodeInlineBudget(projectText: string | undefined): CodemodeInlineBudgetSetting | undefined {
  const decided = projectCodemodeValue("inlineBudget", [1, 2], projectText);
  return decided && inlineBudgetSetting(decided.raw);
}

/**
 * Whether the project at `cwd` decides the budget for its sessions through its
 * `.pi/settings.json`; read as `readProjectCodemodeOverride()` reads it, and
 * only for a project whose settings sessions read.
 */
export function readProjectCodemodeInlineBudget(cwd: string): ProjectCodemodeInlineBudget | undefined {
  const settingsPath = projectSettingsPath(cwd);
  const budget = projectCodemodeInlineBudget(readProjectSettingsText(settingsPath));
  return budget ? { settingsPath, ...budget } : undefined;
}
