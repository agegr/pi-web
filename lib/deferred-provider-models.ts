import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "./models-cache";
import { resolveVisibleModels, selectInitialModelScope, type InitialModelScopeOptions } from "./model-scope";

type RuntimeModel = Awaited<ReturnType<ModelRuntime["getAvailable"]>>[number];

/**
 * Models of every provider seen in any ModelRuntime of this process, by provider.
 *
 * pi-web builds a runtime per `/api/models` load, and the Models panel's routes share one that
 * `lib/model-runtime.ts` builds again after a plugin change, a reload or its expiry. Some
 * extensions register their provider only in the first runtime of a process, deferring later
 * ones to `session_start` (pi-claude-bridge does, so a subagent sharing its parent's registry
 * does not overwrite the parent's stream function). A listing runtime never starts a session, so
 * after the first one those providers vanished from the model picker, and a session could not
 * start on them.
 */
declare global {
  var __piWebProviderModelCatalog: Map<string, RuntimeModel[]> | undefined;
}

function catalog(): Map<string, RuntimeModel[]> {
  globalThis.__piWebProviderModelCatalog ??= new Map();
  return globalThis.__piWebProviderModelCatalog;
}

/** Record what a runtime offers, so later runtimes can show a provider they have not registered yet. */
export async function rememberProviderModels(runtime: ModelRuntime): Promise<void> {
  const byProvider = new Map<string, RuntimeModel[]>();
  for (const model of await runtime.getAvailable()) {
    byProvider.set(model.provider, [...(byProvider.get(model.provider) ?? []), model]);
  }
  const added = [...byProvider.keys()].some((provider) => !catalog().has(provider));
  for (const [provider, models] of byProvider) catalog().set(provider, models);
  // A listing cached before this provider was known would hide it for the cache lifetime.
  if (added) invalidateModelsCache();
}

/**
 * Remembered models of providers this runtime does not know at all. A provider the runtime
 * registered but cannot use (signed out, no key) is never added back: only a registration that
 * has not happened yet in this runtime is filled in.
 */
export function deferredProviderModels(runtime: ModelRuntime): RuntimeModel[] {
  const registered = new Set(runtime.getModels().map((model) => model.provider));
  return [...catalog()].flatMap(([provider, models]) => (registered.has(provider) ? [] : models));
}

/** The runtime as a model listing should see it: its own available models plus deferred ones. */
export function withDeferredProviderModels(runtime: ModelRuntime): ModelRuntime {
  return new Proxy(runtime, {
    get(target, property, receiver) {
      if (property === "getAvailable") {
        return async (...args: Parameters<ModelRuntime["getAvailable"]>) => {
          const [providerId] = args;
          const deferred = deferredProviderModels(target).filter((model) => !providerId || model.provider === providerId);
          return [...await target.getAvailable(...args), ...deferred];
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** A remembered model whose provider this runtime has not registered yet. */
export function findDeferredModel(runtime: ModelRuntime, provider: string, modelId: string): RuntimeModel | undefined {
  return deferredProviderModels(runtime).find((model) => model.provider === provider && model.id === modelId);
}

/**
 * pi's startup pick for a new session with deferred providers counted in, as `/api/models` makes
 * it for the model picker (#1240): the requested model, else the default when in scope, else the
 * scope's first model. The `enabledModels` patterns see the deferred models, so a default they
 * leave out is passed over as for a registered one. Returns the pick with its `enabledModels`
 * thinking pin when it is a deferred model; undefined when it is one this runtime has (the
 * session already starts on it) or the requested model is out of scope.
 */
export async function findDeferredStartupModel(
  runtime: ModelRuntime,
  enabledModels: string[] | undefined,
  options: Omit<InitialModelScopeOptions, "thinkingLevel">,
): Promise<{ model: RuntimeModel; thinkingLevelPin?: ThinkingLevel } | undefined> {
  if (deferredProviderModels(runtime).length === 0) return undefined;
  let selected: ReturnType<typeof selectInitialModelScope>;
  try {
    selected = selectInitialModelScope(await resolveVisibleModels(withDeferredProviderModels(runtime), enabledModels), options);
  } catch {
    // A requested model out of scope.
    return undefined;
  }
  const model = selected.model && findDeferredModel(runtime, selected.model.provider, selected.model.id);
  return model ? { model, ...(selected.thinkingLevel ? { thinkingLevelPin: selected.thinkingLevel } : {}) } : undefined;
}
