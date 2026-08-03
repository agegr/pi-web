"use client";

// EngineDashboard —— 自主编程引擎统一监控面板（FR-1 / FR-2）
// 单一状态源：经 hooks/useEngineRuntime 订阅 /api/engine/stream 通知 → 拉取 /api/engine/state，
// 写入 engine-runtime-store，组件按切片渲染；不再存在平行状态面（消除 useUnifiedEngine）。
// 三看板：进程监控 / 需求生命周期 / 任务状态；下方为选中运行的 per-run 详情（阶段/任务/控制/日志）。

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useEngineRuntime } from "@/hooks/useEngineRuntime";
import { StageStepper } from "./StageStepper";
import { PlanTaskCard } from "./PlanTaskCard";
import { TerminalPanel } from "./TerminalPanel";
import { ProcessTree } from "./ProcessTree";
import { Skeleton } from "./Skeleton";
import { useI18n } from "@/hooks/useI18n";
import { getPanelController } from "@/lib/panel-controller";
import { stripAnsi } from "@/lib/ansi";
import type { RunState } from "@/lib/unified-engine/unified-engine-types";
import type {
  EngineProcess,
  RequirementLifecycle,
  RequirementNode,
  TaskStatusSummary,
} from "@/lib/engine-runtime-store";

/** 原生 fetch 封装（HEAD 已移除 csrf header），统一失败兜底，不抛未捕获异常。 */
async function engineFetchJson<T = unknown>(
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  let data: T = undefined as unknown as T;
  try {
    data = (await res.json()) as T;
  } catch {
    /* 空响应或非法 JSON 时 data 保持 undefined */
  }
  return { ok: res.ok, status: res.status, data };
}

/** 把引擎日志的 ISO 时间戳（UTC）转为本地时区 HH:MM:SS 显示。 */
function formatLogTime(at: unknown): string {
  const s = String(at ?? "");
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s.slice(11, 19)
    : d.toLocaleTimeString("zh-CN", { hour12: false });
}

const STATUS_COLOR: Record<RunState["status"], string> = {
  completed: "#22C55E",
  failed: "#EF4444",
  running: "var(--accent)",
  paused: "#F59E0B",
  idle: "var(--text-dim)",
};

const LIFECYCLE_LABEL: Record<RequirementLifecycle, string> = {
  received: "engine.lifecycle.received",
  discussing: "engine.lifecycle.discussing",
  converged: "engine.lifecycle.converged",
  executing: "engine.lifecycle.executing",
  delivered: "engine.lifecycle.delivered",
};

const LIFECYCLE_COLOR: Record<RequirementLifecycle, string> = {
  received: "var(--text-dim)",
  discussing: "#0ea5e9",
  converged: "#8b5cf6",
  executing: "var(--accent)",
  delivered: "#22C55E",
};

const dashboardInputStyle: CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 10px",
  color: "var(--text)",
  fontSize: 13,
  minWidth: 160,
};
const dashboardBtnStyle: CSSProperties = {
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const dashboardBtnStyleGhost: CSSProperties = {
  background: "transparent",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  cursor: "pointer",
};

function StatusBadge({ status }: { status: RunState["status"] }) {
  const { t } = useI18n();
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLOR[status] }}>
      {t(`engine.run.${status}`)}
    </span>
  );
}

