"use client";

import { ChevronDown, Plus, Search, X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { SkillNavItem } from "./resource-settings-types";

export interface SkillsNavigatorProps {
  query: string;
  selection: string | null;
  active: SkillNavItem[];
  dormant: SkillNavItem[];
  dormantOpen: boolean;
  loading: boolean;
  error?: string;
  addSelected: boolean;
  onQueryChange(query: string): void;
  onSelect(filePath: string): void;
  onToggleDormant(): void;
  onAdd(): void;
  onRetry(): void;
}

export function SkillsNavigator({
  query,
  selection,
  active,
  dormant,
  dormantOpen,
  loading,
  error,
  addSelected,
  onQueryChange,
  onSelect,
  onToggleDormant,
  onAdd,
  onRetry,
}: SkillsNavigatorProps) {
  const { t } = useI18n();
  const noResults = !loading && !error && active.length === 0 && dormant.length === 0;

  return (
    <div className="resource-settings-navigator">
      <div className="resource-settings-search">
        <Search size={13} strokeWidth={2} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("resources.searchSkills")}
          aria-label={t("resources.searchSkills")}
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
          <div className="resource-settings-nav-status">{t("resources.noMatchingSkills")}</div>
        ) : (
          <>
            {active.length > 0 && (
              <div className="resource-settings-group" role="group" aria-label={t("resources.active")}>
                <div className="resource-settings-group-label">{t("resources.active")}</div>
                {active.map((skill) => (
                  <button
                    key={skill.filePath}
                    type="button"
                    className="resource-settings-row"
                    data-selected={!addSelected && selection === skill.filePath ? "true" : undefined}
                    onClick={() => onSelect(skill.filePath)}
                  >
                    <span className="resource-settings-row-label">{skill.name}</span>
                  </button>
                ))}
              </div>
            )}
            {dormant.length > 0 && (
              <div className="resource-settings-group" role="group" aria-label={t("resources.dormant")}>
                <button
                  type="button"
                  className="resource-settings-disclosure"
                  aria-expanded={dormantOpen}
                  aria-controls="skills-dormant-list"
                  onClick={onToggleDormant}
                >
                  <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
                  <span className="resource-settings-group-label">{t("resources.dormant")}</span>
                  <span className="resource-settings-row-count">{dormant.length}</span>
                </button>
                {dormantOpen && (
                  <div id="skills-dormant-list">
                    {dormant.map((skill) => (
                      <button
                        key={skill.filePath}
                        type="button"
                        className="resource-settings-row"
                        data-selected={!addSelected && selection === skill.filePath ? "true" : undefined}
                        onClick={() => onSelect(skill.filePath)}
                      >
                        <span className="resource-settings-row-label">{skill.name}</span>
                        <span className="resource-settings-row-status">{t("i18n.dormant")}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="resource-settings-navigator-footer">
        <button type="button" className="resource-settings-add" data-selected={addSelected ? "true" : undefined} onClick={onAdd}>
          <Plus size={12} strokeWidth={2} aria-hidden="true" />
          <span>{t("i18n.addSkill")}</span>
        </button>
      </div>
    </div>
  );
}
