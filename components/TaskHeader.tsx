import { useEffect, useRef, useState } from "react";
import { ListFilter, PanelLeft, PanelRight } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { formatRelativeTime } from "@/lib/i18n/format";

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
      <div className="task-header-actions">
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
