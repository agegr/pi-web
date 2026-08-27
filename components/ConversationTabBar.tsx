"use client";

import { useI18n } from "@/hooks/useI18n";
import { paneTitle, type ChatPane } from "@/lib/chat-panes";

interface Props {
  panes: ChatPane[];
  activePaneId: string | null;
  runningSessionIds: ReadonlySet<string>;
  onSelect: (paneId: string) => void;
  onClose: (paneId: string) => void;
}

export function ConversationTabBar({
  panes,
  activePaneId,
  runningSessionIds,
  onSelect,
  onClose,
}: Props) {
  const { t } = useI18n();
  if (panes.length <= 1) return null;

  return (
    <div
      role="tablist"
      aria-label={t("chat.openConversations")}
      style={{
        display: "flex",
        alignItems: "stretch",
        background: "var(--bg-panel)",
        borderBottom: "1px solid var(--border)",
        overflowX: "auto",
        flexShrink: 0,
        height: 34,
      }}
    >
      {panes.map((pane) => {
        const isActive = pane.paneId === activePaneId;
        const running = Boolean(pane.session && runningSessionIds.has(pane.session.id));
        const label = paneTitle(pane, t("sidebar.new"));
        return (
          <div
            key={pane.paneId}
            role="tab"
            aria-selected={isActive}
            title={label}
            onClick={() => onSelect(pane.paneId)}
            onMouseDown={(event) => {
              if (event.button === 1) event.preventDefault();
            }}
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              event.stopPropagation();
              onClose(pane.paneId);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 34,
              paddingLeft: 10,
              paddingRight: 4,
              borderRight: "1px solid var(--border)",
              background: isActive ? "var(--bg)" : "transparent",
              cursor: "pointer",
              fontSize: 12,
              color: isActive ? "var(--text)" : "var(--text-muted)",
              whiteSpace: "nowrap",
              maxWidth: 180,
              minWidth: 72,
              flexShrink: 0,
              userSelect: "none",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                flexShrink: 0,
                background: running ? "var(--accent)" : "var(--border)",
                boxShadow: running ? "0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent)" : "none",
              }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
            <button
              type="button"
              title={t("chat.closeConversation")}
              aria-label={t("chat.closeConversation")}
              onClick={(event) => {
                event.stopPropagation();
                onClose(pane.paneId);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 18,
                height: 18,
                marginLeft: 2,
                border: "none",
                borderRadius: 4,
                background: "transparent",
                color: "var(--text-muted)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
