import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { dump as stringifyYaml } from "js-yaml";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { parseFrontmatter } from "./frontmatter";
import { findConfiguredProjectRoot, type AgentCatalogSource } from "./pi-subagents-catalog";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { isExistingPathWithinRoots } from "./path-security";
import type { SessionEntry, SubagentSessionStatus } from "./types";

export const SUBAGENT_META_TYPE = "pi-web:subagent";
export const SUBAGENT_STATUS_TYPE = "pi-web:subagent-status";
export const SUBAGENT_RESULT_TYPE = "pi-web:subagent-result";
export const SUBAGENT_CONTROL_TOOL_NAMES = ["Agent", "get_subagent_result", "steer_subagent"] as const;
/** Builtin tool names a pi session exposes; the profile editor's tool list seeds from these. */
export const CODING_TOOL_NAMES = ["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"] as const;

export type SubagentStatus = SubagentSessionStatus;
/** `"builtin"` is no longer produced by any source; kept so the precedence map and profileDirectories' Exclude stay well-typed. */
export type SubagentScope = "builtin" | "global" | "workspace" | "project";
export type SubagentWritableScope = Extract<SubagentScope, "global" | "project">;

/**
 * The pi-subagents `extensions` tri-state: an omitted key loads the parent's
 * ambient extensions in a background child, an empty list loads none, and a
 * list loads exactly those paths.
 */
export type SubagentExtensions = {
  kind: "omit" | "none" | "list";
  list?: string[];
};

/**
 * An agent profile authored in the installed pi-subagents frontmatter dialect
 * (camelCase spellings). `scope` / `filePath` are pi-web bookkeeping; every
 * other field maps to a pi-subagents key.
 */
export interface SubagentProfile {
  name: string;
  /** pi-web-owned display nicety, read and written as `display_name`. */
  displayName?: string;
  description: string;
  systemPrompt: string;
  /** undefined = `tools` key omitted (child inherits Pi's default tools); [] = explicit empty allowlist. */
  tools?: string[];
  /** UI tri-state helper: true when the `tools` key is omitted. */
  toolsInherited?: boolean;
  excludeTools?: string[];
  extensions?: SubagentExtensions;
  subagentOnlyExtensions?: string[];
  skills?: string[];
  skillPath?: string[];
  model?: string;
  thinking?: ThinkingLevel;
  systemPromptMode?: "replace" | "append";
  inheritProjectContext?: boolean;
  inheritGlobalContext?: boolean;
  inheritSkills?: boolean;
  defaultContext?: "fresh" | "fork";
  async?: boolean;
  timeoutMs?: number;
  toolTimeoutMs?: number;
  maxSubagentDepth?: number;
  allowNestedSubagents?: boolean;
  /**
   * `allowedAgents` is presence-sensitive: an omitted key is unrestricted, while
   * a present empty value denies every descendant launch. This UI marker records
   * the empty-list case so a save writes `''` instead of dropping the key.
   */
  allowedAgentsDenyAll?: boolean;
  allowedAgents?: string[];
  advertise?: boolean;
  output?: string;
  defaultReads?: string[];
  defaultProgress?: boolean;
  acceptanceRole?: "read-only" | "writer";
  aliases?: string[];
  scope: SubagentScope;
  filePath?: string;
}

/** persisted by the removed built-in subagent engine; kept for legacy readers */
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

/** persisted by the removed built-in subagent engine; kept for legacy readers */
export interface SubagentResourceSnapshot {
  version: 1;
  appendSystemPrompt: string[];
  tools: string[];
  loadSkills: boolean;
  loadExtensions: boolean;
  exactSystemPrompt?: string;
}

export interface SubagentSessionResources {
  appendSystemPrompt: string[];
  tools: string[];
  loadSkills: boolean;
  loadExtensions: boolean;
  exactSystemPrompt?: string;
}

/** persisted by the removed built-in subagent engine; kept for legacy readers */
export interface SubagentResultMetadata {
  version: 1;
  status: Exclude<SubagentStatus, "starting" | "running" | "queued" | "interrupted">;
  completedAt: string;
  result?: string;
  error?: string;
  worktreeCleanupError?: string;
}

