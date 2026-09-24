import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { dump as stringifyYaml } from "js-yaml";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { parseFrontmatter } from "./frontmatter";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { isExistingPathWithinRoots } from "./path-security";
import { disabledBuiltInSubagents } from "./subagent-settings";
import { PRESET_READ_ONLY } from "./tool-presets";
import type { SessionEntry, SubagentSessionStatus } from "./types";

export const SUBAGENT_META_TYPE = "pi-web:subagent";
export const SUBAGENT_STATUS_TYPE = "pi-web:subagent-status";
export const SUBAGENT_RESULT_TYPE = "pi-web:subagent-result";
export const SUBAGENT_CONTROL_TOOL_NAMES = ["Agent", "SubagentWorkflow", "get_subagent_result", "steer_subagent"] as const;

export type SubagentStatus = SubagentSessionStatus;
export type SubagentScope = "builtin" | "global" | "workspace" | "project";
export type SubagentWritableScope = Extract<SubagentScope, "global" | "project">;

export interface SubagentProfile {
  name: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  extensionTools?: string[];
  loadSkills: boolean;
  /** Skill names restricting which skills load; undefined loads every discovered skill. */
  skills?: string[];
  loadExtensions: boolean;
  /** Exact discovered extension names/package sources; undefined is unbounded, [] loads none. */
  extensionScope?: string[];
  model?: string;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  inheritContext: boolean;
  runInBackground: boolean;
  promptMode: "replace" | "append";
  color?: string;
  isolation?: "worktree" | "off";
  persistSession?: boolean;
  enabled: boolean;
  scope: SubagentScope;
  filePath?: string;
}

export interface SubagentMetadata {
  version: 1;
  parentSessionId: string;
  parentSessionPath: string;
  parentToolCallId: string;
  profile: string;
  description: string;
  task: string;
  runInBackground: boolean;
  createdAt: string;
  resourceSnapshot: SubagentResourceSnapshot;
  worktreePath?: string;
  worktreeBranch?: string;
}

export interface SubagentResourceSnapshot {
  extensionScope?: string[];
  version: 1;
  appendSystemPrompt: string[];
  tools: string[];
  loadSkills: boolean;
  skills?: string[];
  loadExtensions: boolean;
  exactSystemPrompt?: string;
}

export interface SubagentSessionResources {
  extensionScope?: string[];
  appendSystemPrompt: string[];
  tools: string[];
  loadSkills: boolean;
  skills?: string[];
  loadExtensions: boolean;
  exactSystemPrompt?: string;
}

export interface SubagentResultMetadata {
  version: 1;
  status: Exclude<SubagentStatus, "starting" | "running" | "queued" | "interrupted">;
  completedAt: string;
  result?: string;
  error?: string;
  worktreeCleanupError?: string;
}

export interface SubagentStatusMetadata {
  version: 1;
  status: Extract<SubagentStatus, "queued" | "running">;
}

export interface SubagentRunInfo {
  sessionId: string;
  sessionPath: string;
  parentSessionId: string;
  parentToolCallId: string;
  profile: string;
  description: string;
  task: string;
  runInBackground: boolean;
  status: SubagentStatus;
  createdAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeCleanupError?: string;
}

const DEFAULT_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const BUILTIN_TOOLS = new Set(DEFAULT_TOOLS);
const SUBAGENT_CONTROL_TOOLS = new Set<string>(SUBAGENT_CONTROL_TOOL_NAMES);
const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * Frontmatter keys the web UI owns. Everything else in a profile file belongs to
 * whichever runtime reads it (pi-subagents and friends), so a save from this app must
 * carry those keys through untouched. Dropping them silently changed behaviour:
 * `allowed_subagents` was lost and an orchestrator could no longer spawn anything,
 * `exclude_extensions` was lost and an opt-out became an opt-in.
 */
const MANAGED_FRONTMATTER_KEYS = new Set([
  "description",
  "display_name",
  "tools",
  "load_skills",
  "load_extensions",
  "enabled",
  "inherit_context",
  "run_in_background",
  "model",
  "thinking",
  "max_turns",
  "prompt_mode",
  "color",
  "isolation",
  "persist_session",
]);

const FRONTMATTER_OPEN_RE = /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)/;

