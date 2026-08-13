"use client";

import { Plus, Search, X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { PluginNavItem } from "./resource-settings-types";
import { pluginIdentity } from "./plugins-navigation";

export interface PluginsNavigatorProps {
  query: string;
  selection: string | null;
  project: PluginNavItem[];
  global: PluginNavItem[];
  loading: boolean;
  error?: string;
  addSelected: boolean;
  busy?: boolean;
  onQueryChange(query: string): void;
  onSelect(id: string): void;
  onAdd(): void;
  onRetry(): void;
}

export function PluginsNavigator({
  query,
  selection,
  project,
  global,
  loading,
  error,
  addSelected,
  busy,
  onQueryChange,
  onSelect,
  onAdd,
  onRetry,
}: PluginsNavigatorProps) {
  const { t } = useI18n();
  const noResults = !loading && !error && project.length === 0 && global.length === 0;

  const renderGroup = (label: string, rows: PluginNavItem[]) => {
    if (rows.length === 0) return null;
    return (
      <div className="resource-settings-group" role="group" aria-label={label}>
        <div className="resource-settings-group-label">{label}</div>
        {rows.map((pkg) => {
          const id = pluginIdentity(pkg);
          return (
            <button
              key={id}
              type="button"
              className="resource-settings-row"
              data-selected={!addSelected && selection === id ? "true" : undefined}
              disabled={busy}
              onClick={() => onSelect(id)}
            >
              <span className="resource-settings-row-label">{pkg.packageName ?? pkg.source}</span>
              <span className="resource-settings-row-status">{pkg.status}</span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="resource-settings-navigator">
      <div className="resource-settings-search">
        <Search size={13} strokeWidth={2} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("resources.searchPlugins")}
          aria-label={t("resources.searchPlugins")}
          type="search"
        />
        {query && (
          <button type="button" onClick={() => onQueryChange("")} aria-label={t("i18n.clearSearch")} title={t("i18n.clearSearch")}>
            <X size={12} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="resource-settings-navigator-scroll">
        {error && (
          <div className="resource-settings-nav-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={onRetry}>{t("i18n.refresh")}</button>
          </div>
        )}
        {loading ? (
          <div className="resource-settings-nav-status">{t("i18n.loading")}</div>
        ) : noResults ? (
          <div className="resource-settings-nav-status">{t("resources.noMatchingPlugins")}</div>
        ) : (
          <>
            {renderGroup(t("resources.projectPackages"), project)}
            {renderGroup(t("resources.globalPackages"), global)}
          </>
        )}
      </div>

      <div className="resource-settings-navigator-footer">
        <button type="button" className="resource-settings-add" data-selected={addSelected ? "true" : undefined} disabled={busy} onClick={onAdd}>
          <Plus size={12} strokeWidth={2} aria-hidden="true" />
          <span>{t("i18n.addPlugin")}</span>
        </button>
      </div>
    </div>
  );
}
