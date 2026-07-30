import { resolveModelScopeWithDiagnostics } from "@earendil-works/pi-coding-agent";

/**
 * Model scoping for the UI model selector.
 *
 * The `enabledModels` setting uses the same syntax as pi's `--models` flag:
 * globs matched with minimatch against `provider/modelId` or a bare `modelId`,
 * fuzzy matching for non-glob patterns, plus an optional `:thinkingLevel` suffix
 * (`anthropic/*:high`). Exact string comparison silently drops every model
 * behind a pattern like `my-gateway/*` (#307), so delegate to pi's own resolver
 * instead of reimplementing the matching rules here.
 */

/** Minimal shape of a resolved model — matches pi's `Model` structurally. */
export interface ScopeModel {
  id: string;
  provider: string;
  name: string;
}

export interface ModelScopeResult<T extends ScopeModel = ScopeModel> {
  /** Models the UI should offer, in resolver order (all available when unscoped). */
  visible: readonly T[];
  /** Human-readable messages for patterns that matched nothing. */
  warnings: string[];
}

/**
 * Resolve the visible model list for `patterns`.
 *
 * Falls back to every available model when no patterns are configured or when
 * the patterns resolve to nothing, so a stale or typo'd setting can never leave
 * the UI without any selectable model.
 */
export async function resolveVisibleModels<T extends ScopeModel>(
  modelRuntime: { getAvailable: () => Promise<readonly T[]> | readonly T[] },
  patterns: string[] | undefined,
): Promise<ModelScopeResult<T>> {
  const available = await modelRuntime.getAvailable();
  const unscoped: ModelScopeResult<T> = { visible: available, warnings: [] };

  const cleaned = (patterns ?? []).map((pattern) => pattern.trim()).filter(Boolean);
  if (cleaned.length === 0) return unscoped;

  try {
    const { scopedModels, diagnostics } = await resolveModelScopeWithDiagnostics(
      cleaned,
      // The resolver only reads `getAvailable()`; the cast keeps this helper
      // testable with a stub runtime.
      modelRuntime as unknown as Parameters<typeof resolveModelScopeWithDiagnostics>[1],
    );
    const warnings = diagnostics.map((diagnostic) => diagnostic.message);
    if (scopedModels.length === 0) return { visible: available, warnings };
    return { visible: scopedModels.map((scoped) => scoped.model) as unknown as readonly T[], warnings };
  } catch {
    return unscoped;
  }
}