/** persisted by the removed built-in subagent engine; kept for legacy readers */
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
/** pi-subagents rejects a `toolTimeoutMs` above the 32-bit signed integer ceiling. */
const TOOL_TIMEOUT_MAX_MS = 2_147_483_647;
const SYSTEM_PROMPT_MODES = ["replace", "append"] as const;
const DEFAULT_CONTEXTS = ["fresh", "fork"] as const;
const ACCEPTANCE_ROLES = ["read-only", "writer"] as const;

/**
 * Frontmatter keys the web UI owns, spelled the way pi-subagents reads them.
 * Everything else in a profile file belongs to whichever runtime reads it, so a
 * save carries those keys through untouched.
 */
const MANAGED_FRONTMATTER_KEYS = new Set([
  "description",
  "display_name",
  "tools",
  "excludeTools",
  "extensions",
  "subagentOnlyExtensions",
  // `skill` is pi-subagents' legacy alias for `skills`; the web UI normalizes it
  // into `skills` and drops it so a stale alias cannot shadow the edited list.
  "skill",
  "skills",
  "skillPath",
  "model",
  "thinking",
  "systemPromptMode",
  "inheritProjectContext",
  "inheritGlobalContext",
  "inheritSkills",
  "defaultContext",
  "async",
  "timeoutMs",
  "toolTimeoutMs",
  "maxSubagentDepth",
  "allowNestedSubagents",
  "allowedAgents",
  "advertise",
  "output",
  "defaultReads",
  "defaultProgress",
  "acceptanceRole",
  "aliases",
]);

/**
 * Keys the removed pi-web editor wrote. pi-subagents ignores them, and leaving
 * them would keep claiming semantics pi-web no longer owns, so a save drops them.
 */
const RETIRED_FRONTMATTER_KEYS = new Set([
  "load_skills",
  "load_extensions",
  "inherit_context",
  "run_in_background",
  "prompt_mode",
  "max_turns",
  "color",
  "isolation",
  "persist_session",
  "enabled",
  "disallowed_tools",
]);

const FRONTMATTER_OPEN_RE = /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)/;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Booleans read as YAML (`true`) or as the string pi-subagents' line parser produces. */
function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/**
 * `parseFrontmatterList`: comma-separated scalars, YAML block lists, or the
 * `- item` block form pi-subagents' own line parser produces. A present-but-empty
 * value yields `[]`; an absent value yields `undefined`.
 */
function frontmatterList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value)
    ? value.map(String)
    : String(value)
      .split("\n")
      .flatMap((line) => {
        const text = line.trim();
        const item = /^-\s+(.+)$/.exec(text);
        return (item?.[1] ?? text).split(",");
      });
  return raw.map((entry) => entry.trim()).filter(Boolean);
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * `tools` is a strict child allowlist with two sentinel spellings from the old
 * editor: `none` means no tools and `all` / `*` means every builtin. Every other
 * value is kept verbatim (`mcp:`, extension paths, unknown names) so a foreign
 * selector survives a round-trip.
 */
function parseToolsField(value: unknown): string[] | undefined {
  const list = frontmatterList(value);
  if (list === undefined) return undefined;
  if (list.some((tool) => tool === "none")) return [];
  if (list.some((tool) => tool === "all" || tool === "*")) return [...CODING_TOOL_NAMES];
  return dedupe(list);
}

/**
 * The `extensions` tri-state: absent key = ambient loading, empty = none, a list
 * = allowlist. Booleans and `all` / `none` spellings written by the old editor are
 * normalized rather than read as a one-item allowlist.
 */
function parseExtensionsField(data: Record<string, unknown>): SubagentExtensions {
  const raw = data.extensions !== undefined ? data.extensions : data.load_extensions;
  if (raw === undefined) return { kind: "omit" };
  // A bare `extensions:` key (YAML null or empty string) means no ambient loading.
  if (raw === null || raw === "") return { kind: "none" };
  const scalar = typeof raw === "string" ? raw.trim().toLowerCase() : raw;
  if (scalar === true || scalar === "true" || scalar === "all") return { kind: "omit" };
  if (scalar === false || scalar === "false" || scalar === "none") return { kind: "none" };
  const list = frontmatterList(raw) ?? [];
  return list.length > 0 ? { kind: "list", list } : { kind: "none" };
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
    if (MANAGED_FRONTMATTER_KEYS.has(key) || RETIRED_FRONTMATTER_KEYS.has(key)) continue;
    preserved[key] = value;
  }
  return preserved;
}

