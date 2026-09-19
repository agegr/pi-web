/**
 * Pure helpers for the model-visibility dialog and its API route.
 *
 * pi's `enabledModels` setting (in ~/.pi/agent/settings.json) scopes which
 * models the selector offers. Entries follow the `--models` flag syntax:
 * globs (`anthropic/*`), bare ids, `provider/modelId` references, and an
 * optional `:thinkingLevel` suffix. The visibility dialog deliberately only
 * writes exact `provider/modelId` references; anything richer (globs, bare
 * ids, level pins) counts as an advanced scope that saving would replace.
 */

export interface VisibleModelRef {
  provider: string;
  id: string;
}

/** Stable identity for a model across the dialog's checkbox state. */
export function modelRefKey(model: VisibleModelRef): string {
  return `${model.provider}:${model.id}`;
}

/** Canonical `provider/modelId` reference used by exact-scope entries. */
export function toEnabledPattern(model: VisibleModelRef): string {
  return `${model.provider}/${model.id}`;
}

/**
 * True when a configured scope uses more than exact `provider/modelId`
 * references. Saving from the visibility dialog would rewrite those patterns
 * into an explicit model list, so the UI warns before that happens.
 */
export function hasAdvancedPatterns(patterns: readonly string[] | null | undefined): boolean {
  if (!patterns) return false;
  return patterns.some((pattern) => !pattern.includes("/") || /[*?[:]/.test(pattern));
}

export type VisibilitySave =
  | { type: "clear" }
  | { type: "patterns"; patterns: string[] };

/**
 * Translate a checkbox selection into the value to persist.
 *
 * - Every model visible → clear the setting so future models appear too
 *   (this also matches pi's "no scope" default).
 * - A proper subset → exact `provider/modelId` patterns.
 * - An empty (or whole-catalog-invalid) selection is rejected; pi falls back
 *   to showing every model when a scope matches nothing, so persisting an
 *   empty scope would silently do the opposite of hiding everything.
 */
export function computeVisibilitySave(
  checked: readonly VisibleModelRef[],
  totalModels: number,
): VisibilitySave | null {
  if (totalModels === 0 || checked.length === 0) return null;
  if (checked.length >= totalModels) return { type: "clear" };
  return { type: "patterns", patterns: checked.map(toEnabledPattern) };
}

export type SanitizedPatterns =
  | { patterns: string[] | undefined }
  | { error: string };

const MAX_PATTERN_LENGTH = 512;
const MAX_PATTERN_COUNT = 1000;

/** Validate a PUT body's `patterns` value: null/undefined clears the scope. */
export function sanitizeEnabledPatterns(input: unknown): SanitizedPatterns {
  if (input === null || input === undefined) return { patterns: undefined };
  if (!Array.isArray(input)) return { error: "patterns must be an array or null" };
  if (input.length === 0) return { error: "patterns must not be empty; use null to show all models" };
  if (input.length > MAX_PATTERN_COUNT) return { error: `patterns must not exceed ${MAX_PATTERN_COUNT} entries` };
  const patterns: string[] = [];
  for (const entry of input) {
    if (typeof entry !== "string") return { error: "patterns entries must be strings" };
    const trimmed = entry.trim();
    if (!trimmed) return { error: "patterns entries must not be empty" };
    if (trimmed.length > MAX_PATTERN_LENGTH) return { error: `pattern exceeds ${MAX_PATTERN_LENGTH} characters` };
    patterns.push(trimmed);
  }
  return { patterns };
}