/**
 * The UI exposes two booleans (`load_skills` / `load_extensions`); pi-subagents reads
 * the aliases `skills` / `extensions`, which also accept a whitelist. Aliases are
 * carried through by `unmanagedFrontmatter` and only rewritten once we own them.
 */
const OWNED_ALIAS_VALUES = new Set(["none", "all", "true", "false"]);

const BUILTIN_PROFILES: SubagentProfile[] = [
  {
    name: "general-purpose",
    displayName: "General purpose",
    description: "Handle a focused implementation or investigation task",
    systemPrompt: "Work autonomously on the delegated task. Keep the final answer concise and include important files, decisions, and remaining risks.",
    tools: DEFAULT_TOOLS,
    loadSkills: false,
    loadExtensions: false,
    promptMode: "append",
    inheritContext: false,
    runInBackground: false,
    enabled: true,
    scope: "builtin",
  },
  {
    name: "explore",
    displayName: "Explore",
    description: "Quickly inspect a codebase without modifying it",
    systemPrompt: "Explore the codebase to answer the delegated question. Do not modify files. Report concrete findings with file paths and relevant symbols.",
    tools: [...PRESET_READ_ONLY],
    loadSkills: false,
    loadExtensions: false,
    promptMode: "append",
    inheritContext: false,
    runInBackground: false,
    enabled: true,
    scope: "builtin",
  },
  {
    name: "plan",
    displayName: "Plan",
    description: "Design an implementation plan without modifying files",
    systemPrompt: "Produce an implementation-ready plan for the delegated task. Inspect the repository as needed, do not modify files, and call out dependencies, risks, and verification steps.",
    tools: [...PRESET_READ_ONLY],
    loadSkills: false,
    loadExtensions: false,
    promptMode: "append",
    inheritContext: false,
    runInBackground: false,
    enabled: true,
    scope: "builtin",
  },
];

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function resourceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return Array.isArray(value) || typeof value === "string" ? true : fallback;
}

function stringList(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return values.map((item) => String(item).trim()).filter(Boolean);
}

function parseTools(value: unknown, fallback: string[]): string[] {
  const tools = stringList(value);
  if (tools.includes("none")) return [];
  if (tools.includes("all") || tools.includes("*")) return [...DEFAULT_TOOLS];
  if (tools.length === 0) return [...fallback];
  return [...new Set(tools.filter((tool) => BUILTIN_TOOLS.has(tool)))];
}

function rawToolValues(value: unknown): string[] {
  return stringList(value);
}

function parseExtensionToolSelectors(value: unknown): string[] {
  return [...new Set(rawToolValues(value).filter((tool) => tool.toLowerCase().startsWith("ext:")))];
}

/**
 * Skill names a profile's `skills:` list scopes loading to.
 *
 * `all` / `*` / `true` express the load switch, not a scope, so they yield
 * undefined (every discovered skill). The `none` / `"false"` spellings ask for no
 * skills, which is a scope of its own: reading them as unbounded would make the
 * two spellings do exactly the opposite of each other. A YAML boolean is not a
 * scope at all — it reaches `loadSkills` through resourceBoolean instead — and an
 * explicit empty list stays an empty scope, the way pi-subagents reads
 * `skills: []`.
 *
 * A skill genuinely named `none` is unreachable by name; the keyword wins here as
 * it does in `parseTools()`.
 */
function parseSkillScope(value: unknown): string[] | undefined {
  if (!Array.isArray(value) && typeof value !== "string") return undefined;
  const names = stringList(value);
  if (names.some((name) => /^(none|false)$/i.test(name))) return [];
  const scope = [...new Set(names.filter((name) => !/^(true|all|\*)$/i.test(name)))];
  if (scope.length > 0) return scope;
  return Array.isArray(value) && value.length === 0 ? [] : undefined;
}

/** Read existing frontmatter without allowing malformed metadata to be overwritten. */
function readStoredFrontmatter(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  const source = readFileSync(filePath, "utf8");
  const { data } = parseFrontmatter(source);
  if (data) return data;
  if (FRONTMATTER_OPEN_RE.test(source)) {
    throw new Error("Cannot save agent profile: existing frontmatter is invalid");
  }
  return {};
}

/** Keys another runtime owns, in file order, so a save round-trips them. */
function unmanagedFrontmatter(stored: Record<string, unknown>): Record<string, unknown> {
  const preserved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (!MANAGED_FRONTMATTER_KEYS.has(key)) preserved[key] = value;
  }
  return preserved;
}

