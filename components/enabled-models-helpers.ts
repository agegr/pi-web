import type { EnabledModelsModelView, EnabledModelsProviderView, EnabledModelsView } from "@/lib/enabled-models";

/** Rows shown for the current filter, matched on model name and id. */
export function filterEnabledModels(
  models: readonly EnabledModelsModelView[],
  query: string,
): EnabledModelsModelView[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...models];
  return models.filter((model) => (
    model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle)
  ));
}

export interface EnabledModelsBulkActions {
  /** References the "enable" action would send. */
  enableRefs: string[];
  /** References the "disable" action would send. */
  disableRefs: string[];
  canEnable: boolean;
  canDisable: boolean;
}

/**
 * Bulk actions for the rows currently shown.
 *
 * Mirrors the server guard: pi reads an empty scope as "no scope" and shows
 * every model again, so the UI never offers a bulk disable that would switch
 * off the last enabled model anywhere.
 */
export function enabledModelsBulkActions(
  view: EnabledModelsView | null,
  shown: readonly EnabledModelsModelView[],
): EnabledModelsBulkActions {
  const enableRefs = shown.filter((model) => !model.enabled).map((model) => model.ref);
  const disableRefs = shown.filter((model) => model.enabled).map((model) => model.ref);
  const editable = view?.editable === true;
  return {
    enableRefs,
    disableRefs,
    canEnable: editable && enableRefs.length > 0,
    canDisable: editable && disableRefs.length > 0
      && (view?.enabledTotal ?? 0) - disableRefs.length >= 1,
  };
}

export interface EnabledModelsProviderToggle {
  /** True when every model this provider offers is enabled. */
  checked: boolean;
  /** True when the switch cannot move in the direction it would go. */
  blocked: boolean;
  /** Why it cannot move, as a refusal key, or null while it can. */
  reason: "last-model" | "project-scope" | null;
}

/**
 * The single switch a models.json provider gets instead of per-model rows.
 *
 * Its two positions are "all of this provider's models" and "none of them",
 * so it reads `checked` from the full count rather than from "any enabled":
 * a partial selection left by the TUI or a hand-edited settings file shows as
 * off, next to the `1/2 enabled` count, and one click completes it. Reading it
 * the other way would make the partial state unreachable in both directions
 * whenever the last-enabled-model guard blocks the way down.
 */
export function enabledModelsProviderToggle(
  view: EnabledModelsView | null,
  provider: EnabledModelsProviderView,
): EnabledModelsProviderToggle {
  const bulk = enabledModelsBulkActions(view, provider.models);
  const checked = provider.models.length > 0 && provider.enabledCount === provider.models.length;
  const blocked = checked ? !bulk.canDisable : !bulk.canEnable;
  return {
    checked,
    blocked,
    reason: !blocked ? null : view?.editable ? "last-model" : "project-scope",
  };
}

/** True when switching this single model off would empty the scope. */
export function isLastEnabledModel(
  view: EnabledModelsView | null,
  model: EnabledModelsModelView,
): boolean {
  return model.enabled && (view?.enabledTotal ?? 0) <= 1;
}

export function findProviderView(
  view: EnabledModelsView | null,
  providerId: string,
): EnabledModelsProviderView | undefined {
  return view?.providers.find((provider) => provider.id === providerId);
}

/** `12/40` style badge for a provider row, or null while nothing is scoped. */
export function providerBadgeLabel(
  view: EnabledModelsView | null,
  providerId: string,
): string | null {
  if (!view || view.allEnabled) return null;
  const provider = findProviderView(view, providerId);
  if (!provider) return null;
  return `${provider.enabledCount}/${provider.models.length}`;
}
