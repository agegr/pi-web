// PlanPanel —— 多 Agent 协同讨论的前端载体
// 负责：发起讨论（需求输入）→ 实时讨论时间线（SSE）→ 多套推荐方案选择/修改/退回
// → 确认交接自主编程引擎。所有状态来自编排器快照（lib/agent-orchestrator）。

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useI18n } from "@/hooks/useI18n";

// HEAD 已移除 csrf header；用原生 fetch 封装（与 PromptsConfig 同范式）。
// 返回 { ok, data, status }，调用方据此判断成功与读取 data。
async function planFetchJson<T = unknown>(
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
    /* 空响应或非 JSON */
  }
  return { ok: res.ok, status: res.status, data };
}
import {
  usePlanMode,
  getPlanModeStore,
  setPlanMode,
  setOrchestratorId,
  setPlanStatus,
  setPlanConfig,
  stashResumable,
  resumeOrchestrator,
  discardResumable,
  requestOpenEngine as setRequestOpenEngine,
  type PlanConfigSlice,
  type ControllerMode,
} from "@/lib/plan-mode-store";
import type { OrchestrationSnapshot, RecommendationPlan } from "@/lib/agent-orchestrator";
import { PlanMarkdownBody } from "./PlanMarkdownBody";
import { SkeletonLines } from "./Skeleton";

const COLOR_DOT: Record<string, string> = {
  sky: "background:#0ea5e9",
  violet: "background:#8b5cf6",
  blue: "background:#3b82f6",
  emerald: "background:#10b981",
  teal: "background:#14b8a6",
  amber: "background:#f59e0b",
  rose: "background:#f43f5e",
  cyan: "background:#06b6d4",
  fuchsia: "background:#d946ef",
  orange: "background:#f97316",
  lime: "background:#84cc16",
  slate: "background:#64748b",
  indigo: "background:#6366f1",
};
function dot(color: string): CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: "50%",
    display: "inline-block",
    ...(COLOR_DOT[color] ? { background: COLOR_DOT[color] } : { background: "#64748b" }),
  };
}

const STATUS_LABEL: Record<string, string> = {
  idle: "idle",
  parsing: "plan.parsing",
  discussing: "plan.discussing",
  synthesizing: "plan.synthesizing",
  awaiting_confirm: "plan.awaitingConfirm",
  executing: "plan.executing",
  done: "plan.done",
  failed: "plan.failed",
  cancelled: "plan.cancelled",
};

/** 非终态：刷新/重启后应提供恢复入口的编排器状态 */
const NON_TERMINAL_STATUSES = new Set([
  "parsing",
  "discussing",
  "synthesizing",
  "awaiting_confirm",
  "awaiting_clarify",
  "executing",
]);

/** 终态：到达后停止 SSE 重连与对账轮询，避免 404 风暴。 */
const TERMINAL_STATUSES = new Set(["done", "failed", "cancelled"]);

/** 对账轮询间隔，与 useAgentSession 的 AGENT_STATE_RECONCILE_MS 对齐。 */
const PLAN_RECONCILE_MS = 15_000;
/** SSE CLOSED 后手动重连的延迟（与 useAgentSession 一致）。 */
const PLAN_RECONNECT_DELAY_MS = 1000;