/**
 * pi-web filters `tools` down to the built-ins it can dispatch, which would drop
 * another runtime's `ext:<name>` selectors on every save — carry them through.
 */
function composeToolsField(tools: string[], storedTools: unknown): string {
  const selectors = stringList(storedTools).filter((tool) => tool.startsWith("ext:"));
  const combined = [...tools, ...selectors.filter((selector) => !tools.includes(selector))];
  return combined.length > 0 ? combined.join(", ") : "none";
}

/**
 * Persist an explicit skill scope without widening it back to a boolean.
 * With no scope, keep the skills alias in step with load_skills.
 */
function writeScopeAlias(
  frontmatter: Record<string, unknown>,
  alias: string,
  storedValue: unknown,
  storedScope: readonly string[] | undefined,
  scope: readonly string[] | undefined,
  flag: boolean,
): void {
  if (scope !== undefined) {
    if (!sameScope(scope, storedScope)) frontmatter[alias] = [...scope];
    return;
  }
  const owned = storedValue === undefined
    || typeof storedValue === "boolean"
    || (typeof storedValue === "string" && OWNED_ALIAS_VALUES.has(storedValue.trim().toLowerCase()));
  if (owned) frontmatter[alias] = flag;
}

function sameScope(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  return a !== undefined && b !== undefined
    && a.length === b.length && a.every((name, index) => name === b[index]);
}

/** Deduplicated, trimmed scope names; undefined stays undefined (unbounded). */
function normalizeScope(value: readonly string[] | undefined, lower: boolean): string[] | undefined {
  if (value === undefined) return undefined;
  const names = value
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => (lower ? name.toLowerCase() : name));
  return [...new Set(names)];
}
function parseProfileFile(filePath: string, scope: SubagentScope): SubagentProfile | null {
  try {
    const source = readFileSync(filePath, "utf8");
    const { data, rest } = parseFrontmatter(source);
    const name = stringValue(data?.name) ?? basename(filePath, ".md");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return null;
    const thinkingValue = stringValue(data?.thinking) as ThinkingLevel | undefined;
    const maxTurnsValue = typeof data?.max_turns === "number" ? Math.floor(data.max_turns) : undefined;
    const tools = parseTools(data?.tools, DEFAULT_TOOLS);
    const disallowedTools = new Set(parseTools(data?.disallowed_tools, []));
    const disallowedExtensionTools = new Set(parseExtensionToolSelectors(data?.disallowed_tools).map((tool) => tool.toLowerCase()));
    const extensionTools = parseExtensionToolSelectors(data?.tools)
      .filter((tool) => !disallowedExtensionTools.has(tool.toLowerCase()));
    const skillScope = parseSkillScope(data?.skills);
    const extensionScope = parseExtensionScope(data?.extensions);
    const loadSkills = typeof data?.load_skills === "boolean"
      ? data.load_skills
      : skillScope !== undefined
        ? skillScope.length > 0
        : resourceBoolean(data?.skills, false);
    return {
      name,
      displayName: stringValue(data?.display_name) ?? name,
      description: stringValue(data?.description) ?? name,
      systemPrompt: rest.trim(),
      tools: tools.filter((tool) => !disallowedTools.has(tool)),
      ...(extensionTools.length > 0 ? { extensionTools } : {}),
      loadSkills,
      ...(skillScope !== undefined ? { skills: skillScope } : {}),
      loadExtensions: resourceBoolean(data?.load_extensions ?? data?.extensions, extensionTools.length > 0),
      ...(extensionScope !== undefined ? { extensionScope } : {}),
      ...(stringValue(data?.model) ? { model: stringValue(data?.model) } : {}),
      ...(thinkingValue && THINKING_LEVELS.has(thinkingValue) ? { thinking: thinkingValue } : {}),
      ...(maxTurnsValue && maxTurnsValue > 0 ? { maxTurns: maxTurnsValue } : {}),
      inheritContext: booleanValue(data?.inherit_context, false),
      runInBackground: booleanValue(data?.run_in_background, false),
      promptMode: data?.prompt_mode === "replace" ? "replace" : "append",
      ...(stringValue(data?.color) ? { color: stringValue(data?.color) } : {}),
      ...(data?.isolation === "worktree" || data?.isolation === "off" ? { isolation: data.isolation } : {}),
      ...(typeof data?.persist_session === "boolean" ? { persistSession: data.persist_session } : {}),
      enabled: booleanValue(data?.enabled, true),
      scope,
      filePath,
    };
  } catch {
    return null;
  }
}

