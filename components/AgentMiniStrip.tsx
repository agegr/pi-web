"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useHorizontalStrip } from "@/hooks/useHorizontalStrip";
import { useI18n } from "@/hooks/useI18n";
import { sideChatTitle } from "@/lib/session-family";
import type { SessionInfo } from "@/lib/types";
import { AgentKindIcon, StatusIcon, subagentTitle } from "./AgentSessionPanel";

interface Props {
  rootSession: SessionInfo;
  /** Every family member but the root, in the order the chips keep (`getAgentStripMembers()`). */
  members: readonly SessionInfo[];
  selectedSessionId: string;
  runningSessionIds: ReadonlySet<string>;
  /** What a row of the Agents switcher does on a click. */
  onSelectSession: (session: SessionInfo) => void;
}

/**
 * One row under the chat toolbar while the main chat shows a subagent or a side chat (#1658):
 * the way back to the main agent and every other member, so typing into a child never looks
 * like talking to the parent. The Agents button swaps it for the full switcher and back.
 */
export function AgentMiniStrip({ rootSession, members, selectedSessionId, runningSessionIds, onSelectSession }: Props) {
  const { t } = useI18n();
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Only the members scroll (hidden scrollbar, wheel, current chip kept in view): the way back stays put.
  const scrollerRef = useHorizontalStrip<HTMLDivElement>('[aria-current="true"]', `${members.length}\n${selectedSessionId}`);
  // Roving tab stop: one Tab stop for the row, on the chip last focused, else the current one.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const tabStopId = focusedId && (focusedId === rootSession.id || members.some((session) => session.id === focusedId))
    ? focusedId
    : selectedSessionId;

  // A toolbar's arrow keys: Left and Right move between chips, Home and End to the ends.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const chips = [...(toolbarRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const index = chips.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const next = event.key === "ArrowRight" ? Math.min(index + 1, chips.length - 1)
      : event.key === "ArrowLeft" ? Math.max(index - 1, 0)
        : event.key === "Home" ? 0
          : event.key === "End" ? chips.length - 1
            : -1;
    if (next < 0) return;
    event.preventDefault();
    chips[next].focus();
  };

  const statusText = t("agentSwitcher.status.running");
  const rootRunning = runningSessionIds.has(rootSession.id);
  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={t("agentSwitcher.strip")}
      onKeyDown={handleKeyDown}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 34,
        // The right padding sits outside the scroller, so the current chip kept in view never touches the edge.
        padding: "0 8px",
        background: "var(--bg-panel)",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}
    >
      <Chip
        label={t("agentSwitcher.main")}
        title={t("agentSwitcher.backToMain")}
        current={false}
        tabStop={tabStopId === rootSession.id}
        icon={rootRunning ? <StatusIcon status="running" /> : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        )}
        running={rootRunning}
        onFocus={() => setFocusedId(rootSession.id)}
        onClick={() => onSelectSession(rootSession)}
      />
      <span aria-hidden="true" style={{ width: 1, height: 16, flexShrink: 0, background: "var(--border)" }} />
      <div
        ref={scrollerRef}
        className="tabbar-scroll"
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 6,
          overflowX: "auto",
          overflowY: "hidden",
        }}
      >
        {members.map((session) => {
          const side = session.relation?.kind === "side";
          const relation = session.relation?.kind === "subagent" ? session.relation : null;
          const label = side ? sideChatTitle(session, t("agentSwitcher.sideChat"), members) : subagentTitle(session);
          const running = runningSessionIds.has(session.id);
          const kind = side ? t("agentSwitcher.sideChat") : relation?.profile ?? t("agentSwitcher.subagent");
          return (
            <Chip
              key={session.id}
              label={label}
              title={[label, kind, running ? statusText : null].filter(Boolean).join(" · ")}
              current={session.id === selectedSessionId}
              tabStop={tabStopId === session.id}
              icon={running ? <StatusIcon status="running" /> : <AgentKindIcon kind={side ? "side" : "subagent"} size={12} />}
              running={running}
              onFocus={() => setFocusedId(session.id)}
              onClick={() => onSelectSession(session)}
            />
          );
        })}
      </div>
    </div>
  );
}

function Chip({ label, title, current, tabStop, icon, running, onFocus, onClick }: {
  label: string;
  title: string;
  current: boolean;
  tabStop: boolean;
  icon: ReactNode;
  running: boolean;
  onFocus: () => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onFocus={onFocus}
      title={title}
      tabIndex={tabStop ? 0 : -1}
      aria-current={current ? "true" : undefined}
      // Colours as classes, so hover can win over them (an inline colour would).
      className={current ? "cursor-pointer text-text" : "cursor-pointer bg-transparent text-text-muted hover:bg-bg-hover hover:text-text"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        flexShrink: 0,
        maxWidth: 200,
        height: 24,
        padding: "0 9px",
        border: `1px solid ${current ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 12,
        background: current ? "var(--bg-selected)" : undefined,
        fontSize: 11,
        fontWeight: current ? 600 : 500,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ display: "grid", placeItems: "center", flexShrink: 0, color: running || current ? "var(--accent)" : "var(--text-dim)" }}>
        {icon}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
    </button>
  );
}