/** 通道计数卡：pending/running/completed/failed/skipped。 */
function TaskStatusBoard({ taskStatus }: { taskStatus: TaskStatusSummary }) {
  const { t } = useI18n();
  const cards: Array<{ key: keyof TaskStatusSummary; label: string; color: string }> = [
    { key: "pending", label: "engine.task.pending", color: "var(--text-dim)" },
    { key: "running", label: "engine.task.running", color: "var(--accent)" },
    { key: "completed", label: "engine.task.completed", color: "#22C55E" },
    { key: "failed", label: "engine.task.failed", color: "#EF4444" },
    { key: "skipped", label: "engine.task.skipped", color: "#F59E0B" },
  ];
  return (
    <div style={boardStyle}>
      <div style={boardTitleStyle}>{t("engine.taskStatus")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        {cards.map((c) => (
          <div
            key={c.key}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "6px 8px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span style={{ fontSize: 18, fontWeight: 700, color: c.color }}>
              {taskStatus[c.key]}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t(c.label)}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
        {t("engine.tasks")}：{taskStatus.total}
      </div>
    </div>
  );
}

function ProcessMonitor({
  processes,
  selectedRunId,
  onSelect,
}: {
  processes: EngineProcess[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div style={boardStyle}>
      <div style={boardTitleStyle}>{t("engine.processMonitor")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>
        {processes.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("engine.emptyList")}</div>
        )}
        {processes.map((p) => {
          const active = p.id === selectedRunId;
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              style={{
                textAlign: "left",
                cursor: "pointer",
                border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 10,
                padding: "8px 10px",
                background: active
                  ? "color-mix(in srgb, var(--accent) 16%, transparent)"
                  : "transparent",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{p.title}</span>
              <span style={{ fontSize: 11, color: STATUS_COLOR[p.status] }}>
                {t(`engine.run.${p.status}`)} · {t(`engine.stage.${p.stage}`)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RequirementLifecycleBoard({
  nodes,
  runs,
  onSelectRun,
}: {
  nodes: RequirementNode[];
  runs: RunState[];
  onSelectRun: (runId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div style={boardStyle}>
      <div style={boardTitleStyle}>{t("engine.requirementLifecycle")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>
        {nodes.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("engine.emptyList")}</div>
        )}
        {nodes.map((n) => {
          const linkedRun = runs.find((r) => r.requirementId === n.id);
          return (
            <button
              key={n.id}
              onClick={() => linkedRun && onSelectRun(linkedRun.runId)}
              disabled={!linkedRun}
              style={{
                textAlign: "left",
                cursor: linkedRun ? "pointer" : "default",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "8px 10px",
                background: "transparent",
                display: "flex",
                flexDirection: "column",
                gap: 2,
                opacity: linkedRun ? 1 : 0.7,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{n.title}</span>
              <span style={{ fontSize: 11, color: LIFECYCLE_COLOR[n.lifecycle] }}>
                {t(LIFECYCLE_LABEL[n.lifecycle])}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const boardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minHeight: 0,
};
const boardTitleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text)",
};

export function EngineDashboard() {
  const { t } = useI18n();
  const {
    runs,
    processes,
    requirementLifecycle,
    taskStatus,
    autoplan,
    connected,
    phase,
    terminals,
    processTree,
    guardStatus,
  } = useEngineRuntime();

  // 引擎完成/出错且用户不在引擎 tab 时，侧栏 tab 亮徽标。
  const prevPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (prev === null || prev === phase) return;
    if (phase !== "done" && phase !== "error") return;
    if (getPanelController().getPanelSnapshot().activeId === "engine") return;
    getPanelController().bumpBadge("engine");
  }, [phase]);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [cwd, setCwd] = useState("");
  const [loading, setLoading] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = runs.find((r) => r.runId === selectedRunId) ?? null;

  const isRunning = selected?.status === "running";
  const isPaused = selected?.status === "paused";
  const disableStart = !selected || isRunning || controlling || selected.status === "completed";
  const disablePause = !selected || !isRunning || controlling;
  const disableResume = !selected || !isPaused || controlling;

  const total = selected?.tasks.length ?? 0;
  const done =
    selected?.tasks.filter((tk) => tk.status === "completed" || tk.status === "skipped").length ??
    0;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  const [boardTab, setBoardTab] = useState<"process" | "requirement" | "task">("process");
  const [showLog, setShowLog] = useState(false);
  const [engineLogs, setEngineLogs] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    if (!showLog || !selectedRunId) return;
    let cancelled = false;
    engineFetchJson<{ logs: Array<Record<string, unknown>> }>(
      `/api/engine/log?scope=engine&limit=500`,
      {
        method: "GET",
      },
    )
      .then(({ data }) => {
        if (cancelled) return;
        const all = data.logs ?? [];
        setEngineLogs(
          all.filter(
            (l) => ((l.meta as Record<string, unknown> | undefined)?.runId ?? "") === selectedRunId,
          ),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showLog, selectedRunId]);

  const createChange = async () => {
    if (!title.trim() || !cwd.trim()) {
      setError(t("engine.cwdRequired"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { ok, status, data } = await engineFetchJson<RunState & { error?: string }>(
        "/api/engine/changes",
        { method: "POST", body: { title: title.trim(), description: "", cwd: cwd.trim() } },
      );
      if (!ok || data.error) throw new Error(data.error ?? `创建失败：${status}`);
      setSelectedRunId(data.runId);
      setTitle("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const controlRun = async (runId: string, action: "start" | "pause" | "resume") => {
    setError(null);
    setControlling(true);
    try {
      const { ok, status, data } = await engineFetchJson<RunState & { error?: string }>(
        "/api/engine/runs",
        { method: "POST", body: { runId, action } },
      );
      if (!ok || data.error) throw new Error(data.error ?? `操作失败：${status}`);
      // 后端 emit → SSE → 拉取 store；此处不本地乐观更新，避免与统一状态面分歧。
      setSelectedRunId(data.runId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setControlling(false);
    }
  };

  const boards = (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
      {boardTab === "process" && (
        <ProcessMonitor
          processes={processes}
          selectedRunId={selectedRunId}
          onSelect={setSelectedRunId}
        />
      )}
      {boardTab === "requirement" && (
        <RequirementLifecycleBoard
          nodes={requirementLifecycle}
          runs={runs}
          onSelectRun={setSelectedRunId}
        />
      )}
      {boardTab === "task" && <TaskStatusBoard taskStatus={taskStatus} />}
    </div>
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 14,
        color: "var(--text)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("engine.newTitle")}
          style={dashboardInputStyle}
        />
        <input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder={t("engine.cwd")}
          style={dashboardInputStyle}
        />
        <button onClick={createChange} disabled={loading} style={dashboardBtnStyle}>
          {t("engine.create")}
        </button>
        <span
          title={connected ? t("engine.connected") : t("engine.disconnected")}
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            color: connected ? "#22C55E" : "#F59E0B",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            cursor: "default",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: connected ? "#22C55E" : "#F59E0B",
              animation: connected ? "none" : "enginePulse 1.4s ease-in-out infinite",
            }}
          />
          {connected ? t("engine.connected") : t("engine.disconnected")}
        </span>
        {autoplan.ready && (
          <span
            style={{
              fontSize: 11,
              padding: "3px 8px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              color: "var(--text-dim)",
            }}
          >
            autoplan · {autoplan.features.join("/") || "—"}
          </span>
        )}
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t(`engine.phase.${phase}`)}</span>
        {error && <span style={{ color: "#EF4444", fontSize: 12 }}>{error}</span>}
      </div>

      <div style={{ display: "flex", gap: 4 }}>
        {(
          [
            { id: "process", label: t("engine.processMonitor") },
            { id: "requirement", label: t("engine.requirementLifecycle") },
            { id: "task", label: t("engine.taskStatus") },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setBoardTab(tab.id)}
            style={{
              padding: "4px 10px",
              borderRadius: 7,
              border: `1px solid ${boardTab === tab.id ? "var(--accent)" : "var(--border)"}`,
              background: boardTab === tab.id ? "var(--accent-bg)" : "none",
              color: boardTab === tab.id ? "var(--accent)" : "var(--text-muted)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {boards}

      {selected && (
        <div style={{ display: "flex", gap: 12, minHeight: 0 }}>
          <div style={{ flex: 2, minHeight: 0, display: "flex" }}>
            <TerminalPanel terminals={terminals} runId={selectedRunId} />
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
            <ProcessTree processTree={processTree} />
          </div>
        </div>
      )}

      {selected && guardStatus.length > 0 && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "8px 12px",
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
            {t("engine.guardStatus")}
          </span>
          {guardStatus.slice(-4).map((g, i) => (
            <span
              key={i}
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                color: g.passed ? "#22C55E" : "#EF4444",
              }}
            >
              {g.phase} {g.passed ? "✓" : "✗"} {g.message ? `· ${g.message.slice(0, 40)}` : ""}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
          {selected ? (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <StageStepper current={selected.stage} running={isRunning} />
                <StatusBadge status={selected.status} />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  onClick={() => controlRun(selected.runId, "start")}
                  disabled={disableStart}
                  style={{
                    ...dashboardBtnStyle,
                    opacity: disableStart ? 0.5 : 1,
                    cursor: disableStart ? "not-allowed" : "pointer",
                  }}
                >
                  {t("engine.start")}
                </button>
                <button
                  onClick={() => controlRun(selected.runId, "pause")}
                  disabled={disablePause}
                  style={{
                    ...dashboardBtnStyleGhost,
                    opacity: disablePause ? 0.5 : 1,
                    cursor: disablePause ? "not-allowed" : "pointer",
                  }}
                >
                  {t("engine.pause")}
                </button>
                <button
                  onClick={() => controlRun(selected.runId, "resume")}
                  disabled={disableResume}
                  style={{
                    ...dashboardBtnStyleGhost,
                    opacity: disableResume ? 0.5 : 1,
                    cursor: disableResume ? "not-allowed" : "pointer",
                  }}
                >
                  {t("engine.resume")}
                </button>
                {controlling && (
                  <span style={{ fontSize: 11, color: "var(--accent)" }}>
                    {t("engine.controlling")}
                  </span>
                )}
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {selected.changeName}
                </span>
              </div>

              {selected.status === "failed" && (
                <div
                  style={{
                    background: "color-mix(in srgb, #EF4444 14%, transparent)",
                    border: "1px solid var(--color-error-soft)",
                    color: "#EF4444",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {t("engine.failedBanner")}：{selected.title}
                </div>
              )}

              {total > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11,
                      color: "var(--text-dim)",
                    }}
                  >
                    <span>{t("engine.progress")}</span>
                    <span>
                      {done}/{total} · {progress}%
                    </span>
                  </div>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 6,
                      background: "var(--bg-hover)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${progress}%`,
                        background: "linear-gradient(90deg, #3b82f6, #22c55e)",
                        borderRadius: 6,
                        transition: "width .3s ease",
                      }}
                    />
                  </div>
                </div>
              )}

              <div style={{ fontSize: 13, fontWeight: 600 }}>{t("engine.tasks")}</div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  overflowY: "auto",
                  minHeight: 0,
                  paddingRight: 4,
                }}
              >
                {selected.tasks.map((task) => (
                  <PlanTaskCard key={task.id} task={task} />
                ))}
                {selected.tasks.length === 0 && selected.status === "running" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div
                        key={i}
                        style={{
                          background: "var(--bg-panel)",
                          border: "1px solid var(--border)",
                          borderRadius: 12,
                          padding: "10px 12px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <Skeleton width="60%" height={14} radius={4} />
                        <Skeleton width="100%" height={12} radius={4} />
                        <Skeleton width="80%" height={12} radius={4} />
                      </div>
                    ))}
                  </div>
                )}
                {selected.tasks.length === 0 && selected.status !== "running" && (
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                    {t("engine.noTasks")}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-dim)",
                fontSize: 14,
              }}
            >
              {t("engine.empty")}
            </div>
          )}
        </div>

        <div style={{ width: 280, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => setShowLog(false)}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: !showLog
                  ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                  : "none",
                color: !showLog ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              {t("engine.live")}
            </button>
            <button
              onClick={() => setShowLog(true)}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: showLog ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "none",
                color: showLog ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              {t("engine.logView")}
            </button>
          </div>
          <div
            style={{
              overflowY: "auto",
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {showLog ? (
              engineLogs.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("engine.emptyLog")}</div>
              ) : (
                engineLogs.map((l, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 11,
                      color: "var(--text-dim)",
                      borderLeft: "2px solid var(--border)",
                      paddingLeft: 8,
                      lineHeight: 1.4,
                    }}
                  >
                    <span style={{ color: "#64748b" }}>{formatLogTime(l.at)}</span>{" "}
                    <span style={{ color: "var(--text)" }}>
                      {stripAnsi(String(l.message ?? ""))}
                    </span>
                  </div>
                ))
              )
            ) : (
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("engine.liveHint")}</div>
            )}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{t("engine.persistedHint")}</div>
        </div>
      </div>
    </div>
  );
}