export function PlanPanel() {
  const { t } = useI18n();
  const { orchestratorId, resumableOrchestratorId, planConfig } = usePlanMode();
  const [snapshot, setSnapshot] = useState<OrchestrationSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 普通模式确认后展示方案文档落盘路径（引擎模式直接跳转引擎面板，无需此提示）。
  const [docSavedPath, setDocSavedPath] = useState<string | null>(null);
  // Tab 切换：讨论结束后(awaiting_confirm+)用户可在「推荐方案」与「讨论时间线」间切换，
  // 完整保留并展示历史讨论过程。讨论中只显示时间线（无 tab）。默认 plans。
  const [activeTab, setActiveTab] = useState<"plans" | "discussion">("plans");
  const esRef = useRef<EventSource | null>(null);
  // 跟踪当前编排器状态：终态后停止 SSE 重连与对账，避免 404 风暴。
  const statusRef = useRef<string>("idle");
  // SSE CLOSED 后的手动重连定时器（EventSource 终态关闭后不会自动重连）。
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 对账轮询定时器 + 活跃编排器 id 快照（防闭包陈旧）。
  const reconcileTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 配置区 / 角色模型 / 日志 / 历史 相关状态
  const [modelOptions, setModelOptions] = useState<
    Array<{ id: string; name: string; provider: string }>
  >([]);
  const [roles, setRoles] = useState<Array<{ id: string; name: string; modelId: string | null }>>(
    [],
  );
  const [roleModels, setRoleModels] = useState<Record<string, string>>({});
  const [showConfig, setShowConfig] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  // 持久化历史中处于非终态的编排（刷新/重启后恢复入口）
  const [unfinishedHistory, setUnfinishedHistory] = useState<Array<Record<string, unknown>>>([]);

  // 加载可选模型、角色库、当前角色→模型映射（配置区与角色模型下拉）。
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => setModelOptions(d.modelList ?? []))
      .catch(() => {});
    fetch("/api/plan/roles")
      .then((r) => r.json())
      .then((d) => setRoles(d.roles ?? []))
      .catch(() => {});
    fetch("/api/plan/config")
      .then((r) => r.json())
      .then((d) => setRoleModels(d.map ?? {}))
      .catch(() => {});
  }, []);

  // 保存某角色的底层模型（持久化到 /api/plan/config）。
  const setRoleModel = useCallback(
    async (roleId: string, modelId: string) => {
      const next = { ...roleModels, [roleId]: modelId };
      setRoleModels(next);
      try {
        await planFetchJson("/api/plan/config", {
          method: "PUT",
          body: { map: next },
        });
      } catch {
        /* ignore */
      }
    },
    [roleModels],
  );

  const loadLog = useCallback(async () => {
    if (!orchestratorId) return;
    try {
      const { data: d } = await planFetchJson<{ logs?: Array<Record<string, unknown>> }>(
        `/api/plan/${orchestratorId}/log?limit=200`,
      );
      setLogs(d.logs ?? []);
    } catch {
      /* ignore */
    }
  }, [orchestratorId]);

  const loadHistory = useCallback(async () => {
    try {
      const { data: d } = await planFetchJson<{ orchestrations?: Array<Record<string, unknown>> }>(
        "/api/plan/history",
      );
      setHistory(d.orchestrations ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  // 展开日志/历史视图时拉取并定期刷新日志。
  useEffect(() => {
    if (!showLog || !orchestratorId) return;
    void loadLog();
    void loadHistory();
    const timer = setInterval(() => void loadLog(), 4000);
    return () => clearInterval(timer);
  }, [showLog, orchestratorId, loadLog, loadHistory]);

  // 引导界面挂载时自动拉取服务端持久化历史，把非终态的编排讨论展示为恢复入口。
  // 解决刷新/重启后 plan-mode store 清零导致用户找不到之前进行中讨论的问题。
  useEffect(() => {
    if (orchestratorId) {
      // 已有活跃编排器，不需要引导界面的历史卡片。
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: d } = await planFetchJson<{
          orchestrations?: Array<Record<string, unknown>>;
        }>("/api/plan/history");
        if (cancelled) return;
        const items = (d.orchestrations ?? [])
          .filter((h) => NON_TERMINAL_STATUSES.has(String(h.status)))
          // 排除当前 resumableOrchestratorId（二者是同一个讨论时避免重复卡片）
          .filter((h) => String(h.id) !== getPlanModeStore().getState().resumableOrchestratorId);
        setUnfinishedHistory(items);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orchestratorId]);

  const refresh = useCallback(async (id: string) => {
    try {
      const { ok, data: snap } = await planFetchJson<OrchestrationSnapshot>(`/api/plan/${id}`, {
        method: "GET",
      });
      if (ok) {
        setSnapshot(snap);
        setPlanStatus(snap.status);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // SSE：连接事件流，按事件刷新快照并把状态同步到 store（供输入框判断交互方式）。
  // 复刻 useAgentSession 的成熟防御机制：
  //   - readyState===CLOSED 手动重连（EventSource 终态关闭后不自动重连）
  //   - 15s 对账轮询兜底漏事件（静默流式期间断连后 agent_end 不重发）
  //   - visibilitychange/online 触发即时对账
  // 终态后停止所有重连与对账，避免对已结束编排器触发 404。
  useEffect(() => {
    if (!orchestratorId) {
      setSnapshot(null);
      statusRef.current = "idle";
      return;
    }

    let disposed = false;
    // 用闭包内 id 避免依赖数组引入 orchestratorId 后的竞态（cleanup 会处理切换）。
    const id = orchestratorId;
    // 切换到新编排器时重置状态守卫：否则上一个讨论若已终态（statusRef="done"），
    // connect() 的终态守卫会直接 return，导致新讨论永远无法建立 SSE 连接。
    statusRef.current = "idle";

    const connect = () => {
      if (disposed) return;
      // 终态后不再重连。
      if (TERMINAL_STATUSES.has(statusRef.current)) return;
      // 关闭旧连接再建新连接，避免泄漏。
      esRef.current?.close();
      const es = new EventSource(`/api/plan/${id}/events`);
      esRef.current = es;
      es.onmessage = (ev) => {
        try {
          const e = JSON.parse(ev.data) as { type: string; snapshot?: OrchestrationSnapshot };
          if (e.type === "snapshot" && e.snapshot) {
            statusRef.current = e.snapshot.status;
            setSnapshot(e.snapshot);
            setPlanStatus(e.snapshot.status);
          } else if (e.type === "done" && e.snapshot) {
            // done 事件携带完整快照，直接更新避免再发一次 GET。
            statusRef.current = e.snapshot.status;
            setSnapshot(e.snapshot);
            setPlanStatus(e.snapshot.status);
          } else {
            void refresh(id);
          }
        } catch {
          /* ignore malformed */
        }
      };
      es.onerror = () => {
        // EventSource 在 CONNECTING 状态会自动重连；仅在 CLOSED（服务端关闭流）
        // 时手动重连。终态后服务端会 close 流并可能在重连时返回 404，故终态不重连。
        if (es.readyState === EventSource.CLOSED && !TERMINAL_STATUSES.has(statusRef.current)) {
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            if (!disposed && !TERMINAL_STATUSES.has(statusRef.current)) connect();
          }, PLAN_RECONNECT_DELAY_MS);
        }
      };
    };

    connect();

    // 15s 对账轮询：静默流式期间 SSE 可能断连且 agent_end 不重发，
    // 定期 GET /api/plan/[id] 兜底拉取最新快照。refresh 内已 setSnapshot，幂等。
    reconcileTimerRef.current = setInterval(() => {
      if (!disposed && !TERMINAL_STATUSES.has(statusRef.current)) {
        void refresh(id);
      }
    }, PLAN_RECONCILE_MS);

    // 标签页重新可见 / 网络恢复时立即对账。
    const onVisible = () => {
      if (document.visibilityState === "visible" && !disposed) {
        void refresh(id);
      }
    };
    const onOnline = () => {
      if (!disposed) void refresh(id);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    return () => {
      disposed = true;
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (reconcileTimerRef.current) {
        clearInterval(reconcileTimerRef.current);
        reconcileTimerRef.current = null;
      }
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [orchestratorId, refresh]);

  const selectPlan = useCallback(
    async (planId: string) => {
      if (!orchestratorId) return;
      setSnapshot((s) => (s ? { ...s, selectedPlanId: planId } : s));
      try {
        await planFetchJson(`/api/plan/${orchestratorId}/select`, {
          method: "POST",
          body: { planId },
        });
      } catch {
        /* ignore */
      }
    },
    [orchestratorId],
  );

  const confirmPlan = useCallback(
    async (planId: string | undefined, mode: "engine" | "plan") => {
      if (!orchestratorId || busy) return;
      setBusy(true);
      setError(null);
      try {
        const { ok, data } = await planFetchJson<{ error?: string; docPath?: string | null }>(
          `/api/plan/${orchestratorId}/confirm`,
          { method: "POST", body: { planId, mode } },
        );
        if (!ok) throw new Error(data.error ?? "确认失败");
        // 讨论已确认，清空编排器状态以便下次以干净状态进入。
        // 同时清空可恢复 id —— 成功结束的讨论不应再出现在恢复入口。
        setOrchestratorId(null);
        discardResumable();
        setPlanStatus("idle");
        setPlanMode(false); // 关闭计划模式，回到普通聊天
        if (mode === "engine") {
          // 引擎模式：AppShell 打开引擎面板，观察自主编程循环。
          setRequestOpenEngine(true);
        } else {
          // 普通模式：不进引擎。方案文档已落盘，提示用户路径。
          if (data.docPath) {
            setDocSavedPath(data.docPath);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [orchestratorId, busy],
  );

  // 退出计划模式 → 回到普通聊天模式。若存在未完成讨论，把编排器 id 暂存到
  // resumableOrchestratorId，再次进入时由引导界面显式选择「继续」或「新建」。
  // stashResumable 无参：内部读 store.orchestratorId，消除闭包陈旧风险。
  const exitPlan = useCallback(() => {
    stashResumable();
    setPlanMode(false);
  }, []);
  // 新建讨论：清空当前编排器与状态，回到需求输入界面（状态由输入框统一录入）。
  const newDiscussion = useCallback(() => {
    setOrchestratorId(null);
    discardResumable();
    setPlanStatus("idle");
    setSnapshot(null);
    setError(null);
  }, []);
  // 继续上次未完成的讨论：把暂存的编排器 id 移回 orchestratorId，触发 SSE 重连。
  const resumeDiscussion = useCallback(() => {
    resumeOrchestrator();
  }, []);
  // 放弃暂存的可恢复讨论，回到新建状态（引导界面「放弃并新建」入口）。
  const discardResumableDiscussion = useCallback(() => {
    discardResumable();
  }, []);

  // 计划模式下始终可见的头部工具条：标题 + 退出按钮，确保任何状态都能退回普通模式。
  const modeHeader = (extra?: ReactNode) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{t("plan.mode")}</span>
      {extra}
      <button onClick={exitPlan} style={closeBtnStyle} title={t("plan.exit")}>
        ✕
      </button>
    </div>
  );

  // 尚未发起讨论：输入框已在底部统一接管需求录入，这里仅给出引导提示。
  if (!orchestratorId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {modeHeader(
          <button
            onClick={() => setShowConfig((v) => !v)}
            style={{
              marginLeft: "auto",
              padding: "4px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: showConfig
                ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                : "none",
              color: "var(--text-muted)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {t("plan.config")}
          </button>,
        )}
        {showConfig && (
          <ConfigSection
            planConfig={planConfig}
            onConfig={setPlanConfig}
            roles={roles}
            modelOptions={modelOptions}
            roleModels={roleModels}
            onRoleModel={setRoleModel}
          />
        )}
        <div
          style={{
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            overflow: "auto",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            {t("plan.mode")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
            {t("plan.enterHint")}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("plan.persisted")}</div>
          {/* 可恢复讨论入口：退出计划模式时暂存的未完成编排器，让用户显式选择继续或放弃。 */}
          {resumableOrchestratorId && (
            <div
              style={{
                marginTop: 8,
                padding: 12,
                border: "1px solid var(--border)",
                borderRadius: 10,
                background: "var(--bg-panel)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 12, color: "var(--text)" }}>{t("plan.resumeHint")}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={resumeDiscussion}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--accent)",
                    background: "var(--accent)",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {t("plan.resume")}
                </button>
                <button
                  onClick={discardResumableDiscussion}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "none",
                    color: "var(--text-muted)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {t("plan.discardAndNew")}
                </button>
              </div>
            </div>
          )}
          {/* 服务端持久化历史：刷新/重启后自动列出非终态编排讨论，提供恢复入口 */}
          {unfinishedHistory.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text)",
                  marginTop: 8,
                }}
              >
                {t("plan.historyUnfinished", { count: String(unfinishedHistory.length) })}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {unfinishedHistory.map((h) => (
                  <div
                    key={String(h.id)}
                    style={{
                      padding: 10,
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      background: "var(--bg-panel)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {String(h.requirement || t("plan.requirement"))}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {t(STATUS_LABEL[String(h.status)] ?? String(h.status))} ·{" "}
                        {t("plan.round", { round: String(h.roundCount ?? 0) })}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setOrchestratorId(String(h.id));
                        discardResumable();
                      }}
                      style={{
                        padding: "5px 10px",
                        borderRadius: 7,
                        border: "1px solid var(--accent)",
                        background: "none",
                        color: "var(--accent)",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {t("plan.continueThis")}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!snapshot) {
    // orchestratorId 已设置但快照尚未到达（SSE 首帧前的网络延迟）。
    // 用骨架屏替代纯文本，消除"卡死"假象。
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {modeHeader()}
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("plan.parsing")}</div>
          <SkeletonLines lines={4} lineHeight={14} gap={10} />
          <SkeletonLines lines={3} lineHeight={14} gap={10} lastLineWidth="45%" />
        </div>
      </div>
    );
  }

  const s = snapshot;
  const showPlans =
    s.status === "awaiting_confirm" || s.status === "executing" || s.status === "done";
  const convergeReason =
    s.convergence.reason !== "none" && s.convergence.converged
      ? t(`plan.converge.${s.convergence.reason}`)
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* 头部：状态 + 轮次进度 + 退出 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
          {t("plan.mode")}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {s.status === "discussing"
            ? t("plan.discussing", { round: s.rounds.length || 1, max: s.config.maxRounds })
            : t(STATUS_LABEL[s.status] ?? s.status)}
        </span>
        {convergeReason && (
          <span style={{ fontSize: 11, color: "var(--accent)" }}>
            · {t("plan.consensus", { reason: convergeReason })}
          </span>
        )}
        {s.control?.lastDecision && (
          <span style={{ fontSize: 11, color: "var(--accent)" }}>
            · {t("plan.controllerPacing")}：
            {t(`plan.controllerAction.${s.control.lastDecision.action}`)} ·{" "}
            {s.control.lastDecision.reason}
          </span>
        )}
        {s.control?.tokensSavedEstimate ? (
          <span
            style={{
              fontSize: 11,
              color: "#10b981",
              border: "1px solid color-mix(in srgb, #10b981 40%, transparent)",
              borderRadius: 6,
              padding: "1px 6px",
            }}
          >
            {t("plan.tokensSaved")}：≈{s.control.tokensSavedEstimate}
          </span>
        ) : null}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {orchestratorId && (
            <>
              <a
                href={`/api/plan/${encodeURIComponent(orchestratorId)}/export?format=md`}
                download
                title={t("plan.exportMd")}
                style={{
                  padding: "4px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "none",
                  color: "var(--text-muted)",
                  fontSize: 12,
                  cursor: "pointer",
                  textDecoration: "none",
                }}
              >
                {t("plan.export")}
              </a>
              <a
                href={`/api/plan/${encodeURIComponent(orchestratorId)}/export?format=html`}
                download
                title={t("plan.exportHtml")}
                style={{
                  padding: "4px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "none",
                  color: "var(--text-muted)",
                  fontSize: 12,
                  cursor: "pointer",
                  textDecoration: "none",
                }}
              >
                HTML
              </a>
            </>
          )}
          <button
            onClick={() => setShowConfig((v) => !v)}
            style={{
              padding: "4px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: showConfig
                ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                : "none",
              color: "var(--text-muted)",
              fontSize: 12,
              cursor: "pointer",
            }}
            title={t("plan.config")}
          >
            {t("plan.config")}
          </button>
          <button
            onClick={newDiscussion}
            disabled={busy}
            style={{
              padding: "4px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "none",
              color: "var(--text-muted)",
              fontSize: 12,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.5 : 1,
            }}
            title={t("plan.newDiscussion")}
          >
            {t("plan.newDiscussion")}
          </button>
          <button
            onClick={exitPlan}
            style={{ ...closeBtnStyle, marginLeft: 0 }}
            title={t("plan.exit")}
          >
            ✕
          </button>
        </div>
      </div>

      {/* 参与角色 */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          padding: "8px 14px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {s.agents.map((a) => (
          <span
            key={a.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              color: "var(--text-muted)",
            }}
          >
            <span style={dot(a.color)} />
            {a.roleName}
            {a.status === "thinking" && <span style={{ color: "var(--accent)" }}>…</span>}
          </span>
        ))}
      </div>

      {/* 配置区（可折叠） */}
      {showConfig && (
        <ConfigSection
          planConfig={planConfig}
          onConfig={setPlanConfig}
          roles={roles}
          modelOptions={modelOptions}
          roleModels={roleModels}
          onRoleModel={setRoleModel}
        />
      )}

      {/* 日志/历史切换 + 持久化提示 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 14px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <button
          onClick={() => setShowLog((v) => !v)}
          style={{
            padding: "3px 9px",
            borderRadius: 7,
            border: "1px solid var(--border)",
            background: showLog ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "none",
            color: "var(--text-muted)",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          {t("plan.log")} / {t("plan.history")}
        </button>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("plan.persisted")}</span>
      </div>

      {/* 主体 */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 14 }}>
        {showLog && <LogHistorySection logs={logs} history={history} />}
        {error && (
          <div style={{ color: "var(--danger, #f43f5e)", fontSize: 12, marginBottom: 10 }}>
            {error}
          </div>
        )}
        {docSavedPath && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              fontSize: 12,
              color: "var(--text)",
              background: "var(--color-success-bg, rgba(34,197,94,0.12))",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 10px",
              marginBottom: 10,
            }}
          >
            <span>{t("plan.docSaved", { path: docSavedPath })}</span>
            <button
              onClick={() => setDocSavedPath(null)}
              style={{
                border: "none",
                background: "transparent",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                padding: 0,
              }}
              aria-label="close"
            >
              ✕
            </button>
          </div>
        )}

        {/* Tab 栏：仅讨论结束后(showPlans)显示，让用户在「推荐方案」与「讨论时间线」间切换。
            讨论中(!showPlans)只显示时间线，无 tab。完整保留历史讨论过程不因生成方案而丢失。 */}
        {showPlans && (
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {(
              [
                { id: "plans", label: t("plan.plans") },
                { id: "discussion", label: t("plan.discussionTimeline") },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 8,
                  border: `1px solid ${activeTab === tab.id ? "var(--accent)" : "var(--border)"}`,
                  background: activeTab === tab.id ? "var(--accent-bg)" : "none",
                  color: activeTab === tab.id ? "var(--accent)" : "var(--text-muted)",
                  fontSize: 12,
                  fontWeight: activeTab === tab.id ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* 最终方案横幅：讨论结束后在方案 tab 顶部醒目提示 */}
        {showPlans && activeTab === "plans" && (
          <div
            style={{
              padding: "8px 12px",
              marginBottom: 10,
              borderRadius: 8,
              background: "var(--accent-bg)",
              border: "1px solid var(--accent)",
              color: "var(--accent)",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {t("plan.finalPlanBanner")}
          </div>
        )}

        {/* 讨论时间线：讨论中独占显示；讨论结束后可经 tab 切回查看完整历史 */}
        {(!showPlans || activeTab === "discussion") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {s.messages.map((m) => (
              <div key={m.id} style={{ display: "flex", gap: 8 }}>
                <span
                  style={{
                    ...dot(
                      m.kind === "arbiter"
                        ? "slate"
                        : (s.agents.find((a) => a.roleId === m.from)?.color ?? "slate"),
                    ),
                    marginTop: 5,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>
                    {m.kind === "user" ? t("plan.requirement") : m.fromName}
                    {m.round > 0 && (
                      <span style={{ opacity: 0.7 }}> · {t("plan.round", { round: m.round })}</span>
                    )}
                  </div>
                  <div
                    style={{
                      maxHeight: 220,
                      overflow: "auto",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "8px 10px",
                    }}
                  >
                    <PlanMarkdownBody>{m.content}</PlanMarkdownBody>
                  </div>
                </div>
              </div>
            ))}
            {s.status === "discussing" && (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t("plan.discussing", { round: s.rounds.length || 1, max: s.config.maxRounds })}…
              </div>
            )}
          </div>
        )}

        {/* 推荐方案：讨论结束后(showPlans)且 tab 在 plans 时显示 */}
        {showPlans && activeTab === "plans" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {s.plans.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("plan.emptyDraft")}</div>
            )}
            {s.plans.map((p: RecommendationPlan) => {
              const selected = s.selectedPlanId === p.id;
              // 推荐徽标：confidence 最高的方案标记为「推荐」
              const topPlanId = [...s.plans].sort((a, b) => b.confidence - a.confidence)[0]?.id;
              const isRecommended = p.id === topPlanId;
              const confidenceColor =
                p.confidence >= 0.8
                  ? "var(--git-added)"
                  : p.confidence >= 0.6
                    ? "var(--color-warning)"
                    : "var(--color-error-soft)";
              const riskLevel =
                p.confidence >= 0.8
                  ? t("plan.riskSafe")
                  : p.confidence >= 0.6
                    ? t("plan.riskCaution")
                    : t("plan.riskDanger");
              return (
                <div
                  key={p.id}
                  onClick={() => selectPlan(p.id)}
                  style={{
                    borderLeft: selected ? "3px solid var(--accent)" : "3px solid transparent",
                    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 10,
                    padding: 12,
                    background: selected ? "var(--accent-bg)" : "var(--bg)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div
                    style={{
                      height: 4,
                      borderRadius: 2,
                      background: "var(--bg-hover)",
                      overflow: "hidden",
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${p.confidence * 100}%`,
                        background: confidenceColor,
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
                        {p.title}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "1px 5px",
                          borderRadius: 4,
                          backgroundColor:
                            p.confidence >= 0.8
                              ? "var(--color-success-bg)"
                              : p.confidence >= 0.6
                                ? "color-mix(in srgb, var(--color-warning) 15%, transparent)"
                                : "var(--color-error-bg)",
                          color: confidenceColor,
                        }}
                      >
                        {riskLevel}
                      </span>
                      {isRecommended && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: 4,
                            backgroundColor: "var(--accent)",
                            color: "#fff",
                          }}
                        >
                          {t("plan.recommended")}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {t("plan.confidence")}: {Math.round(p.confidence * 100)}%
                    </span>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <PlanMarkdownBody>{p.summary}</PlanMarkdownBody>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                      marginTop: 8,
                    }}
                  >
                    <PlanList title={t("plan.pros")} items={p.pros} color="var(--git-added)" />
                    <PlanList
                      title={t("plan.cons")}
                      items={p.cons}
                      color="var(--color-error-soft)"
                    />
                  </div>
                  <PlanList
                    title={t("plan.scenarios")}
                    items={p.scenarios}
                    color="var(--text-muted)"
                  />
                </div>
              );
            })}

            {/* 执行任务（确认后） */}
            {s.status === "done" && s.tasks.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <div
                  style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}
                >
                  {t("plan.tasks")}
                </div>
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--text)" }}>
                  {s.tasks.map((tk) => (
                    <li key={tk.id} style={{ marginBottom: 4 }}>
                      {tk.title}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {showPlans && s.status !== "done" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {t("plan.chooseMode")}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => confirmPlan(s.selectedPlanId, "engine")}
                disabled={!s.selectedPlanId || busy}
                title={t("plan.modeEngineDesc")}
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  borderRadius: 9,
                  border: "1px solid var(--accent)",
                  background: "var(--accent)",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: s.selectedPlanId && !busy ? "pointer" : "not-allowed",
                  opacity: s.selectedPlanId && !busy ? 1 : 0.5,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  alignItems: "flex-start",
                }}
              >
                <span>{busy ? t("plan.executing") : t("plan.modeEngine")}</span>
                <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.9 }}>
                  {t("plan.modeEngineShort")}
                </span>
              </button>
              <button
                onClick={() => confirmPlan(s.selectedPlanId, "plan")}
                disabled={!s.selectedPlanId || busy}
                title={t("plan.modePlanDesc")}
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  borderRadius: 9,
                  border: "1px solid var(--border)",
                  background: "var(--bg-panel)",
                  color: "var(--text)",
                  fontWeight: 600,
                  cursor: s.selectedPlanId && !busy ? "pointer" : "not-allowed",
                  opacity: s.selectedPlanId && !busy ? 1 : 0.5,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  alignItems: "flex-start",
                }}
              >
                <span>{t("plan.modePlan")}</span>
                <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>
                  {t("plan.modePlanShort")}
                </span>
              </button>
            </div>
          </div>
        )}

        {s.status === "done" && (
          <button
            onClick={() => {
              setOrchestratorId(null);
              setPlanStatus("idle");
              setPlanMode(false);
              setRequestOpenEngine(true);
            }}
            style={{
              padding: "9px 14px",
              borderRadius: 9,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t("plan.openEngine")}
          </button>
        )}
      </div>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 12, color: "var(--text)", width: 84, flexShrink: 0 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "var(--accent)" }}
      />
      <span style={{ fontSize: 11, color: "var(--text-muted)", width: 36, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

function ConfigSection({
  planConfig,
  onConfig,
  roles,
  modelOptions,
  roleModels,
  onRoleModel,
}: {
  planConfig: PlanConfigSlice;
  onConfig: (patch: Partial<PlanConfigSlice>) => void;
  roles: Array<{ id: string; name: string; modelId: string | null }>;
  modelOptions: Array<{ id: string; name: string; provider: string }>;
  roleModels: Record<string, string>;
  onRoleModel: (roleId: string, modelId: string) => void;
}) {
  const { t } = useI18n();
  const modes: ControllerMode[] = ["hybrid", "deterministic", "llm"];
  return (
    <div
      style={{
        borderBottom: "1px solid var(--border)",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "color-mix(in srgb, var(--bg) 60%, transparent)",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("plan.configHint")}</div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--text)", width: 84, flexShrink: 0 }}>
          {t("plan.controllerMode")}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {modes.map((m) => {
            const active = planConfig.controllerMode === m;
            return (
              <button
                key={m}
                onClick={() => onConfig({ controllerMode: m })}
                style={{
                  padding: "3px 9px",
                  borderRadius: 7,
                  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  background: active
                    ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                    : "none",
                  color: active ? "var(--text)" : "var(--text-muted)",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {t(`plan.controller.${m}`)}
              </button>
            );
          })}
        </div>
      </div>

      <Slider
        label={t("plan.maxRounds")}
        min={1}
        max={8}
        value={planConfig.maxRounds}
        onChange={(v) => onConfig({ maxRounds: v })}
      />
      <Slider
        label={t("plan.stabilizeThreshold")}
        min={0.5}
        max={0.99}
        step={0.01}
        value={planConfig.stabilizeThreshold}
        onChange={(v) => onConfig({ stabilizeThreshold: v })}
      />
      <Slider
        label={t("plan.concurrency")}
        min={1}
        max={4}
        value={planConfig.concurrency}
        onChange={(v) => onConfig({ concurrency: v })}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>
          {t("plan.roleModel")}
        </span>
        {roles.length === 0 ? (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("plan.emptyHistory")}</span>
        ) : (
          roles.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", width: 90, flexShrink: 0 }}>
                {r.name}
              </span>
              <select
                value={roleModels[r.id] ?? ""}
                onChange={(e) => void onRoleModel(r.id, e.target.value)}
                style={{
                  flex: 1,
                  background: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 11,
                  padding: "3px 6px",
                }}
              >
                <option value="">{t("plan.roleModelDefault")}</option>
                {modelOptions.map((m) => (
                  <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LogHistorySection({
  logs,
  history,
}: {
  logs: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
}) {
  const { t } = useI18n();
  const levelColor: Record<string, string> = {
    debug: "#64748b",
    info: "#3b82f6",
    warn: "#f59e0b",
    error: "#f43f5e",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
          {t("plan.log")}
        </div>
        {logs.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("plan.emptyLog")}</div>
        ) : (
          <div
            style={{
              maxHeight: 200,
              overflow: "auto",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          >
            {logs.map((l, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "4px 8px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 11,
                  alignItems: "baseline",
                }}
              >
                <span style={{ color: levelColor[String(l.level)] ?? "#64748b" }}>●</span>
                <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                  {String(l.at).slice(11, 19)}
                </span>
                <span style={{ color: "var(--text)" }}>{String(l.message)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
          {t("plan.history")}
        </div>
        {history.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("plan.emptyHistory")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {history.map((h, i) => (
              <div
                key={i}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 8,
                  fontSize: 11,
                }}
              >
                <div style={{ color: "var(--text)" }}>{String(h.requirement)}</div>
                <div style={{ color: "var(--text-muted)", marginTop: 2 }}>
                  {String(h.status)} · {t("plan.round", { round: Number(h.roundCount ?? 0) })} ·{" "}
                  {t("plan.tokensSaved")} ≈{Number(h.tokensSavedEstimate || 0)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanList({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color, marginBottom: 2 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--text)" }}>
        {items.map((it, i) => (
          <li key={i} style={{ marginBottom: 2 }}>
            <PlanMarkdownBody>{it}</PlanMarkdownBody>
          </li>
        ))}
      </ul>
    </div>
  );
}

const closeBtnStyle: CSSProperties = {
  marginLeft: "auto",
  background: "none",
  border: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1,
};
