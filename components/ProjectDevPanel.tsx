"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { stripAnsi } from "@/lib/ansi";
import { controlProjectDevClient, notifyProjectDevChanged } from "@/lib/project-dev-client";
import { projectDevActive, projectDevBusy, type ProjectDevAction, type ProjectDevEvent, type ProjectDevInfo, type ProjectDevLog } from "@/lib/project-dev-types";

export function ProjectDevPanel({ cwd, process, selectionKey }: { cwd: string; process?: string; selectionKey?: number }) {
  const { t } = useI18n();
  const [info, setInfo] = useState<ProjectDevInfo | null>(null);
  const [logs, setLogs] = useState<ProjectDevLog[]>([]);
  const [filter, setFilter] = useState(process ?? "");
  useEffect(() => { setFilter(process ?? ""); }, [process, selectionKey]);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const stateRevisionRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    let source: EventSource | undefined;
    const connect = async () => {
      try {
        const response = await fetch(`/api/project-dev?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal });
        const initial = await response.json();
        if (!response.ok) throw new Error(initial.error || `HTTP ${response.status}`);
        if (controller.signal.aborted) return;
        setInfo(initial as ProjectDevInfo);
        source = new EventSource(`/api/project-dev/events?cwd=${encodeURIComponent(cwd)}`);
        source.onmessage = (message) => {
          const event = JSON.parse(message.data) as ProjectDevEvent;
          setConnected(true);
          if (event.type === "snapshot") {
            stateRevisionRef.current++;
            setInfo(event.info);
            setLogs(event.logs);
          } else if (event.type === "state") {
            stateRevisionRef.current++;
            setInfo(event.info);
            notifyProjectDevChanged();
          } else {
            setLogs((previous) => {
              const next = [...previous, event.log];
              let size = next.reduce((total, entry) => total + entry.text.length, 0);
              let start = 0;
              while (size > 256 * 1024 || next.length - start > 2000) size -= next[start++].text.length;
              return start ? next.slice(start) : next;
            });
          }
        };
        source.onerror = () => { setConnected(false); };
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
      }
    };
    void connect();
    return () => { controller.abort(); source?.close(); };
  }, [cwd]);

  useEffect(() => {
    if (followRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs, filter]);

  const control = async (action: ProjectDevAction) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const revision = stateRevisionRef.current;
    try {
      const result = await controlProjectDevClient(cwd, action, filter || undefined);
      if (stateRevisionRef.current === revision) setInfo(result);
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { pendingRef.current = false; setPending(false); notifyProjectDevChanged(); }
  };
  const selected = info?.processes.find((service) => service.name === filter);
  const status = filter ? selected?.status : info?.status;
  const runtimeError = filter ? selected?.error : info?.error;
  const busy = pending || projectDevBusy(status);
  const active = projectDevActive(status);
  const canStart = info?.found && !info.configError && (!filter || selected?.configured);
  const names = [...new Set([...(info?.processes.map((item) => item.name) ?? []), ...(filter ? [filter] : []), ...logs.map((entry) => entry.process)])];

  return (
    <section className="project-dev-panel" aria-label={t("projectDev.title")}>
      <div className="project-dev-toolbar">
        <div className="project-dev-location">
          <strong title={cwd}>{cwd}</strong>
          <span>Procfile.dev · {filter && `${filter} · `}{info ? t(`projectDev.status.${status ?? "stopped"}`) : t("projectDev.connecting")}</span>
          {!connected && <span role="status">{t("projectDev.reconnecting")}</span>}
        </div>
        <button type="button" disabled={busy || !canStart}
          aria-label={filter ? t(active ? "projectDev.restartService" : "projectDev.startService", { name: filter }) : undefined}
          onClick={() => void control(active ? "restart" : "start")}>
          {t(active ? "projectDev.restart" : "projectDev.start")}
        </button>
        <button type="button" disabled={busy || (!active && status !== "error")}
          aria-label={filter ? t("projectDev.stopService", { name: filter }) : undefined}
          onClick={() => void control("stop")}>{t("projectDev.stop")}</button>
      </div>
      {(error || info?.configError || runtimeError) && <div className="project-dev-error" role="alert">{error || info?.configError || runtimeError}</div>}
      {info && !info.found && <div className="project-dev-note">{t("projectDev.missing")}</div>}
      <div className="project-dev-filter">
        <label>{t("projectDev.process")} <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="">{t("projectDev.allProcesses")}</option>
          {names.map((name) => <option key={name} value={name}>{name}</option>)}
        </select></label>
        <span>{t("projectDev.closeHint")}</span>
      </div>
      <div className="project-dev-logs" ref={scrollRef} tabIndex={0} aria-label={t("projectDev.logs")} onScroll={(event) => {
        const element = event.currentTarget;
        followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
      }}>
        {!logs.length && <p className="project-dev-note">{t("projectDev.noLogs")}</p>}
        {logs.filter((entry) => !filter || entry.process === filter).map((entry) => (
          <div className={`project-dev-log is-${entry.stream}`} key={entry.id}>
            <span className="project-dev-log-name">[{entry.process}]</span>
            <pre>{stripAnsi(entry.text)}</pre>
          </div>
        ))}
      </div>
    </section>
  );
}
