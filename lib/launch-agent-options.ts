import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

/**
 * Agent-level defaults forwarded by the pi-web launcher to the Next.js server.
 *
 * Pi Web is a long-running, multi-session host, so only options that affect
 * AgentSession construction are represented here. Browser-provided model and
 * thinking choices take precedence; launcher tool restrictions remain server
 * policy.
 */
export interface LaunchAgentOptions {
  additionalExtensionPaths?: string[];
  additionalSkillPaths?: string[];
  additionalPromptTemplatePaths?: string[];
  additionalThemePaths?: string[];
  noExtensions?: boolean;
  noSkills?: boolean;
  noPromptTemplates?: boolean;
  noThemes?: boolean;
  noContextFiles?: boolean;
  systemPrompt?: string;
  appendSystemPrompt?: string[];
  provider?: string;
  model?: string;
  thinking?: ThinkingLevel;
  models?: string[];
  apiKey?: string;
  tools?: string[];
  excludeTools?: string[];
  noTools?: "all" | "builtin";
}

const ARRAY_KEYS = [
  "models",
  "tools",
  "excludeTools",
  "additionalExtensionPaths",
  "additionalSkillPaths",
  "additionalPromptTemplatePaths",
  "additionalThemePaths",
  "appendSystemPrompt",
] as const;

const BOOLEAN_KEYS = [
  "noExtensions",
  "noSkills",
  "noPromptTemplates",
  "noThemes",
  "noContextFiles",
] as const;

const STRING_KEYS = [
  "provider",
  "model",
  "apiKey",
  "systemPrompt",
] as const;

const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function assertStringArray(value: unknown, key: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${key} must be an array of strings`);
  }
}

/** Parse the launcher's internal environment handoff with defensive validation. */
export function parseLaunchAgentOptions(raw: string | undefined): LaunchAgentOptions {
  if (!raw) return {};

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid PI_WEB_AGENT_OPTIONS JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PI_WEB_AGENT_OPTIONS must contain a JSON object");
  }

  const record = value as Record<string, unknown>;
  for (const key of ARRAY_KEYS) {
    if (record[key] !== undefined) assertStringArray(record[key], key);
  }
  for (const key of BOOLEAN_KEYS) {
    if (record[key] !== undefined && typeof record[key] !== "boolean") {
      throw new Error(`${key} must be a boolean`);
    }
  }
  for (const key of STRING_KEYS) {
    if (record[key] !== undefined && typeof record[key] !== "string") {
      throw new Error(`${key} must be a string`);
    }
  }
  if (record.thinking !== undefined
    && (typeof record.thinking !== "string" || !THINKING_LEVELS.has(record.thinking as ThinkingLevel))) {
    throw new Error(`Invalid thinking level: ${String(record.thinking)}`);
  }
  if (record.noTools !== undefined && record.noTools !== "all" && record.noTools !== "builtin") {
    throw new Error('noTools must be "all" or "builtin"');
  }

  return record as unknown as LaunchAgentOptions;
}

/** Select only the fields accepted by DefaultResourceLoader. */
export function getLaunchResourceLoaderOptions(options: LaunchAgentOptions) {
  return {
    additionalExtensionPaths: options.additionalExtensionPaths,
    additionalSkillPaths: options.additionalSkillPaths,
    additionalPromptTemplatePaths: options.additionalPromptTemplatePaths,
    additionalThemePaths: options.additionalThemePaths,
    noExtensions: options.noExtensions,
    noSkills: options.noSkills,
    noPromptTemplates: options.noPromptTemplates,
    noThemes: options.noThemes,
    noContextFiles: options.noContextFiles,
    systemPrompt: options.systemPrompt,
    appendSystemPrompt: options.appendSystemPrompt,
  };
}

let cachedRaw: string | undefined;
let cachedOptions: LaunchAgentOptions | undefined;

export function getLaunchAgentOptions(): LaunchAgentOptions {
  const raw = process.env.PI_WEB_AGENT_OPTIONS;
  if (cachedOptions === undefined || raw !== cachedRaw) {
    cachedRaw = raw;
    cachedOptions = parseLaunchAgentOptions(raw);
  }
  return cachedOptions;
}
