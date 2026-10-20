"use client";

import { useI18n } from "@/hooks/useI18n";
import { projectDevActive, projectDevBusy, type ProjectDevInfo } from "@/lib/project-dev-types";
import { SpinnerIcon } from "./SidebarIcons";

export function ProjectDevButton({ info, pending, expanded, onToggle, onOpen, onLeave }: {
  info?: ProjectDevInfo;
  pending?: boolean;
  expanded?: boolean;
  onToggle: () => void;
  onOpen: (opener: HTMLElement, hover: boolean) => void;
  onLeave: () => void;
}) {
  const { t } = useI18n();
  if (!info || (!info.found && !projectDevActive(info.status) && info.status !== "error")) return null;
  const busy = pending || projectDevBusy(info.status);
  const active = projectDevActive(info.status);
  const disabled = busy || (!active && (!info.found || Boolean(info.configError)));
  const title = t(active ? "projectDev.stopAll" : "projectDev.startAll");
  return (
    <button type="button" className={`session-tree-group-action project-dev-button${active || expanded ? " is-active" : ""}${active ? " is-running" : ""}`}
      title={title} aria-label={title} aria-haspopup="dialog" aria-expanded={expanded ?? false} aria-busy={busy} aria-disabled={disabled}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse" && window.matchMedia("(hover: hover)").matches) onOpen(event.currentTarget, true);
      }}
      onPointerLeave={onLeave}
      onClick={(event) => { event.stopPropagation(); if (!disabled) onToggle(); }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onOpen(event.currentTarget, false); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); onOpen(event.currentTarget, false); }
      }}>
      {busy ? <SpinnerIcon size={13} /> : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          {active ? <rect x="6" y="6" width="12" height="12" rx="1" /> : <path d="m8 4 12 8-12 8z" />}
        </svg>
      )}
    </button>
  );
}
