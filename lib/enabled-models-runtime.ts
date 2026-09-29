import { homedir } from "os";
import { join, sep } from "path";
import { getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  resolveModelScopeWithDiagnostics,
  SettingsManager,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import {
  computeEnabledModelsState,
  modelRefProvider,
  type EnabledModelsInput,
  type EnabledModelsModelView,
  type EnabledModelsProviderView,
  type EnabledModelsView,
  type PatternResolution,
} from "./enabled-models";

/**
 * SDK adapter for the pure `enabledModels` editor in `lib/enabled-models.ts`.
 *
 * Pattern matching lives in the SDK resolver, so each configured pattern is
 * resolved on its own here to learn which models it covers and which thinking
 * level it pins. Resolving them one by one — instead of all at once, like
 * `lib/model-scope.ts` does for the selector — is what lets an edit touch only
 * the pattern responsible for a given model.
 */

const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function modelRef(model: { provider: string; id: string }): string {
  return `${model.provider}/${model.id}`;
}

/**
 * Resolve every configured pattern separately, keeping the input order.
 *
 * `resolveModelScopeWithDiagnostics()` wants a `ModelRuntime`; a snapshot shim
 * keeps the matching rules identical without touching the network or the
 * credential store between patterns.
 */
export async function resolvePatternMatches(
  patterns: readonly string[],
  models: readonly Model<Api>[],
): Promise<PatternResolution[]> {
  const snapshotRuntime = { getAvailable: async () => models } as ModelRuntime;
  const resolutions: PatternResolution[] = [];
  for (const pattern of patterns) {
    let scopedModels: { model: Model<Api>; thinkingLevel?: string }[] = [];
    try {
      ({ scopedModels } = await resolveModelScopeWithDiagnostics([pattern], snapshotRuntime));
    } catch {
      // An ambiguous or malformed entry still belongs to the user's config;
      // treat it as matching nothing so it is preserved verbatim.
      scopedModels = [];
    }
    const pin = scopedModels.find((scoped) => scoped.thinkingLevel)?.thinkingLevel;
    resolutions.push({
      pattern,
      matched: scopedModels.map((scoped) => modelRef(scoped.model)),
      ...(pin ? { pin } : {}),
    });
  }
  return resolutions;
}

/** Glob shapes tried for a provider, shortest first. */
const PROVIDER_GLOB_CANDIDATES = ["*", "**"];

/**
 * For each provider, the shortest glob that resolves to exactly its models.
 *
 * `provider/*` is not that glob whenever a model id contains a slash: pi matches
 * patterns with minimatch, whose `*` stops at `/`, so `commandcode/*` misses
 * `commandcode/sakana/fugu-ultra` and every other nested id. Writing an assumed
 * glob would silently disable those models, so each candidate is resolved and
 * kept only when its match set is exactly the provider's model set. A provider
 * that no candidate covers is simply absent here and gets explicit entries.
 */
export async function resolveProviderGlobs(
  models: readonly Model<Api>[],
): Promise<Record<string, string>> {
  const refsByProvider = new Map<string, Set<string>>();
  for (const model of models) {
    const refs = refsByProvider.get(model.provider);
    if (refs) refs.add(modelRef(model));
    else refsByProvider.set(model.provider, new Set([modelRef(model)]));
  }

  const globs: Record<string, string> = {};
  for (const [provider, refs] of refsByProvider) {
    const candidates = PROVIDER_GLOB_CANDIDATES.map((suffix) => `${provider}/${suffix}`);
    for (const resolution of await resolvePatternMatches(candidates, models)) {
      if (resolution.matched.length !== refs.size) continue;
      if (!resolution.matched.every((ref) => refs.has(ref))) continue;
      globs[provider] = resolution.pattern;
      break;
    }
  }
  return globs;
}

export async function buildEnabledModelsInput(
  patterns: string[] | undefined,
  models: readonly Model<Api>[],
  options: { withProviderGlobs?: boolean } = {},
): Promise<EnabledModelsInput> {
  return {
    patterns,
    availableRefs: models.map(modelRef),
    resolutions: await resolvePatternMatches(patterns ?? [], models),
    // Only an edit needs them; the read-only view never writes a pattern.
    ...(options.withProviderGlobs ? { providerGlobs: await resolveProviderGlobs(models) } : {}),
  };
}

/**
 * Provider ids whose models pi-web must not offer to edit one by one.
 *
 * A provider is built in when pi ships it or an extension registered it at
 * runtime; everything else is defined by models.json.
 */
export function customProviderIds(modelRuntime: ModelRuntime): Set<string> {
  const known = new Set<string>([...getBuiltinProviders(), ...modelRuntime.getRegisteredProviderIds()]);
  return new Set(
    modelRuntime.getProviders().map((provider) => provider.id).filter((id) => !known.has(id)),
  );
}

export interface EnabledModelsViewOptions {
  input: EnabledModelsInput;
  models: readonly Model<Api>[];
  providerNames: Map<string, string>;
  customProviders: ReadonlySet<string>;
  scope: "global" | "project";
  settingsPath: string;
  modelError?: string;
}

export function buildEnabledModelsView({
  input,
  models,
  providerNames,
  customProviders,
  scope,
  settingsPath,
  modelError,
}: EnabledModelsViewOptions): EnabledModelsView {
  const state = computeEnabledModelsState(input);
  const enabled = new Set(state.enabled);

  const byProvider = new Map<string, EnabledModelsModelView[]>();
  for (const model of models) {
    const ref = modelRef(model);
    const pin = state.pins[ref];
    const entry: EnabledModelsModelView = {
      id: model.id,
      name: model.name || model.id,
      ref,
      enabled: enabled.has(ref),
      ...(pin ? { thinkingPin: pin } : {}),
    };
    const list = byProvider.get(model.provider);
    if (list) list.push(entry);
    else byProvider.set(model.provider, [entry]);
  }

  const providers: EnabledModelsProviderView[] = [...byProvider.entries()].map(([id, entries]) => {
    entries.sort((a, b) => modelNameCollator.compare(a.name, b.name) || modelNameCollator.compare(a.id, b.id));
    return {
      id,
      name: providerNames.get(id) ?? id,
      kind: customProviders.has(id) ? "custom" : "builtin",
      enabledCount: entries.filter((entry) => entry.enabled).length,
      models: entries,
    };
  });
  providers.sort((a, b) => modelNameCollator.compare(a.name, b.name) || modelNameCollator.compare(a.id, b.id));

  return {
    allEnabled: state.allEnabled,
    patterns: input.patterns ?? null,
    stalePatterns: state.stalePatterns,
    enabledTotal: state.enabled.length,
    availableTotal: input.availableRefs.length,
    providers,
    scope,
    settingsPath,
    editable: scope === "global",
    ...(modelError ? { modelError } : {}),
  };
}

export interface EnabledModelsSettings {
  /** Effective value, i.e. what the model selector actually applies. */
  patterns: string[] | undefined;
  scope: "global" | "project";
  /** The file that value came from, with the home directory shortened to `~`. */
  path: string;
}

/** `~/.pi/agent/settings.json` reads better in a banner than the full path. */
function displayPath(path: string): string {
  const home = homedir();
  if (!home || !path.startsWith(home)) return path;
  const rest = path.slice(home.length);
  return rest === "" || rest.startsWith(sep) ? `~${rest}` : path;
}

/**
 * Read the effective `enabledModels` and say where it comes from.
 *
 * `SettingsManager.setEnabledModels()` only ever writes the global file, and a
 * project array replaces the global one instead of merging, so a project-level
 * value makes every toggle a no-op. The route reports that instead of writing
 * something the user would never see take effect.
 */
export function readEnabledModelsSettings(
  settingsManager: SettingsManager,
  { cwd, agentDir }: { cwd: string; agentDir: string },
): EnabledModelsSettings {
  const projectPatterns = settingsManager.getProjectSettings().enabledModels;
  const scope = projectPatterns === undefined ? "global" : "project";
  return {
    patterns: settingsManager.getEnabledModels(),
    scope,
    path: displayPath(scope === "project"
      ? join(cwd, ".pi", "settings.json")
      : join(agentDir, "settings.json")),
  };
}

/**
 * Persist a new global `enabledModels`, merging into whatever is on disk now.
 *
 * `SettingsManager` skips the write when it could not load the settings file,
 * and it collects storage failures instead of throwing, so the queue is drained
 * here: a toggle that did not reach disk must not report success.
 */
export async function writeEnabledModels(
  settingsManager: SettingsManager,
  patterns: string[] | undefined,
): Promise<void> {
  const loadErrors = settingsManager.drainErrors();
  const globalLoadError = loadErrors.find((entry) => entry.scope === "global");
  if (globalLoadError) throw globalLoadError.error;
  settingsManager.setEnabledModels(patterns);
  await settingsManager.flush();
  const errors = settingsManager.drainErrors();
  if (errors.length > 0) throw errors[0].error;
}

export { modelRefProvider };
export type { EnabledModelsModelView, EnabledModelsProviderView, EnabledModelsView };
