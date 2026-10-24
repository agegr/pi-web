"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ScheduledPromptsResponse } from "@/lib/api-types";
import { sendAgentCommand } from "@/lib/agent-client";
import { shortenPath } from "@/lib/display-path";
import { ConfigButton, ConfigEmptyState, ConfigPanelShell, ConfigSwitch } from "./SettingsUi";

interface Props {
  embedded?: boolean;
  sessionId?: string | null;
  onClose: () => void;
  onReloaded?: () => void;
}

const REFRESH_MS = 5000;

async function request(method: "GET" | "PUT" | "DELETE", body?: unknown): Promise<ScheduledPromptsResponse> {
  const response = await fetch("/api/scheduled-prompts", {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json() as Partial<ScheduledPromptsResponse> & { error?: string };
  if (!response.ok || data.error || typeof data.enabled !== "boolean" || !Array.isArray(data.jobs)) {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return { enabled: data.enabled, jobs: data.jobs };
}

function formatTime(iso: string | undefined): string {
  if (!iso) return "–";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function ScheduledPromptsConfig({ embedded, sessionId, onClose, onReloaded }: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<ScheduledPromptsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reloadNeeded, setReloadNeeded] = useState(false);
  const [reloading, setReloading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await request("GET"));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const toggle = async (enabled: boolean) => {
    setSaving(true);
    setError(null);
    try {
      setData(await request("PUT", { enabled }));
      setReloadNeeded(Boolean(sessionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (cwd: string, jobId: string) => {
    setCancelling(`${cwd}\n${jobId}`);
    setError(null);
    try {
      setData(await request("DELETE", { cwd, jobId }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      void refresh();
    } finally {
      setCancelling(null);
    }
  };

  const reloadSession = async () => {
    if (!sessionId) return;
    setReloading(true);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      setReloadNeeded(false);
      onReloaded?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReloading(false);
    }
  };

  const enabled = data?.enabled ?? false;

  return (
    <ConfigPanelShell embedded={embedded ?? false} title={t("schedule.title")} closeLabel={t("i18n.close")} onClose={onClose}>
      <div className="agents-feature-setting">
        <div className="agents-feature-copy">
          <strong>{t("schedule.enableTitle")}</strong>
          <span>{t("schedule.enableDescription")}</span>
          {reloadNeeded && <span role="status" className="agents-feature-reload-notice">{t("schedule.reloadRequired")}</span>}
          {error && <span role="alert" className="agents-feature-reload-notice">{error}</span>}
        </div>
        <div className="agents-feature-actions">
          {reloadNeeded && sessionId && (
            <ConfigButton size="small" onClick={() => void reloadSession()} disabled={reloading || saving}>
              {reloading ? t("agents.reloading") : t("agents.reloadSession")}
            </ConfigButton>
          )}
          <ConfigSwitch
            checked={enabled}
            disabled={data === null || reloading}
            loading={saving}
            label={t("schedule.enableTitle")}
            onChange={(next) => void toggle(next)}
          />
        </div>
      </div>
      <div className="schedule-jobs">
        <strong className="schedule-jobs-title">{t("schedule.active")}</strong>
        {data === null ? (
          <ConfigEmptyState>{t("schedule.loading")}</ConfigEmptyState>
        ) : !enabled ? (
          <ConfigEmptyState>{t("schedule.disabledNotice")}</ConfigEmptyState>
        ) : data.jobs.length === 0 ? (
          <ConfigEmptyState>{t("schedule.empty")}</ConfigEmptyState>
        ) : (
          <ul className="schedule-job-list">
            {data.jobs.map((job) => {
              const key = `${job.cwd}\n${job.id}`;
              return (
                <li key={key} className="schedule-job">
                  <div className="schedule-job-main">
                    <div className="schedule-job-heading">
                      <strong>{job.name}</strong>
                      <code>{job.scheduleText}</code>
                    </div>
                    <div className="schedule-job-prompt" title={job.prompt}>{job.prompt}</div>
                    <div className="schedule-job-meta">
                      <span title={job.cwd}>{shortenPath(job.cwd)}</span>
                      <span>{job.boundToSession ? t("schedule.scopeSession") : t("schedule.scopeWorkdir")}</span>
                      <span>{t("schedule.nextRun")}: {formatTime(job.nextRun)}</span>
                      <span>{t("schedule.lastRun")}: {formatTime(job.lastRun)}</span>
                      <span>{t("schedule.runs")}: {job.runCount}</span>
                    </div>
                  </div>
                  <ConfigButton
                    size="small"
                    variant="danger"
                    aria-label={t("schedule.cancelLabel", { name: job.name })}
                    disabled={cancelling === key}
                    onClick={() => void cancel(job.cwd, job.id)}
                  >
                    {cancelling === key ? t("schedule.cancelling") : t("schedule.cancel")}
                  </ConfigButton>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ConfigPanelShell>
  );
}
