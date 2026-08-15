import { useEffect, useRef, useState } from "react";
import { ListFilter, PanelLeft, PanelRight } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { formatRelativeTime } from "@/lib/i18n/format";
import { SubagentHeaderAction } from "./SubagentSessions";

interface Props {
  title: string;
  running: boolean;
  sidebarOpen: boolean;
  modified?: string | null;
  onToggleSidebar(): void;
  onViewHistory(): void;
  historyDisabled: boolean;
  onAutoName(): void;
  autoNameDisabled: boolean;
  onOpenBranches(): void;
  onOpenSystem(): void;
  onToggleFiles(): void;
  filePanelOpen: boolean;
  subagentCount?: number;
  subagentsOpen?: boolean;
  subagentsLive?: boolean;
  onOpenSubagents?: (anchor: HTMLButtonElement) => void;
  sessionView?: "chat" | "trajectory";
  onSessionViewChange?: (view: "chat" | "trajectory") => void;
  showSessionView?: boolean;
}

export function SessionViewSwitch({
  value,
  onChange,
}: {
  value: "chat" | "trajectory";
  onChange: (view: "chat" | "trajectory") => void;
}) {
  const { t } = useI18n();
  return (
    <div className="session-view-switch" role="tablist" aria-label={t("session.view")}>
      <button
        type="button"
        role="tab"
        aria-selected={value === "chat"}
        className={value === "chat" ? "is-active" : ""}
        onClick={() => onChange("chat")}
      >
        {t("session.viewChat")}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "trajectory"}
        className={value === "trajectory" ? "is-active" : ""}
        onClick={() => onChange("trajectory")}
      >
        {t("session.viewTrajectory")}
      </button>
    </div>
  );
}

export function TaskHeader({
  title,
  running,
  sidebarOpen,
  modified,
  onToggleSidebar,
  onViewHistory,
  historyDisabled,
  onAutoName,
  autoNameDisabled,
  onOpenBranches,
  onOpenSystem,
  onToggleFiles,
  filePanelOpen,
  subagentCount = 0,
  subagentsOpen = false,
  subagentsLive = false,
  onOpenSubagents,
  sessionView = "chat",
  onSessionViewChange,
  showSessionView = false,
}: Props) {
  const { t, locale } = useI18n();
  const [actionsOpen, setActionsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!actionsOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setActionsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setActionsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [actionsOpen]);

  return (
    <header className="task-header">
      {!sidebarOpen ? (
        <button className="task-header-sidebar" onClick={onToggleSidebar} aria-label={t("sidebar.toggle")}>
          <PanelLeft size={15} aria-hidden="true" />
        </button>
      ) : null}
      <div className="task-header-copy">
        <strong>{title}</strong>
        <span>{running ? t("task.running") : t("task.ready")}{modified ? ` · ${formatRelativeTime(modified, locale)}` : ""}</span>
      </div>
      {showSessionView && onSessionViewChange ? (
        <SessionViewSwitch value={sessionView} onChange={onSessionViewChange} />
      ) : null}
      <div className="task-header-actions">
        {onOpenSubagents && subagentCount > 0 ? (
          <SubagentHeaderAction
            count={subagentCount}
            open={subagentsOpen}
            live={subagentsLive}
            onOpen={onOpenSubagents}
          />
        ) : null}
        <div className="task-header-menu-wrap" ref={menuRef}>
          <button onClick={() => setActionsOpen((open) => !open)} aria-label={t("task.actions")} aria-expanded={actionsOpen}><ListFilter size={16} aria-hidden="true" /></button>
          {actionsOpen ? (
            <div className="task-header-menu" role="menu">
              <button role="menuitem" disabled={historyDisabled} onClick={() => { setActionsOpen(false); onViewHistory(); }}>{t("history.full")}</button>
              <button role="menuitem" disabled={autoNameDisabled} onClick={() => { setActionsOpen(false); onAutoName(); }}>{t("title.generate")}</button>
              <button role="menuitem" onClick={() => { setActionsOpen(false); onOpenBranches(); }}>{t("i18n.branches")}</button>
              <button role="menuitem" onClick={() => { setActionsOpen(false); onOpenSystem(); }}>{t("system.prompt")}</button>
            </div>
          ) : null}
        </div>
        <button onClick={onToggleFiles} aria-label={t(filePanelOpen ? "files.hidePanel" : "files.showPanel")} aria-pressed={filePanelOpen}><PanelRight size={16} aria-hidden="true" /></button>
      </div>
    </header>
  );
}
