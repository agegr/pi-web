"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  getLastSettingsSelection,
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
import { describeToCron, isValidCron, nextCronTime, summarizeCron } from "@/lib/schedule-cron";
import {
  ConfigButton,
  ConfigDetail,
  ConfigDetailActions,
  ConfigDetailGrid,
  ConfigDetailGridRow,
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigDetailTitle,
  ConfigEmptyState,
  ConfigField,
  ConfigListAction,
  ConfigPanelShell,
  ConfigSidebar,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSplitView,
  ConfigStatusDot,
  ConfigSwitch,
} from "./SettingsUi";

/**
 * Settings › Scheduled tasks.
 *
 * Reuses the list/detail split every other Settings section uses. The list is the
 * answer to "which tasks exist"; selecting one shows its prompt, timing, history
 * and last error, and links to the session a run produced.
 */

interface ScheduledTask {
  id: string;
  prompt: string;
  cwd: string;
  cron: string;
  summary: string;
  runOnceAt: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastSessionId: string | null;
  lastError: string | null;
  runCount: number;
  model: string | null;
}

type Draft = {
  prompt: string;
  cwd: string;
  describe: string;
  cron: string;
  runOnceAt: string;
  kind: "recurring" | "once";
};

const EMPTY_DRAFT: Draft = {
  prompt: "",
  cwd: "",
  describe: "",
  cron: "30 9 * * *",
  runOnceAt: "",
  kind: "recurring",
};

