import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { ModelRegistry, Settings } from "@oh-my-pi/pi-coding-agent";
import { resolveModelScope, type ScopedModel } from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import type { Api, Model } from "@oh-my-pi/pi-ai";

/**
 * Model scoping shared by the UI selector and AgentSession startup.
 *
 * The `enabledModels` setting uses the same syntax as omp's `--models` flag:
 * globs matched against `provider/modelId` or a bare `modelId`, fuzzy matching
 * for non-glob patterns, plus an optional `:thinkingLevel` suffix
 * (`anthropic/*:high`). Exact string comparison silently drops every model
 * behind a pattern like `my-gateway/*`, so delegate to omp's own resolver
 * instead of reimplementing the matching rules here.
 */

/** The slice of `ModelRegistry` model scoping needs. */
export type ModelScopeRegistry = Pick<ModelRegistry, "getAvailable">;

export interface ModelScopeResult {
  /** Models the UI should offer, in resolver order (all available when unscoped). */
  visible: readonly Model<Api>[];
  /** SDK-native scope retained for AgentSession model cycling and extensions. */
  scopedModels: readonly ScopedModel[];
  /** `provider/modelId` → thinking level pinned with a `:level` pattern suffix. */
  thinkingLevelPins: Record<string, string>;
  /** Resolver diagnostics, e.g. a pattern that matched no model. */
  warnings: string[];
}

export interface InitialModelScopeOptions {
  requestedModel?: { provider: string; modelId: string };
  defaultModel?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
}

export interface InitialModelScopeResult {
  model?: Model<Api>;
  thinkingLevel?: ThinkingLevel;
  scopedModels: ScopedModel[];
}

function matchesModel(
  model: { provider: string; id: string },
  ref: { provider: string; modelId: string },
): boolean {
  return model.provider === ref.provider && model.id === ref.modelId;
}

/**
 * Resolve the visible model list for `patterns`.
 *
 * Falls back to every available model when no patterns are configured or when
 * the patterns resolve to nothing, so a stale or typo'd setting can never leave
 * the UI without any selectable model.
 */
export async function resolveVisibleModels(
  modelRegistry: ModelScopeRegistry,
  patterns: readonly string[] | undefined,
  settings?: Settings,
): Promise<ModelScopeResult> {
  const cleaned = (patterns ?? []).map((pattern) => pattern.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return {
      visible: modelRegistry.getAvailable(),
      scopedModels: [],
      thinkingLevelPins: {},
      warnings: [],
    };
  }

  const scopedModels = await resolveModelScope(cleaned, modelRegistry, undefined, settings);

  // omp's resolver drops unmatched patterns silently. Re-resolve each pattern on
  // its own so a typo surfaces in the UI instead of quietly shrinking the list.
  const warnings: string[] = [];
  await Promise.all(cleaned.map(async (pattern) => {
    const matched = await resolveModelScope([pattern], modelRegistry, undefined, settings);
    if (matched.length === 0) warnings.push(`No model matches "${pattern}" in enabledModels.`);
  }));

  if (scopedModels.length === 0) {
    return {
      visible: modelRegistry.getAvailable(),
      scopedModels: [],
      thinkingLevelPins: {},
      warnings,
    };
  }

  // `anthropic/*:high` pins a thinking level on every model the glob matched.
  // omp applies the pin of the model a new session starts with; report them all
  // so the client can look up whichever model it pre-selects.
  const thinkingLevelPins: Record<string, string> = {};
  for (const scoped of scopedModels) {
    if (scoped.thinkingLevel) {
      thinkingLevelPins[`${scoped.model.provider}/${scoped.model.id}`] = scoped.thinkingLevel;
    }
  }
  return {
    visible: scopedModels.map((scoped) => scoped.model),
    scopedModels,
    thinkingLevelPins,
    warnings,
  };
}

/**
 * Select the model and thinking level used to create a new AgentSession.
 *
 * This mirrors omp's startup rule: prefer an explicit selection, otherwise use
 * the `default` model role when it is in scope, then the first resolver-ordered
 * model. A scoped-model thinking pin is applied unless the caller supplied an
 * explicit thinking level.
 */
export function selectInitialModelScope(
  scope: ModelScopeResult,
  options: InitialModelScopeOptions = {},
): InitialModelScopeResult {
  const requestedRef = options.requestedModel;
  const defaultRef = options.defaultModel;
  const requested = requestedRef
    ? scope.visible.find((model) => matchesModel(model, requestedRef))
    : undefined;
  if (requestedRef && !requested) {
    throw new Error(
      `Model is not available in the enabled scope: ${requestedRef.provider}/${requestedRef.modelId}`,
    );
  }

  const requestedScoped = requested
    ? scope.scopedModels.find((scoped) => scoped.model === requested
      || matchesModel(scoped.model, { provider: requested.provider, modelId: requested.id }))
    : undefined;
  const defaultScoped = !requested && defaultRef
    ? scope.scopedModels.find((scoped) => matchesModel(scoped.model, defaultRef))
    : undefined;
  const fallbackScoped = !requested ? (defaultScoped ?? scope.scopedModels[0]) : undefined;
  const defaultVisible = !requested && !fallbackScoped && defaultRef
    ? scope.visible.find((model) => matchesModel(model, defaultRef))
    : undefined;
  const selectedModel = requested ?? fallbackScoped?.model ?? defaultVisible;
  const scopedSelection = requestedScoped ?? fallbackScoped;
  const thinkingLevel = options.thinkingLevel ?? scopedSelection?.thinkingLevel;

  return {
    ...(selectedModel ? { model: selectedModel } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    scopedModels: [...scope.scopedModels],
  };
}