function isProjectProfilePathAllowed(cwd: string, target: string): boolean {
  return isExistingPathWithinRoots(target, new Set([cwd]));
}

function readProfileDirectory(dir: string, scope: SubagentScope, cwd: string): SubagentProfile[] {
  if (!existsSync(dir)) return [];
  if (scope !== "global" && !isProjectProfilePathAllowed(cwd, dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => parseProfileFile(join(dir, entry.name), scope))
    .filter((profile): profile is SubagentProfile => profile !== null);
}

function profileDirectories(cwd: string): Array<[string, Exclude<SubagentScope, "builtin">]> {
  return [
    [join(getAgentDir(), "agents"), "global"],
    [join(resolve(cwd), ".agents", "agents"), "workspace"],
    [join(resolve(cwd), ".pi", "agents"), "project"],
  ];
}

/**
 * A built-in has no file, so `enabled: false` cannot be written next to it the way
 * it is for a profile on disk. Its off state is a name in `agents/settings.json`
 * instead of a copied-out override file, which would otherwise freeze the built-in
 * prompt at the version it was copied from.
 */
function builtInProfiles(): SubagentProfile[] {
  const disabled = disabledBuiltInSubagents();
  return BUILTIN_PROFILES.map((profile) => ({
    ...profile,
    tools: [...profile.tools],
    enabled: !disabled.has(profile.name.toLowerCase()),
  }));
}

/** Every configured source, including profiles shadowed by a higher-precedence scope. */
export function listSubagentProfileSources(cwd: string): SubagentProfile[] {
  const profiles = builtInProfiles();
  for (const [dir, scope] of profileDirectories(cwd)) {
    profiles.push(...readProfileDirectory(dir, scope, cwd));
  }
  return profiles.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function listSubagentProfiles(cwd: string): SubagentProfile[] {
  // A same-name file replaces the built-in outright, its own `enabled` included.
  const byName = new Map(builtInProfiles().map((profile) => [profile.name.toLowerCase(), profile]));
  for (const [dir, scope] of profileDirectories(cwd)) {
    for (const profile of readProfileDirectory(dir, scope, cwd)) byName.set(profile.name.toLowerCase(), profile);
  }
  return [...byName.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function resolveSubagentProfile(cwd: string, name: string): SubagentProfile | undefined {
  return listSubagentProfiles(cwd).find((profile) => profile.name.toLowerCase() === name.trim().toLowerCase() && profile.enabled);
}

function assertProfileName(name: string): string {
  const normalized = name.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) {
    throw new Error("Agent name may contain only letters, numbers, dots, underscores, and hyphens");
  }
  return normalized;
}

function writableProfileDirectory(cwd: string, scope: SubagentWritableScope): string {
  if (scope === "global") return join(getAgentDir(), "agents");
  if (scope === "project") return join(resolve(cwd), ".pi", "agents");
  throw new Error("Agent scope must be global or project");
}

function assertWritableProfileDirectory(cwd: string, scope: SubagentWritableScope): string {
  const dir = writableProfileDirectory(cwd, scope);
  if (scope === "global") return dir;

  let existingAncestor = dir;
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) throw new Error("Agent profile directory is outside the project root");
    existingAncestor = parent;
  }
  if (!isProjectProfilePathAllowed(cwd, existingAncestor)) {
    throw new Error("Agent profile directory is outside the project root");
  }
  return dir;
}

export function saveSubagentProfile(
  cwd: string,
  scope: SubagentWritableScope,
  profile: Omit<SubagentProfile, "scope" | "filePath">,
): SubagentProfile {
  const name = assertProfileName(profile.name);
  const tools = [...new Set(profile.tools.filter((tool) => BUILTIN_TOOLS.has(tool)))];
  const extensionTools = [...new Set(profile.extensionTools ?? [])];
  if (profile.thinking && !THINKING_LEVELS.has(profile.thinking)) {
    throw new Error(`Invalid thinking level: ${profile.thinking}`);
  }
  if (profile.maxTurns !== undefined && (!Number.isFinite(profile.maxTurns) || profile.maxTurns < 0)) {
    throw new Error("Max turns must be a non-negative number");
  }
  const maxTurns = profile.maxTurns && profile.maxTurns > 0
    ? Math.floor(profile.maxTurns)
    : undefined;
  const displayName = profile.displayName.trim() || name;
  const description = profile.description.trim() || name;
  const systemPrompt = profile.systemPrompt.trim();
  const model = profile.model?.trim() || undefined;
  const loadSkills = profile.loadSkills === true;
  const loadExtensions = profile.loadExtensions === true;
  // Skill names are exact; extension selectors are case-insensitive.
  const skillScope = normalizeScope(profile.skills, false);
  const extensionScope = normalizeScope(profile.extensionScope, true);
  const promptMode = profile.promptMode === "replace" ? "replace" : "append";
  const dir = assertWritableProfileDirectory(cwd, scope);
  mkdirSync(dir, { recursive: true });
  if (scope === "project" && !isProjectProfilePathAllowed(cwd, dir)) {
    throw new Error("Agent profile directory is outside the project root");
  }
  const filePath = join(dir, `${name}.md`);
  const stored = readStoredFrontmatter(filePath);
  const managed: Record<string, unknown> = {
    description,
    display_name: displayName,
    tools: composeToolsField([...tools, ...extensionTools], stored.tools),
    load_skills: loadSkills,
    load_extensions: loadExtensions,
    enabled: profile.enabled,
    inherit_context: profile.inheritContext,
    run_in_background: profile.runInBackground,
    prompt_mode: promptMode,
  };
  writeScopeAlias(managed, "skills", stored.skills, parseSkillScope(stored.skills), skillScope, loadSkills);
  writeScopeAlias(managed, "extensions", stored.extensions, parseExtensionScope(stored.extensions), extensionScope, loadExtensions);
  if (model) managed.model = model;
  if (profile.thinking) managed.thinking = profile.thinking;
  if (maxTurns) managed.max_turns = maxTurns;
  if (profile.color?.trim()) managed.color = profile.color.trim();
  if (profile.isolation) managed.isolation = profile.isolation;
  if (profile.persistSession !== undefined) managed.persist_session = profile.persistSession;
  // Managed keys win; keys this app does not own follow in their original order.
  const frontmatter: Record<string, unknown> = { ...managed };
  for (const [key, value] of Object.entries(unmanagedFrontmatter(stored))) {
    if (!(key in frontmatter)) frontmatter[key] = value;
  }
  const yaml = stringifyYaml(frontmatter, { noRefs: true, lineWidth: 1000 }).trimEnd();
  writePrivateFileAtomicSync(filePath, `---\n${yaml}\n---\n\n${systemPrompt}\n`);
  return {
    ...profile,
    name,
    displayName,
    description,
    systemPrompt,
    tools,
    ...(extensionTools.length > 0 ? { extensionTools } : {}),
    loadSkills,
    loadExtensions,
    ...(skillScope !== undefined ? { skills: skillScope } : {}),
    ...(extensionScope !== undefined ? { extensionScope } : {}),
    ...(model ? { model } : { model: undefined }),
    ...(maxTurns ? { maxTurns } : { maxTurns: undefined }),
    promptMode,
    ...(profile.color ? { color: profile.color } : {}),
    ...(profile.isolation ? { isolation: profile.isolation } : {}),
    ...(profile.persistSession !== undefined ? { persistSession: profile.persistSession } : {}),
    scope,
    filePath,
  };
}

export function deleteSubagentProfile(cwd: string, scope: SubagentWritableScope, name: string): void {
  const safeName = assertProfileName(name);
  const filePath = join(assertWritableProfileDirectory(cwd, scope), `${safeName}.md`);
  if (existsSync(filePath)) unlinkSync(filePath);
}

export function saveProjectSubagentProfile(cwd: string, profile: Omit<SubagentProfile, "scope" | "filePath">): SubagentProfile {
  return saveSubagentProfile(cwd, "project", profile);
}

export function deleteProjectSubagentProfile(cwd: string, name: string): void {
  deleteSubagentProfile(cwd, "project", name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ValidSubagentMetadataData = Record<string, unknown> & {
  version: 1;
  parentSessionId: string;
  parentSessionPath: string;
};

function subagentMetadataData(entries: readonly SessionEntry[]): ValidSubagentMetadataData | null {
  const metaEntry = entries.find((entry) => entry.type === "custom" && entry.customType === SUBAGENT_META_TYPE);
  if (!metaEntry || metaEntry.type !== "custom" || !isRecord(metaEntry.data)) return null;
  const data = metaEntry.data;
  if (data.version !== 1 || typeof data.parentSessionId !== "string" || typeof data.parentSessionPath !== "string") return null;
  return data as ValidSubagentMetadataData;
}

/**
 * A scope list a persisted snapshot recorded.
 *
 * Absent means the snapshot predates the field (or recorded no scope). A value
 * that is present but malformed must not fall back to "unbounded": the child was
 * scoped when it ran, and restoring it wider than it ran is a privilege change,
 * not a repair. Refuse it the way an unreadable settings file is refused.
 */
function readSnapshotScope(snapshot: Record<string, unknown>, key: string, label: string): string[] | undefined {
  const value = snapshot[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim().length > 0)) {
    throw new Error(`Invalid subagent ${label} scope`);
  }
  return value as string[];
}

/** Restore the isolated prompt and tool scope used by a persisted subagent session. */
export function readSubagentSessionResources(
  entries: readonly SessionEntry[],
): SubagentSessionResources | null {
  const data = subagentMetadataData(entries);
  if (!data) return null;
  const snapshot = data.resourceSnapshot;
  const skills = isRecord(snapshot) ? readSnapshotScope(snapshot, "skills", "skill") : undefined;
  const extensionScope = isRecord(snapshot) ? readSnapshotScope(snapshot, "extensionScope", "extension") : undefined;
  const loadSkills = isRecord(snapshot) && snapshot.loadSkills === true;
  const loadExtensions = isRecord(snapshot) && snapshot.loadExtensions === true;
  if (
    isRecord(snapshot)
    && snapshot.version === 1
    && Array.isArray(snapshot.appendSystemPrompt)
    && snapshot.appendSystemPrompt.every((item) => typeof item === "string")
    && Array.isArray(snapshot.tools)
    && snapshot.tools.every((item) =>
      typeof item === "string"
      && item.length > 0
      && (BUILTIN_TOOLS.has(item) || SUBAGENT_CONTROL_TOOLS.has(item) || loadExtensions)
    )
  ) {
    return {
      appendSystemPrompt: [...snapshot.appendSystemPrompt],
      // Old children may have persisted a now-reserved extension tool. Keep
      // their isolation policy rather than returning null (ordinary startup).
      tools: [...new Set(snapshot.tools.filter((tool) => !SUBAGENT_CONTROL_TOOLS.has(tool)))],
      loadSkills,
      ...(skills !== undefined ? { skills: [...skills] } : {}),
      loadExtensions,
      ...(extensionScope !== undefined ? { extensionScope: [...extensionScope] } : {}),
      ...(typeof snapshot.exactSystemPrompt === "string" ? { exactSystemPrompt: snapshot.exactSystemPrompt } : {}),
    };
  }
  return null;
}

/**
 * The extension names a profile's `extensions:` field scopes loading to.
 *
 * `all` / `*` / `true` express the load switch, not a scope, so they yield
 * undefined (every discovered extension); `none` / `"false"` ask for none, which
 * is a scope of its own. A YAML boolean is not a scope at all — it reaches
 * `loadExtensions` through resourceBoolean instead — and an explicit empty list
 * stays empty. Names are lowercased because extension selectors match
 * case-insensitively (skill names, by contrast, are matched exactly).
 *
 * Scope parsing is separate from the load switch: an explicit
 * `load_extensions: false` always wins over any scope.
 */
export function parseExtensionScope(value: unknown): string[] | undefined {
  if (value === undefined || value === true) return undefined;
  if (value === false) return [];
  const names = stringList(value).map((name) => name.toLowerCase());
  if (names.some((name) => /^(none|false)$/.test(name))) return [];
  if (names.some((name) => /^(all|true|\*)$/.test(name))) return undefined;
  return [...new Set(names)];
}

/** Match resource identity, not generic loader directories or the 'local' source label. */
export function extensionSelectorNames(extension: { path: string; sourceInfo?: { source?: string } }): Set<string> {
  const segments = extension.path.replaceAll("\\", "/").split("/");
  const stem = (segments.at(-1) ?? "").replace(/\.(?:[cm]?js|tsx?)$/i, "");
  const ownName = stem === "index" ? segments.at(-2) ?? "" : stem;
  const names = new Set<string>();
  if (ownName && !/^(src|index|extensions|local)$/i.test(ownName)) names.add(ownName.toLowerCase());
  const source = extension.sourceInfo?.source;
  if (source && !/^(local|auto|cli|inline)$/i.test(source)) {
    names.add(source.toLowerCase());
    if (source.startsWith("npm:")) {
      const packageName = source.slice(4).match(/^(@[^/]+\/[^@]+|[^@]+)(?:@.*)?$/)?.[1];
      if (packageName) names.add(packageName.toLowerCase());
    }
  }
  return names;
}

export function withSubagentExtensionTools(
  profileTools: readonly string[],
  extensionToolNames: Iterable<string>,
): string[] {
  return [...new Set([
    ...profileTools,
    ...[...extensionToolNames].filter((name) => !SUBAGENT_CONTROL_TOOLS.has(name)),
  ])];
}

export function selectSubagentExtensionTools(
  extensions: Iterable<{ path: string; sourceInfo?: { source?: string }; tools: Map<string, unknown> }>,
  selectors: readonly string[],
): string[] {
  const wanted = selectors.map((selector) => selector.slice(4).toLowerCase());
  return [...extensions].flatMap((extension) => {
    const extensionNames = extensionSelectorNames(extension);
    return [...extension.tools.keys()].filter((toolName) => wanted.some((selector) => {
      if (selector === "*" || extensionNames.has(selector)) return true;
      const slash = selector.lastIndexOf("/");
      if (slash < 0 || !extensionNames.has(selector.slice(0, slash))) return false;
      const selectedTool = selector.slice(slash + 1);
      return selectedTool === "*" || selectedTool === toolName;
    }));
  });
}

export function readSubagentRun(entries: readonly SessionEntry[], sessionId: string, sessionPath: string): SubagentRunInfo | null {
  const data = subagentMetadataData(entries);
  if (!data) return null;
  const lifecycleEntry = [...entries].reverse().find((entry) =>
    entry.type === "custom" && (entry.customType === SUBAGENT_RESULT_TYPE || entry.customType === SUBAGENT_STATUS_TYPE)
  );
  const resultEntry = lifecycleEntry?.type === "custom" && lifecycleEntry.customType === SUBAGENT_RESULT_TYPE
    ? lifecycleEntry
    : undefined;
  const result = resultEntry?.type === "custom" && isRecord(resultEntry.data) ? resultEntry.data : undefined;
  const statusEntry = lifecycleEntry?.type === "custom" && lifecycleEntry.customType === SUBAGENT_STATUS_TYPE
    ? lifecycleEntry
    : undefined;
  const statusData = statusEntry?.type === "custom" && isRecord(statusEntry.data) ? statusEntry.data : undefined;
  const persistedStatus = result && (result.status === "completed" || result.status === "failed" || result.status === "aborted")
    ? result.status
    : statusData?.version === 1 && (statusData.status === "queued" || statusData.status === "running")
      ? statusData.status
      : "interrupted";
  return {
    sessionId,
    sessionPath,
    parentSessionId: data.parentSessionId,
    parentToolCallId: typeof data.parentToolCallId === "string" ? data.parentToolCallId : "",
    profile: typeof data.profile === "string" ? data.profile : "general-purpose",
    description: typeof data.description === "string" ? data.description : "Subagent",
    task: typeof data.task === "string" ? data.task : "",
    runInBackground: data.runInBackground === true,
    status: persistedStatus,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
    ...(result && typeof result.completedAt === "string" ? { completedAt: result.completedAt } : {}),
    ...(result && typeof result.result === "string" ? { result: result.result } : {}),
    ...(result && typeof result.error === "string" ? { error: result.error } : {}),
    ...(typeof data.worktreePath === "string" ? { worktreePath: data.worktreePath } : {}),
    ...(typeof data.worktreeBranch === "string" ? { worktreeBranch: data.worktreeBranch } : {}),
    ...(result && typeof result.worktreeCleanupError === "string" ? { worktreeCleanupError: result.worktreeCleanupError } : {}),
  };
}