function formatTime(value: string | null, never: string): string {
  if (!value) return never;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in local time, not an ISO string. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SchedulesConfig({
  cwd,
  onClose,
  onOpenSession,
  embedded = false,
}: {
  cwd?: string | null;
  onClose: () => void;
  onOpenSession?: (sessionId: string) => void;
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => getLastSettingsSelection("schedules", cwd ?? "") ,
  );
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = useMemo(
    () => tasks.find((task) => task.id === selectedId) ?? null,
    [tasks, selectedId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/schedules", { cache: "no-store" });
      const body = await response.json() as { tasks?: ScheduledTask[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setTasks(body.tasks ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // First open with tasks already present: select the first one so the detail
  // pane is never blank when there is something to show.
  useEffect(() => {
    if (selectedId || tasks.length === 0) return;
    setSelectedId(tasks[0].id);
  }, [tasks, selectedId]);

  const selectTask = useCallback((task: ScheduledTask) => {
    setCreating(false);
    setSelectedId(task.id);
    setLastSettingsSelection("schedules", cwd ?? "", task.id);
    setNotice(null);
  }, [cwd]);

  const beginCreate = useCallback(() => {
    setCreating(true);
    setSelectedId(null);
    setDraft({ ...EMPTY_DRAFT, cwd: cwd ?? "" });
    setNotice(null);
  }, [cwd]);

  const patch = useCallback(async (id: string, body: Record<string, unknown>) => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/schedules/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { task?: ScheduledTask; error?: string };
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
      if (result.task) {
        setTasks((current) => current.map((task) => (task.id === id ? result.task! : task)));
      }
      return true;
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setTasks((current) => current.filter((task) => task.id !== id));
      setSelectedId(null);
      return true;
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const runNow = useCallback(async (id: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/schedules/${encodeURIComponent(id)}`, { method: "POST" });
      const body = await response.json() as { sessionId?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setNotice(body.sessionId ? `已创建会话 ${body.sessionId.slice(0, 8)}` : t("schedules.running"));
      await load();
      return true;
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }, [load, t]);

  const submitCreate = useCallback(async () => {
    const prompt = draft.prompt.trim();
    const targetCwd = draft.cwd.trim();
    if (!prompt || !targetCwd) {
      setNotice(t("schedules.required"));
      return;
    }

    const body: Record<string, unknown> = { prompt, cwd: targetCwd };
    if (draft.kind === "once") {
      if (!draft.runOnceAt) {
        setNotice(t("schedules.badDate"));
        return;
      }
      const when = new Date(draft.runOnceAt);
      if (Number.isNaN(when.getTime())) {
        setNotice(t("schedules.badDate"));
        return;
      }
      body.runOnceAt = when.toISOString();
    } else if (draft.describe.trim()) {
      // Translate here so the browser never guesses; the server rejects what it
      // cannot understand rather than scheduling the wrong thing.
      const described = describeToCron(draft.describe);
      if (!described) {
        setNotice(t("schedules.badDescribe"));
        return;
      }
      body.cron = described.cron;
      body.summary = described.summary;
    } else {
      if (!isValidCron(draft.cron)) {
        setNotice(t("schedules.badCron"));
        return;
      }
      body.cron = draft.cron.trim();
      body.summary = summarizeCron(draft.cron.trim());
    }

    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { task?: ScheduledTask; error?: string };
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
      await load();
      if (result.task) selectTask(result.task);
      setCreating(false);
      return true;
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }, [draft, load, selectTask, t]);

  const defaultOnceAt = useMemo(
    () => toLocalInputValue(new Date(Date.now() + 10 * 60 * 1000)),
    [],
  );

  return (
    <ConfigPanelShell
      embedded={embedded}
      title={t("settings.schedules")}
      closeLabel={t("common.close")}
      onClose={onClose}
    >
      <ConfigSplitView>
        <ConfigSidebar>
          <ConfigSidebarList>
            {loading ? (
              <div style={{ padding: 10, color: "var(--text-dim)", fontSize: 12 }}>
                {t("schedules.loading")}
              </div>
            ) : tasks.length === 0 ? (
              <div style={{ padding: 10, color: "var(--text-dim)", fontSize: 12 }}>
                {t("schedules.none")}
              </div>
            ) : tasks.map((task) => (
              <ConfigSidebarItem
                key={task.id}
                active={!creating && selectedId === task.id}
                onClick={() => selectTask(task)}
              >
                <ConfigStatusDot active={task.enabled} />
                <ConfigSidebarText className={`is-grow${task.enabled ? "" : " is-muted"}`}>
                  {task.prompt.length > 40 ? `${task.prompt.slice(0, 40)}…` : task.prompt}
                </ConfigSidebarText>
              </ConfigSidebarItem>
            ))}
          </ConfigSidebarList>
          <ConfigListAction active={creating} onClick={beginCreate}>
            {t("schedules.new")}
          </ConfigListAction>
        </ConfigSidebar>

        <ConfigDetail>
          <ConfigDetailStack className="is-fill">
            {error ? (
              <ConfigEmptyState>{error}</ConfigEmptyState>
            ) : creating ? (
              <>
                <ConfigDetailHeader>
                  <ConfigDetailHeaderInfo>
                    <ConfigDetailTitle>{t("schedules.new")}</ConfigDetailTitle>
                  </ConfigDetailHeaderInfo>
                </ConfigDetailHeader>

                <ConfigField label={t("schedules.prompt")}>
                  <textarea
                    className="config-textarea"
                    rows={4}
                    value={draft.prompt}
                    placeholder={t("schedules.promptPlaceholder")}
                    onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                  />
                </ConfigField>

                <ConfigField label={t("schedules.cwd")}>
                  <input
                    className="config-input"
                    value={draft.cwd}
                    placeholder={t("schedules.cwdPlaceholder")}
                    onChange={(event) => setDraft({ ...draft, cwd: event.target.value })}
                  />
                </ConfigField>

                <ConfigField label={t("schedules.scheduleKind")}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <ConfigButton
                      variant={draft.kind === "recurring" ? "primary" : "secondary"}
                      onClick={() => setDraft({ ...draft, kind: "recurring" })}
                    >
                      {t("schedules.kindRecurring")}
                    </ConfigButton>
                    <ConfigButton
                      variant={draft.kind === "once" ? "primary" : "secondary"}
                      onClick={() => setDraft({ ...draft, kind: "once", runOnceAt: draft.runOnceAt || defaultOnceAt })}
                    >
                      {t("schedules.kindOnce")}
                    </ConfigButton>
                  </div>
                </ConfigField>

                {draft.kind === "recurring" ? (
                  <>
                    <ConfigField label={t("schedules.naturalLanguage")}>
                      <input
                        className="config-input"
                        value={draft.describe}
                        placeholder={t("schedules.naturalLanguagePlaceholder")}
                        onChange={(event) => setDraft({ ...draft, describe: event.target.value })}
                      />
                    </ConfigField>
                    <ConfigField label={t("schedules.cronExpression")}>
                      <input
                        className="config-input"
                        value={draft.cron}
                        onChange={(event) => setDraft({ ...draft, cron: event.target.value })}
                      />
                    </ConfigField>
                    <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
                      {t("schedules.cronHelp")}
                    </div>
                  </>
                ) : (
                  <ConfigField label={t("schedules.oneShotAt")}>
                    <input
                      type="datetime-local"
                      className="config-input"
                      value={draft.runOnceAt}
                      onChange={(event) => setDraft({ ...draft, runOnceAt: event.target.value })}
                    />
                  </ConfigField>
                )}
              </>
            ) : !selected ? (
              <ConfigEmptyState>{t("schedules.empty")}</ConfigEmptyState>
            ) : (
              <>
                <ConfigDetailHeader>
                  <ConfigDetailHeaderInfo>
                    <ConfigDetailTitle>{selected.summary || selected.cron}</ConfigDetailTitle>
                  </ConfigDetailHeaderInfo>
                </ConfigDetailHeader>

                <ConfigDetailGrid>
                  <ConfigDetailGridRow label={t("schedules.prompt")}>
                    <div style={{ whiteSpace: "pre-wrap" }}>{selected.prompt}</div>
                  </ConfigDetailGridRow>
                  <ConfigDetailGridRow label={t("schedules.cwd")}>
                    <code>{selected.cwd}</code>
                  </ConfigDetailGridRow>
                  <ConfigDetailGridRow label={t("schedules.scheduleKind")}>
                    {selected.runOnceAt ? t("schedules.kindOnce") : selected.cron}
                  </ConfigDetailGridRow>
                  <ConfigDetailGridRow label={t("schedules.nextRun")}>
                    {selected.enabled
                      ? formatTime(nextRunOf(selected), t("schedules.never"))
                      : "—"}
                  </ConfigDetailGridRow>
                  <ConfigDetailGridRow label={t("schedules.lastRun")}>
                    {formatTime(selected.lastRunAt, t("schedules.never"))}
                  </ConfigDetailGridRow>
                  <ConfigDetailGridRow label={t("schedules.runCount")}>
                    {selected.runCount}
                  </ConfigDetailGridRow>
                  {selected.lastSessionId && (
                    <ConfigDetailGridRow label={t("schedules.openSession")}>
                      {onOpenSession ? (
                        <ConfigButton onClick={() => onOpenSession(selected.lastSessionId!)}>
                          {selected.lastSessionId.slice(0, 8)}
                        </ConfigButton>
                      ) : (
                        <code>{selected.lastSessionId}</code>
                      )}
                    </ConfigDetailGridRow>
                  )}
                  {selected.lastError && (
                    <ConfigDetailGridRow label={t("schedules.lastError")}>
                      <span style={{ color: "var(--danger, #d33)" }}>{selected.lastError}</span>
                    </ConfigDetailGridRow>
                  )}
                </ConfigDetailGrid>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ConfigSwitch
                    checked={selected.enabled}
                    label={t("schedules.enabled")}
                    onChange={(enabled) => void patch(selected.id, { enabled })}
                  />
                  <span>{selected.enabled ? t("schedules.enabled") : t("schedules.disabled")}</span>
                </div>

                <ConfigDetailActions>
                  <ConfigButton disabled={busy} onClick={() => void runNow(selected.id)}>
                    {busy ? t("schedules.running") : t("schedules.runNow")}
                  </ConfigButton>
                  <ConfigButton disabled={busy} onClick={() => void remove(selected.id)}>
                    {t("schedules.delete")}
                  </ConfigButton>
                </ConfigDetailActions>
              </>
            )}

            {creating && (
              <ConfigDetailActions>
                <ConfigButton disabled={busy} onClick={() => void submitCreate()}>
                  {busy ? t("schedules.creating") : t("schedules.create")}
                </ConfigButton>
                <ConfigButton disabled={busy} onClick={() => { setCreating(false); setNotice(null); }}>
                  {t("common.cancel")}
                </ConfigButton>
              </ConfigDetailActions>
            )}

            {notice && (
              <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{notice}</div>
            )}
          </ConfigDetailStack>
        </ConfigDetail>
      </ConfigSplitView>
    </ConfigPanelShell>
  );
}

/**
 * The next fire time for display. Computed on the client from the stored cron so
 * the list needs no extra request; the server remains the source of truth for
 * what actually runs.
 */
function nextRunOf(task: ScheduledTask): string | null {
  if (task.runOnceAt) {
    return new Date(task.runOnceAt) > new Date() ? task.runOnceAt : null;
  }
  if (!isValidCron(task.cron)) return null;
  const next = nextCronTime(task.cron);
  return next ? next.toISOString() : null;
}
