// Pure selection/filter/dirty helpers for the Models settings navigator.
// No React, no fetch: everything here is unit-testable in isolation.

import type {
  ApiKeyProvider,
  ModelsAccountItem,
  ModelsCustomProviderItem,
  ModelsJson,
  OAuthProvider,
  Selection,
} from "./models-config-types";

export interface ModelsNavigationData {
  accounts: ModelsAccountItem[];
  providers: ModelsCustomProviderItem[];
  expandedProviders: ReadonlySet<string>;
}

export interface FilteredModelsNavigation {
  accounts: ModelsAccountItem[];
  providers: ModelsCustomProviderItem[];
  /** Providers whose model rows must be visible under the current query. */
  expandedProviders: ReadonlySet<string>;
}

export function filterModelsNavigation(data: ModelsNavigationData, query: string): FilteredModelsNavigation {
  const q = query.trim().toLocaleLowerCase();
  if (!q) {
    return { ...data, expandedProviders: data.expandedProviders };
  }
  const accounts = data.accounts.filter((account) =>
    account.name.toLocaleLowerCase().includes(q) || account.id.toLocaleLowerCase().includes(q));
  const providers: ModelsCustomProviderItem[] = [];
  const expanded = new Set<string>();
  for (const provider of data.providers) {
    const providerMatch = [provider.name, provider.baseUrl ?? "", provider.api ?? ""]
      .some((value) => value.toLocaleLowerCase().includes(q));
    if (providerMatch) {
      providers.push(provider);
      expanded.add(provider.name);
      continue;
    }
    const models = provider.models.filter((model) =>
      model.id.toLocaleLowerCase().includes(q) || (model.name ?? "").toLocaleLowerCase().includes(q));
    if (models.length > 0) {
      providers.push({ ...provider, models });
      expanded.add(provider.name);
    }
  }
  return { accounts, providers, expandedProviders: expanded };
}

function firstProviderSelection(config: ModelsJson): Selection | null {
  const keys = Object.keys(config.providers ?? {});
  return keys.length > 0 ? { type: "provider", name: keys[0] } : null;
}

/**
 * Resolves a stale selection against freshly loaded data. Falls back to the
 * parent provider for a deleted model, to the nearest provider for a deleted
 * provider, and to the list view for a disconnected account.
 */
export function resolveModelsSelection(
  selection: Selection | null,
  config: ModelsJson,
  oauthProviders: OAuthProvider[],
  apiKeyProviders: ApiKeyProvider[],
): Selection | null {
  if (!selection) return null;
  if (selection.type === "oauth") {
    return oauthProviders.some((p) => p.id === selection.providerId && p.loggedIn) ? selection : null;
  }
  if (selection.type === "apikey") {
    return apiKeyProviders.some((p) => p.id === selection.providerId && p.configured) ? selection : null;
  }
  if (selection.type === "provider") {
    return config.providers?.[selection.name] ? selection : firstProviderSelection(config);
  }
  const provider = config.providers?.[selection.providerName];
  if (provider?.models?.[selection.index]) return selection;
  if (provider) return { type: "provider", name: selection.providerName };
  return firstProviderSelection(config);
}

/** Detail header label for a selection: item name plus optional context. */
export function modelsSelectionLabel(
  selection: Selection | null,
  config: ModelsJson,
  oauthProviders: OAuthProvider[],
  apiKeyProviders: ApiKeyProvider[],
): { title: string; subtitle?: string } {
  if (!selection) return { title: "" };
  if (selection.type === "oauth") {
    const provider = oauthProviders.find((p) => p.id === selection.providerId);
    return provider ? { title: provider.name } : { title: "" };
  }
  if (selection.type === "apikey") {
    const provider = apiKeyProviders.find((p) => p.id === selection.providerId);
    return provider ? { title: provider.displayName } : { title: "" };
  }
  if (selection.type === "provider") {
    const provider = config.providers?.[selection.name];
    return provider ? { title: selection.name, subtitle: provider.baseUrl } : { title: "" };
  }
  const model = config.providers?.[selection.providerName]?.models?.[selection.index];
  return model ? { title: model.id, subtitle: selection.providerName } : { title: "" };
}

/**
 * Deterministic dirty comparison: object keys are compared in sorted order so
 * key reordering never looks like a change, while array order stays
 * meaningful because model order is part of the saved document.
 */
export function isModelsConfigDirty(baseline: ModelsJson | null, draft: ModelsJson): boolean {
  if (baseline === null) return Object.keys(draft.providers ?? {}).length > 0;
  return stableSerialize(baseline) !== stableSerialize(draft);
}

/** After a successful save, keep any edits made during the PUT/GET round-trip. */
export function applySavedModelsConfig(
  savedDraft: ModelsJson,
  currentDraft: ModelsJson,
  normalized: ModelsJson,
): ModelsJson {
  return isModelsConfigDirty(savedDraft, currentDraft) ? currentDraft : normalized;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item).sort().map((key) => [key, (item as Record<string, unknown>)[key]]),
        )
      : item);
}
