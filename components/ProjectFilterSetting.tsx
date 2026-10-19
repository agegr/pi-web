"use client";

import { useI18n } from "@/hooks/useI18n";
import { setProjectFilterMode, useProjectFilterMode } from "@/lib/project-filter";

/**
 * Settings › General's Project filter row, beside the file browser's
 * placement: the sidebar's session tree either shows every project or is
 * filtered to the one the file browser has picked. Reads and writes the same
 * live store as the sidebar; rendering itself keeps SettingsPanel's surface
 * to one element.
 */
export function ProjectFilterSetting() {
  const { t } = useI18n();
  const filterMode = useProjectFilterMode();
  return (
    <div className="settings-chat-option settings-chat-switch-option" role="radiogroup" aria-label={t("settings.projectFilter")}>
      <span>{t("settings.projectFilter")}</span>
      <div className="settings-send-mode-options">
        <label className="settings-send-mode-option">
          <input
            type="radio"
            name="project-filter"
            value="off"
            checked={filterMode === "off"}
            onChange={() => setProjectFilterMode("off")}
            className="sr-only"
          />
          <span className="settings-send-mode-label">{t("sidebar.filterShowAll")}</span>
        </label>
        <label className="settings-send-mode-option">
          <input
            type="radio"
            name="project-filter"
            value="on"
            checked={filterMode === "on"}
            onChange={() => setProjectFilterMode("on")}
            className="sr-only"
          />
          <span className="settings-send-mode-label">{t("sidebar.filterCurrent")}</span>
        </label>
      </div>
    </div>
  );
}