/**
 * pi-subagents reads simple-scalar lists as comma-separated strings. js-yaml's
 * `[]` for an empty array would parse back as a literal tool named `[]`, so list
 * fields serialize as joined strings and an explicit empty list as `''`.
 */
function joinList(values: readonly string[]): string {
  return values.join(", ");
}

/** Validate a value against a closed union, throwing a clear error for anything else. */
function assertEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`Invalid ${label}: ${String(value)}`);
}

/** Parse-side enum read: an unrecognized value is ignored, never hides the file. */
function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : undefined;
}

function assertBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${label} must be a boolean`);
}

function assertPositiveInt(value: unknown, label: string, max?: number): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || (max !== undefined && parsed > max)) {
    throw new Error(`${label} must be a positive integer${max !== undefined ? ` no larger than ${max}` : ""}`);
  }
  return parsed;
}

/** Parse-side positive-int read: an invalid value is ignored, never hides the file. */
function positiveIntValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeExtensions(value: unknown): SubagentExtensions {
  if (value === undefined || value === null) return { kind: "omit" };
  if (isRecord(value)) {
    const kind = value.kind;
    if (kind === "omit") return { kind: "omit" };
    if (kind === "none") return { kind: "none" };
    if (kind === "list") return { kind: "list", list: dedupe(frontmatterList(value.list) ?? []) };
    throw new Error(`Invalid extensions kind: ${String(kind)}`);
  }
  if (value === "omit" || value === "none" || value === "list") return { kind: value };
  throw new Error(`Invalid extensions kind: ${String(value)}`);
}

/** Normalize an optional string list, returning `undefined` when it holds nothing. */
function optionalList(value: unknown): string[] | undefined {
  const list = dedupe(frontmatterList(value) ?? []);
  return list.length > 0 ? list : undefined;
}

function parseProfileFile(filePath: string, scope: SubagentScope): SubagentProfile | null {
  try {
    const source = readFileSync(filePath, "utf8");
    const { data, rest } = parseFrontmatter(source);
    const name = stringValue(data?.name) ?? basename(filePath, ".md");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return null;
    if (!data) {
      return { name, description: name, systemPrompt: rest.trim(), toolsInherited: true, scope, filePath };
    }
    // pi-subagents' line parser maps a bare `thinking: false` to the legacy
    // "off" sentinel; keep it explicit so a save does not revert it to inherit.
    const thinkingValue = data.thinking === false || data.thinking === "false"
      ? "off"
      : stringValue(data.thinking) as ThinkingLevel | undefined;

    // Legacy migration: the new key wins, and the old editor's spelling fills in
    // for a file written before this schema existed.
    const tools = parseToolsField(data.tools);
    const excludeTools = optionalList(data.excludeTools !== undefined ? data.excludeTools : data.disallowed_tools);

    // pi-subagents reads `skill || skills` (the alias wins when both are
    // present); mirror that precedence, then normalize the alias away on save so
    // an edited list is never shadowed by a stale `skill` after the round-trip.
    let skills = optionalList(data.skill);
    if (skills === undefined) skills = optionalList(data.skills);
    let inheritSkillsFlag = booleanValue(data.inheritSkills) ?? booleanValue(data.load_skills);
    // The old editor wrote `skills: true` before the alias became an allowlist.
    if (typeof data.skills === "boolean") {
      inheritSkillsFlag = data.skills;
      skills = undefined;
    }

    const systemPromptMode = enumValue(
      data.systemPromptMode !== undefined ? data.systemPromptMode : data.prompt_mode,
      SYSTEM_PROMPT_MODES,
    );
    const inheritProjectContext = booleanValue(data.inheritProjectContext) ?? booleanValue(data.inherit_context);
    const defaultContext = enumValue(data.defaultContext, DEFAULT_CONTEXTS);
    const async = booleanValue(data.async) ?? booleanValue(data.run_in_background);
    const acceptanceRole = enumValue(data.acceptanceRole, ACCEPTANCE_ROLES);
    const timeoutMs = positiveIntValue(data.timeoutMs);
    const toolTimeoutMs = positiveIntValue(data.toolTimeoutMs);
    // A present-but-empty `allowedAgents` denies every descendant launch; an
    // omitted key is unrestricted. The marker distinguishes the two after a read.
    const parsedAllowedAgents = data.allowedAgents !== undefined ? (frontmatterList(data.allowedAgents) ?? []) : undefined;
    const maxSubagentDepth = (() => {
      const raw = data.maxSubagentDepth;
      if (raw === undefined || raw === null || raw === "") return undefined;
      const parsed = typeof raw === "number" ? raw : Number(raw);
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
    })();

    return {
      name,
      ...(stringValue(data.display_name) ? { displayName: stringValue(data.display_name) } : {}),
      description: stringValue(data.description) ?? name,
      systemPrompt: rest.trim(),
      ...(tools !== undefined ? { tools } : {}),
      toolsInherited: tools === undefined,
      ...(excludeTools ? { excludeTools } : {}),
      extensions: parseExtensionsField(data),
      ...(optionalList(data.subagentOnlyExtensions) ? { subagentOnlyExtensions: optionalList(data.subagentOnlyExtensions) } : {}),
      ...(skills ? { skills } : {}),
      ...(optionalList(data.skillPath) ? { skillPath: optionalList(data.skillPath) } : {}),
      ...(stringValue(data.model) ? { model: stringValue(data.model) } : {}),
      ...(thinkingValue && THINKING_LEVELS.has(thinkingValue) ? { thinking: thinkingValue } : {}),
      ...(systemPromptMode ? { systemPromptMode } : {}),
      ...(inheritProjectContext !== undefined ? { inheritProjectContext } : {}),
      ...(booleanValue(data.inheritGlobalContext) !== undefined ? { inheritGlobalContext: booleanValue(data.inheritGlobalContext) } : {}),
      ...(inheritSkillsFlag !== undefined ? { inheritSkills: inheritSkillsFlag } : {}),
      ...(defaultContext ? { defaultContext } : {}),
      ...(async !== undefined ? { async } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
      ...(toolTimeoutMs ? { toolTimeoutMs } : {}),
      ...(maxSubagentDepth !== undefined ? { maxSubagentDepth } : {}),
      ...(booleanValue(data.allowNestedSubagents) !== undefined ? { allowNestedSubagents: booleanValue(data.allowNestedSubagents) } : {}),
      ...(parsedAllowedAgents !== undefined
        ? { allowedAgents: parsedAllowedAgents, allowedAgentsDenyAll: parsedAllowedAgents.length === 0 }
        : {}),
      ...(booleanValue(data.advertise) !== undefined ? { advertise: booleanValue(data.advertise) } : {}),
      ...(stringValue(data.output) ? { output: stringValue(data.output) } : {}),
      ...(optionalList(data.defaultReads) ? { defaultReads: optionalList(data.defaultReads) } : {}),
      ...(booleanValue(data.defaultProgress) !== undefined ? { defaultProgress: booleanValue(data.defaultProgress) } : {}),
      ...(acceptanceRole ? { acceptanceRole } : {}),
      ...(optionalList(data.aliases ?? data.alias) ? { aliases: optionalList(data.aliases ?? data.alias) } : {}),
      scope,
      filePath,
    };
  } catch {
    return null;
  }
}

function isProjectProfilePathAllowed(projectRoot: string, target: string): boolean {
  return isExistingPathWithinRoots(target, new Set([projectRoot]));
}

/**
 * pi-subagents discovers project agents at the nearest project root rather than
 * the session cwd, so a session opened in a subdirectory sees (and edits) the
 * same profiles the runtime loads. Falls back to cwd for a bare directory.
 */
function projectRootFor(cwd: string): string {
  return findConfiguredProjectRoot(cwd) ?? resolve(cwd);
}

function readProfileDirectory(dir: string, scope: SubagentScope, projectRoot: string): SubagentProfile[] {
  if (!existsSync(dir)) return [];
  if (scope !== "global" && !isProjectProfilePathAllowed(projectRoot, dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => parseProfileFile(join(dir, entry.name), scope))
    .filter((profile): profile is SubagentProfile => profile !== null);
}

function profileDirectories(cwd: string): Array<[string, Exclude<SubagentScope, "builtin">]> {
  const projectRoot = projectRootFor(cwd);
  return [
    [join(getAgentDir(), "agents"), "global"],
    [join(projectRoot, ".agents"), "workspace"],
    [join(projectRoot, ".pi", "agents"), "project"],
  ];
}

/** Every configured source, including profiles shadowed by a higher-precedence scope. */
export function listSubagentProfileSources(cwd: string): SubagentProfile[] {
  const projectRoot = projectRootFor(cwd);
  const profiles: SubagentProfile[] = [];
  for (const [dir, scope] of profileDirectories(cwd)) {
    profiles.push(...readProfileDirectory(dir, scope, projectRoot));
  }
  return profiles.sort((a, b) => (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name));
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
  if (scope === "project") return join(projectRootFor(cwd), ".pi", "agents");
  throw new Error("Agent scope must be global or project");
}

function assertWritableProfileDirectory(cwd: string, scope: SubagentWritableScope): string {
  const dir = writableProfileDirectory(cwd, scope);
  if (scope === "global") return dir;
  const projectRoot = projectRootFor(cwd);

  let existingAncestor = dir;
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) throw new Error("Agent profile directory is outside the project root");
    existingAncestor = parent;
  }
  if (!isProjectProfilePathAllowed(projectRoot, existingAncestor)) {
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
  if (profile.thinking && !THINKING_LEVELS.has(profile.thinking)) {
    throw new Error(`Invalid thinking level: ${profile.thinking}`);
  }
  const systemPromptMode = assertEnum(profile.systemPromptMode, SYSTEM_PROMPT_MODES, "systemPromptMode");
  const defaultContext = assertEnum(profile.defaultContext, DEFAULT_CONTEXTS, "defaultContext");
  const acceptanceRole = assertEnum(profile.acceptanceRole, ACCEPTANCE_ROLES, "acceptanceRole");
  const async = assertBoolean(profile.async, "async");
  const inheritProjectContext = assertBoolean(profile.inheritProjectContext, "inheritProjectContext");
  const inheritGlobalContext = assertBoolean(profile.inheritGlobalContext, "inheritGlobalContext");
  const inheritSkills = assertBoolean(profile.inheritSkills, "inheritSkills");
  const allowNestedSubagents = assertBoolean(profile.allowNestedSubagents, "allowNestedSubagents");
  const advertise = assertBoolean(profile.advertise, "advertise");
  const defaultProgress = assertBoolean(profile.defaultProgress, "defaultProgress");
  const timeoutMs = assertPositiveInt(profile.timeoutMs, "timeoutMs");
  const toolTimeoutMs = assertPositiveInt(profile.toolTimeoutMs, "toolTimeoutMs", TOOL_TIMEOUT_MAX_MS);
  const maxSubagentDepth = profile.maxSubagentDepth;
  if (maxSubagentDepth !== undefined && (!Number.isInteger(maxSubagentDepth) || maxSubagentDepth < 0)) {
    throw new Error("maxSubagentDepth must be a non-negative integer");
  }

  const displayName = profile.displayName?.trim() || name;
  const description = profile.description.trim() || name;
  const systemPrompt = profile.systemPrompt.trim();
  const model = profile.model?.trim() || undefined;
  // `toolsInherited` is the UI's tri-state helper: an inherited profile omits the
  // key entirely, an explicit list (including []) writes it verbatim.
  const toolsInherited = profile.toolsInherited === true;
  const tools = toolsInherited ? undefined : dedupe(profile.tools ?? []);
  const excludeTools = optionalList(profile.excludeTools);
  const extensions = normalizeExtensions(profile.extensions);
  const dir = assertWritableProfileDirectory(cwd, scope);
  mkdirSync(dir, { recursive: true });
  if (scope === "project" && !isProjectProfilePathAllowed(projectRootFor(cwd), dir)) {
    throw new Error("Agent profile directory is outside the project root");
  }
  const filePath = join(dir, `${name}.md`);
  const stored = readStoredFrontmatter(filePath);

  const managed: Record<string, unknown> = {};
  managed.description = description;
  managed.display_name = displayName;
  if (tools !== undefined) managed.tools = joinList(tools);
  if (excludeTools) managed.excludeTools = joinList(excludeTools);
  if (extensions.kind === "none") managed.extensions = "";
  else if (extensions.kind === "list") managed.extensions = joinList(extensions.list ?? []);
  const subagentOnlyExtensions = optionalList(profile.subagentOnlyExtensions);
  if (subagentOnlyExtensions) managed.subagentOnlyExtensions = joinList(subagentOnlyExtensions);
  const skills = optionalList(profile.skills);
  if (skills) managed.skills = joinList(skills);
  const skillPath = optionalList(profile.skillPath);
  if (skillPath) managed.skillPath = joinList(skillPath);
  if (model) managed.model = model;
  if (profile.thinking) managed.thinking = profile.thinking;
  if (systemPromptMode && systemPromptMode !== "replace") managed.systemPromptMode = systemPromptMode;
  if (inheritProjectContext !== undefined) managed.inheritProjectContext = inheritProjectContext;
  if (inheritGlobalContext !== undefined) managed.inheritGlobalContext = inheritGlobalContext;
  if (inheritSkills !== undefined) managed.inheritSkills = inheritSkills;
  if (defaultContext) managed.defaultContext = defaultContext;
  if (async !== undefined) managed.async = async;
  if (timeoutMs) managed.timeoutMs = timeoutMs;
  if (toolTimeoutMs) managed.toolTimeoutMs = toolTimeoutMs;
  if (maxSubagentDepth !== undefined) managed.maxSubagentDepth = maxSubagentDepth;
  if (allowNestedSubagents !== undefined) managed.allowNestedSubagents = allowNestedSubagents;
  // Presence-preserving deny-all: the marker writes the bare empty value that
  // pi-subagents reads as "no descendant launches" instead of dropping the key.
  const allowedAgents = optionalList(profile.allowedAgents);
  if (profile.allowedAgentsDenyAll === true) managed.allowedAgents = "";
  else if (allowedAgents) managed.allowedAgents = joinList(allowedAgents);
  if (advertise !== undefined) managed.advertise = advertise;
  if (profile.output?.trim()) managed.output = profile.output.trim();
  const defaultReads = optionalList(profile.defaultReads);
  if (defaultReads) managed.defaultReads = joinList(defaultReads);
  if (defaultProgress !== undefined) managed.defaultProgress = defaultProgress;
  if (acceptanceRole) managed.acceptanceRole = acceptanceRole;
  const aliases = optionalList(profile.aliases);
  if (aliases) managed.aliases = joinList(aliases);

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
    ...(tools !== undefined ? { tools } : { tools: undefined }),
    toolsInherited,
    ...(excludeTools ? { excludeTools } : { excludeTools: undefined }),
    extensions,
    ...(subagentOnlyExtensions ? { subagentOnlyExtensions } : {}),
    ...(skills ? { skills } : {}),
    ...(skillPath ? { skillPath } : {}),
    ...(model ? { model } : { model: undefined }),
    ...(systemPromptMode ? { systemPromptMode } : {}),
    ...(inheritProjectContext !== undefined ? { inheritProjectContext } : {}),
    ...(inheritGlobalContext !== undefined ? { inheritGlobalContext } : {}),
    ...(inheritSkills !== undefined ? { inheritSkills } : {}),
    ...(defaultContext ? { defaultContext } : {}),
    ...(async !== undefined ? { async } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(toolTimeoutMs ? { toolTimeoutMs } : {}),
    ...(maxSubagentDepth !== undefined ? { maxSubagentDepth } : {}),
    ...(allowNestedSubagents !== undefined ? { allowNestedSubagents } : {}),
    ...(profile.allowedAgentsDenyAll === true
      ? { allowedAgents: [], allowedAgentsDenyAll: true }
      : allowedAgents
        ? { allowedAgents, allowedAgentsDenyAll: false }
        : { allowedAgents: undefined, allowedAgentsDenyAll: undefined }),
    ...(advertise !== undefined ? { advertise } : {}),
    ...(profile.output?.trim() ? { output: profile.output.trim() } : {}),
    ...(defaultReads ? { defaultReads } : {}),
    ...(defaultProgress !== undefined ? { defaultProgress } : {}),
    ...(acceptanceRole ? { acceptanceRole } : {}),
    ...(aliases ? { aliases } : {}),
    scope,
    filePath,
  };
}

export function deleteSubagentProfile(cwd: string, scope: SubagentWritableScope, name: string): void {
  const safeName = assertProfileName(name);
  const filePath = join(assertWritableProfileDirectory(cwd, scope), `${safeName}.md`);
  if (existsSync(filePath)) unlinkSync(filePath);
}

/**
 * A writable profile file already claims this name in the scope, so an eject
 * would overwrite it. Raised as its own type so the route can answer 409.
 */
export class SubagentProfileExistsError extends Error {
  constructor(readonly filePath: string) {
    super("An agent file already exists at this location");
    this.name = "SubagentProfileExistsError";
  }
}

/**
 * pi-subagents' `eject` only duplicates a bundled builtin or package agent; a
 * user/project row is already an editable file, so duplicating it would just
 * create a same-name shadow rather than exposing a bundled definition.
 */
const EJECTABLE_SOURCES: readonly AgentCatalogSource[] = ["builtin", "package"];

/**
 * pi-subagents' `eject`: copy a bundled builtin or package agent file verbatim
 * into a writable agent directory as an editable file that shadows the source.
 * The bytes are copied unchanged; only the file name is normalized, so the
 * copy stays in the dialect the source was written in. A same-named file in the
 * target scope conflicts instead of overwriting (409 at the route).
 */
export function ejectSubagentProfile(
  cwd: string,
  scope: SubagentWritableScope,
  sourcePath: string,
  name: string,
  source: AgentCatalogSource,
): SubagentProfile {
  if (!EJECTABLE_SOURCES.includes(source)) {
    throw new Error("Only built-in and package agents can be duplicated");
  }
  const safeName = assertProfileName(name);
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    throw new Error("Source agent file not found");
  }
  const contents = readFileSync(sourcePath, "utf8");
  const dir = assertWritableProfileDirectory(cwd, scope);
  const filePath = join(dir, `${safeName}.md`);
  if (existsSync(filePath)) throw new SubagentProfileExistsError(filePath);
  mkdirSync(dir, { recursive: true });
  if (scope === "project" && !isProjectProfilePathAllowed(projectRootFor(cwd), dir)) {
    throw new Error("Agent profile directory is outside the project root");
  }
  writePrivateFileAtomicSync(filePath, contents);
  const profile = parseProfileFile(filePath, scope);
  if (!profile) {
    // The copy would shadow the source yet stay invisible to the editor, so
    // remove it before reporting the failure.
    try {
      unlinkSync(filePath);
    } catch {
      // Best effort: a file that cannot be removed still reports the parse failure.
    }
    throw new Error("Copied agent file could not be parsed as a profile");
  }
  return profile;
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

/** Restore the isolated prompt and tool scope used by a persisted subagent session. */
export function readSubagentSessionResources(
  entries: readonly SessionEntry[],
): SubagentSessionResources | null {
  const data = subagentMetadataData(entries);
  if (!data) return null;
  const snapshot = data.resourceSnapshot;
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
      && !SUBAGENT_CONTROL_TOOLS.has(item)
      && (BUILTIN_TOOLS.has(item) || loadExtensions)
    )
  ) {
    return {
      appendSystemPrompt: [...snapshot.appendSystemPrompt],
      tools: [...new Set(snapshot.tools)],
      loadSkills,
      loadExtensions,
      ...(typeof snapshot.exactSystemPrompt === "string" ? { exactSystemPrompt: snapshot.exactSystemPrompt } : {}),
    };
  }
  return null;
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
