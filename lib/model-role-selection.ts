export const MODEL_ROLE_THINKING_LEVELS = [
  "inherit",
  "off",
  "auto",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ModelRoleThinkingLevel = typeof MODEL_ROLE_THINKING_LEVELS[number];

const MODEL_ROLE_THINKING_LEVEL_SET = new Set<string>(MODEL_ROLE_THINKING_LEVELS);

function isModelRoleThinkingLevel(value: string | undefined): value is ModelRoleThinkingLevel {
  return value !== undefined && MODEL_ROLE_THINKING_LEVEL_SET.has(value);
}

/**
 * Return omp's thinking strip for a model, keeping only efforts supported by
 * that model. Inherit, off, and auto are always valid selector choices.
 */
export function getModelRoleThinkingOptions(supported?: readonly string[]): ModelRoleThinkingLevel[] {
  if (!supported) return [...MODEL_ROLE_THINKING_LEVELS];
  const supportedSet = new Set(supported);
  return MODEL_ROLE_THINKING_LEVELS.filter((level) => (
    level === "inherit" || level === "off" || level === "auto" || supportedSet.has(level)
  ));
}

/** Read the explicit `:thinkingLevel` suffix from a role selector. */
export function getModelRoleThinkingLevel(selector?: string): ModelRoleThinkingLevel {
  if (!selector) return "inherit";
  const separator = selector.lastIndexOf(":");
  const suffix = separator >= 0 ? selector.slice(separator + 1) : undefined;
  return isModelRoleThinkingLevel(suffix) ? suffix : "inherit";
}

/** Replace only a known thinking suffix, preserving the model selector. */
export function formatModelRoleSelector(selector: string, level: ModelRoleThinkingLevel): string {
  const separator = selector.lastIndexOf(":");
  const suffix = separator >= 0 ? selector.slice(separator + 1) : undefined;
  const base = isModelRoleThinkingLevel(suffix) ? selector.slice(0, separator) : selector;
  return level === "inherit" ? base : `${base}:${level}`;
}
