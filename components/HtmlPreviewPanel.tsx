"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { RightPanelViewSwitcher } from "./RightPanelViewSwitcher";
import { ContextMenu } from "./ContextMenu";

export interface HtmlPreviewTab {
  id: string;
  title: string;
  html: string;
}

interface HtmlPreviewPanelProps {
  tabs: HtmlPreviewTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseOthers?: (id: string) => void;
  onCloseLeft?: (id: string) => void;
  onCloseRight?: (id: string) => void;
  onCloseAll?: () => void;
  view: "files" | "preview";
  onViewChange: (view: "files" | "preview") => void;
}

/** Fixed width of every preview tab, per design. */
const PREVIEW_TAB_WIDTH = 150;

/**
 * Right-side panel view for rendered HTML previews. Each chat html code block
 * becomes one tab (title = document <title>, "untitled" fallback). Content runs
 * in a sandboxed iframe so it cannot touch the host page.
 */
export function HtmlPreviewPanel({ tabs, activeTabId, onSelectTab, onCloseTab, onCloseOthers, onCloseLeft, onCloseRight, onCloseAll, view, onViewChange }: HtmlPreviewPanelProps) {
  const { t } = useI18n();
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const [loaded, setLoaded] = useState(false);
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);

  const closeOthers = onCloseOthers ?? (() => {});
  const closeLeft = onCloseLeft ?? (() => {});
  const closeRight = onCloseRight ?? (() => {});
  const closeAll = onCloseAll ?? (() => {});

  // A new tab remounts the iframe — reset the loading flag.
  useEffect(() => {
    setLoaded(false);
  }, [activeTabId]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Preview tabs row with view switcher */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          background: "var(--bg-panel)",
          overflowX: "auto",
          flexShrink: 0,
          height: "calc(36px + env(safe-area-inset-top))",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <div style={{ alignSelf: "center" }}>
          <RightPanelViewSwitcher
            view={view}
            onViewChange={onViewChange}
            previewAvailable
          />
        </div>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              onAuxClick={(e) => {
                if (e.button !== 1) return;
                e.preventDefault();
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 36,
                paddingLeft: 12,
                paddingRight: 6,
                borderRight: "1px solid var(--border)",
                background: isActive ? "var(--bg)" : "var(--bg-panel)",
                cursor: "pointer",
                fontSize: 12,
                color: isActive ? "var(--text)" : "var(--text-muted)",
                whiteSpace: "nowrap",
                width: PREVIEW_TAB_WIDTH,
                flexShrink: 0,
                userSelect: "none",
                transition: "background 0.1s, color 0.1s",
              }}
              title={tab.title}
            >
              <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7, display: "flex", alignItems: "center" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 5v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z" />
                  <path d="M14 4v5M10 4v5M4 11h16" />
                </svg>
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", flex: 1, fontWeight: isActive ? 500 : 400 }}>
                {tab.title}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 24, height: 24,
                  background: "transparent",
                  border: "none",
                  borderRadius: 4,
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  padding: 0,
                  flexShrink: 0,
                }}
                title={t("i18n.close")}
                aria-label={`${t("i18n.close")} ${tab.title}`}
              >
                <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <line x1="2" y1="2" x2="8" y2="8" />
                  <line x1="8" y1="2" x2="2" y2="8" />
                </svg>
              </button>
            </div>
          );
        })}
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            items={[
              { label: t("i18n.close"), onClick: () => onCloseTab(menu.tabId) },
              {
                label: t("i18n.closeOthers"),
                onClick: () => closeOthers(menu.tabId),
                disabled: tabs.length <= 1,
              },
              {
                label: t("i18n.closeLeft"),
                onClick: () => closeLeft(menu.tabId),
                disabled: tabs[0]?.id === menu.tabId,
              },
              {
                label: t("i18n.closeRight"),
                onClick: () => closeRight(menu.tabId),
                disabled: tabs[tabs.length - 1]?.id === menu.tabId,
              },
              { label: t("i18n.closeAll"), onClick: closeAll },
            ]}
          />
        )}
      </div>

      {activeTab ? (
        <>
          {/* Sandboxed preview iframe */}
          <div style={{ position: "relative", flex: 1, minHeight: 0, background: "#fff" }}>
            {!loaded && (
              <div style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-dim)",
                fontSize: 12,
                pointerEvents: "none",
              }}>
                {t("i18n.loadingPreview")}
              </div>
            )}
            <iframe
              key={activeTab.id}
              srcDoc={activeTab.html}
              sandbox="allow-scripts allow-popups allow-modals"
              onLoad={() => setLoaded(true)}
              title={activeTab.title}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
            />
          </div>
        </>
      ) : (
        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
          {t("i18n.emptyHtmlPreview")}
        </div>
      )}
    </div>
  );
}
