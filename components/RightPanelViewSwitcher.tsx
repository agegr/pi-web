"use client";

import { useI18n } from "@/hooks/useI18n";

interface RightPanelViewSwitcherProps {
  view: "files" | "preview";
  onViewChange: (view: "files" | "preview") => void;
  /** Preview button only appears once at least one preview tab exists. */
  previewAvailable: boolean;
}

/**
 * Icon-only view switcher for the right panel (files | html preview).
 * SVG line icons matching the app's icon style; active view uses --accent.
 */
export function RightPanelViewSwitcher({ view, onViewChange, previewAvailable }: RightPanelViewSwitcherProps) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, paddingLeft: 8, paddingRight: 8, flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => onViewChange("files")}
        className={["right-panel-view-switch", view === "files" ? "is-active" : ""].filter(Boolean).join(" ")}
        aria-pressed={view === "files"}
        title={t("i18n.filesView")}
        aria-label={t("i18n.filesView")}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      </button>
      {previewAvailable && (
        <button
          type="button"
          onClick={() => onViewChange("preview")}
          className={["right-panel-view-switch", view === "preview" ? "is-active" : ""].filter(Boolean).join(" ")}
          aria-pressed={view === "preview"}
          title={t("i18n.htmlPreview")}
          aria-label={t("i18n.htmlPreview")}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      )}
    </div>
  );
}
