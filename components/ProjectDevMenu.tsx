"use client";

import { useI18n } from "@/hooks/useI18n";
import { projectDevActive, projectDevBusy, type ProjectDevAction, type ProjectDevInfo } from "@/lib/project-dev-types";
import { SpinnerIcon } from "./SidebarIcons";

export function ProjectDevMenu({ info, pending, onAction, onLogs, onPointerEnter, onPointerLeave }: {
  info?: ProjectDevInfo;
  pending: boolean;
  onAction: (action: ProjectDevAction, process?: string) => void;
  onLogs: (process?: string) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="project-dev-menu" onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
      {info?.configError && <div className="project-dev-error" role="alert">{info.configError}</div>}
      <div role="menu" aria-label={t("projectDev.services")}>
        {info?.processes.map((service) => {
          const active = projectDevActive(service.status);
          const busy = pending || projectDevBusy(service.status);
          const label = t(active ? "projectDev.stopService" : "projectDev.startService", { name: service.name });
          return (
            <div className="project-dev-service" role="group" aria-label={service.name} key={service.name}>
              <button type="button" className="project-dev-service-name" role="menuitem" data-sidebar-menu-item="" tabIndex={-1}
                title={`${t("projectDev.serviceLogs", { name: service.name })} · ${t(`projectDev.status.${service.status}`)}${service.error ? `\n${service.error}` : ""}`}
                aria-label={t("projectDev.serviceLogs", { name: service.name })}
                onClick={() => onLogs(service.name)}>{service.name}</button>
              <button type="button" className={`project-dev-service-toggle${active ? " is-active" : ""}`} role="menuitem" data-sidebar-menu-item="" tabIndex={-1}
                disabled={busy || (!active && (!service.configured || Boolean(info.configError)))}
                aria-label={label} title={label} aria-busy={busy} data-status={service.status}
                onClick={() => onAction(active ? "stop" : "start", service.name)}>
                {busy ? <SpinnerIcon size={13} /> : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                    {active ? <rect x="6" y="6" width="12" height="12" rx="1" /> : <path d="m8 4 12 8-12 8z" />}
                  </svg>
                )}
              </button>
            </div>
          );
        })}
        {!info?.processes.length && <div className="project-dev-note">{t(info ? "projectDev.missing" : "projectDev.connecting")}</div>}
      </div>
    </div>
  );
}
