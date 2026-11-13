"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
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
  const listRef = useRef<HTMLDivElement>(null);

  // No scrollbar (TabBar's `.tabbar-scroll`), so a vertical wheel scrolls the row sideways.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX) || list.scrollWidth <= list.clientWidth) return;
      event.preventDefault();
      list.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientWidth : 1);
    };
    list.addEventListener("wheel", onWheel, { passive: false });
    return () => list.removeEventListener("wheel", onWheel);
  }, []);

  // The current chip stays in view; only the row moves (scrollIntoView could move the page).
  useEffect(() => {
    const list = listRef.current;
    const chip = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !chip) return;
    const strip = list.getBoundingClientRect();
    const { left, right } = chip.getBoundingClientRect();
    if (left < strip.left) list.scrollLeft -= strip.left - left;
    else if (right > strip.right) list.scrollLeft += right - strip.right;
  }, [selectedSessionId, members.length]);

  // A toolbar's arrow keys: Left and Right move between chips, Home and End to the ends.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const chips = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
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
  return (
    <div
      ref={listRef}
      role="toolbar"
      aria-label={t("agentSwitcher.strip")}
      className="tabbar-scroll"
      onKeyDown={handleKeyDown}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 34,
        padding: "0 8px",
        background: "var(--bg-panel)",
        borderBottom: "1px solid var(--border)",
        overflowX: "auto",
        overflowY: "hidden",
        flexShrink: 0,
      }}
    >
      <Chip
        label={t("agentSwitcher.main")}
        title={t("agentSwitcher.backToMain")}
        current={false}
        icon={runningSessionIds.has(rootSession.id) ? <StatusIcon status="running" /> : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        )}
        running={runningSessionIds.has(rootSession.id)}
        onClick={() => onSelectSession(rootSession)}
      />
      <span aria-hidden="true" style={{ width: 1, height: 16, flexShrink: 0, background: "var(--border)" }} />
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
            icon={running ? <StatusIcon status="running" /> : <AgentKindIcon kind={side ? "side" : "subagent"} size={12} />}
            running={running}
            onClick={() => onSelectSession(session)}
          />
        );
      })}
    </div>
  );
}

function Chip({ label, title, current, icon, running, onClick }: {
  label: string;
  title: string;
  current: boolean;
  icon: ReactNode;
  running: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-current={current ? "true" : undefined}
      className={current ? "cursor-pointer" : "cursor-pointer bg-transparent hover:bg-bg-hover hover:text-text"}
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
        color: current ? "var(--text)" : "var(--text-muted)",
        fontSize: 11,
        fontWeight: current ? 600 : 500,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ display: "grid", placeItems: "center", flexShrink: 0, color: running ? "var(--accent)" : current ? "var(--accent)" : "var(--text-dim)" }}>
        {icon}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
    </button>
  );
}
