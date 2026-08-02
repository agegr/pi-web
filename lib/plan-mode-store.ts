// Plan 模式共享 store —— 跨 ChatInput / PlanPanel / AppShell 的全局状态。
// 采用 useSyncExternalStore + globalThis 单例（与 lib/agent-runtime-store 同范式），
// 使计划模式开关、当前讨论编排器 id、以及「确认后跳转引擎面板」信号可被任意组件读取。

"use client";

import { useEffect, useSyncExternalStore } from "react";

export type ControllerMode = "hybrid" | "deterministic" | "llm";

/** 计划讨论的可配置项（发起讨论时随 orchestrate 请求体下发给后端）。 */
export interface PlanConfigSlice {
  controllerMode: ControllerMode;
  maxRounds: number;
  stabilizeThreshold: number;
  concurrency: number;
}

export const DEFAULT_PLAN_CONFIG: PlanConfigSlice = {
  controllerMode: "hybrid",
  maxRounds: 4,
  stabilizeThreshold: 0.85,
  concurrency: 1,
};

/** pi session → 编排器的链接条目。每个 plan-mode 会话都对应一个轻量 pi session
 *  作为侧栏入口（名为「📋 计划讨论：…」），点击该条目时通过此映射恢复 PlanPanel。 */
export interface PlanLinkEntry {
  orchestratorId: string;
  /** 编排器上下文目录；与 pi session 的 cwd 一致。 */
  cwd: string;
}

export interface PlanModeSnapshot {
  /** 是否处于计划模式（讨论模式） */
  planMode: boolean;
  /** 当前讨论编排器 id（null 表示尚未开始讨论） */
  orchestratorId: string | null;
  /** 可恢复的编排器 id：用户退出计划模式时，未完成讨论的编排器 id 暂存于此。
   *  再次进入计划模式时，PlanPanel 引导界面据此显示「继续上次讨论 / 新建讨论」入口。
   *  与 orchestratorId 互斥：退出 → orchestratorId 清空、resumableOrchestratorId 置位；
   *  恢复 → resumableOrchestratorId 移回 orchestratorId 并清空；新建 → 直接清空 resumableOrchestratorId。 */
  resumableOrchestratorId: string | null;
  /** 讨论编排器的当前状态（idle/parsing/discussing/synthesizing/awaiting_confirm/executing/done/failed/cancelled）。
   *  供输入框判断「无激活讨论 → 发起」或「等待确认 → 反馈重议」。 */
  planStatus: string;
  /** 请求 AppShell 打开引擎面板的信号（确认方案后由 PlanPanel 置位） */
  requestOpenEngine: boolean;
  /** 计划讨论配置（总控模式 / 轮次上限 / 收敛阈值 / 并发度） */
  planConfig: PlanConfigSlice;
  /** pi sessionId → 编排器链接表。每个 plan-mode 会话都对应一个轻量 pi session 作为侧栏入口。
   *  键 = 侧栏 SessionInfo.id；值 = { orchestratorId, cwd }。
   *  点击侧栏条目时由 AppShell 查此映射恢复 PlanPanel 的 SSE；删除侧栏条目时反向清理。
   *  持久化到 localStorage，刷新后仍可点击恢复。 */
  planSessionLinks: Record<string, PlanLinkEntry>;
}

const EMPTY: PlanModeSnapshot = {
  planMode: false,
  orchestratorId: null,
  resumableOrchestratorId: null,
  planStatus: "idle",
  requestOpenEngine: false,
  planConfig: { ...DEFAULT_PLAN_CONFIG },
  planSessionLinks: {},
};

// F5 刷新后浏览器 globalThis 清空，plan-mode-store 会回到 EMPTY，导致正在进行的
// 讨论从 UI 消失（PlanPanel 不挂载 → 无法触发恢复）。把恢复所需的最小字段集镜像
// 到 localStorage，刷新后在 store 首次构造时同步 hydrate，PlanPanel 的 SSE useEffect
// 随即重连，服务端 ensureRehydrated() 从 JSONL 还原编排器，完整恢复链路打通。
// requestOpenEngine 是瞬时信号（确认后消费即清）、planConfig 已有服务端持久化，不镜像。
// planSessionLinks 必须持久化——刷新后点击侧栏条目才能恢复 PlanPanel。
const PLAN_STORAGE_KEY = "pi-plan-mode";
const PERSISTED_KEYS = [
  "planMode",
  "orchestratorId",
  "resumableOrchestratorId",
  "planStatus",
  "planSessionLinks",
] as const;

/** 需要持久化的子集（仅恢复所需字段）。 */
type PersistedPlanState = Pick<PlanModeSnapshot, (typeof PERSISTED_KEYS)[number]>;

function loadPersistedState(): Partial<PersistedPlanState> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PLAN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedPlanState>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function savePersistedState(snapshot: PlanModeSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    const subset: PersistedPlanState = {
      planMode: snapshot.planMode,
      orchestratorId: snapshot.orchestratorId,
      resumableOrchestratorId: snapshot.resumableOrchestratorId,
      planStatus: snapshot.planStatus,
      planSessionLinks: snapshot.planSessionLinks,
    };
    window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(subset));
  } catch {
    /* 隐私模式 / 配额满：忽略，不影响内存态 */
  }
}

function clearPersistedState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PLAN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

class PlanModeStore {
  private snapshot: PlanModeSnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private version = 0;
  // 是否已把 localStorage 的持久化字段并入 snapshot。
  // store 构造期不读 localStorage —— 否则客户端首帧的 getSnapshot 会带上
  // 持久化值，而 SSR/首帧 getServerSnapshot 返回 EMPTY，造成 hydration
  // mismatch（AppShell 顶部状态条在服务端不渲染、客户端渲染）。改在
  // usePlanMode 挂载后调用 hydrate() 显式并入，与 usePersistentState 范式一致。
  private hydrated = false;

  /** 从 localStorage 并入持久化字段。仅在客户端、且仅首次调用生效。
   *  由 usePlanMode 的 useEffect 在挂载后触发，确保 SSR 与 hydration 首帧
   *  都读 EMPTY，避免 hydration mismatch。 */
  hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const persisted = loadPersistedState();
    if (persisted) {
      // planSessionLinks 反序列化兜底：旧版本没有此字段时给空对象，避免 undefined 蔓延。
      const { planSessionLinks, ...rest } = persisted;
      this.snapshot = {
        ...EMPTY,
        ...rest,
        planSessionLinks: planSessionLinks ?? {},
      };
      this.version++;
      this.listeners.forEach((cb) => cb());
    }
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): number => this.version;
  getState = (): PlanModeSnapshot => this.snapshot;

  update(patch: Partial<PlanModeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    // 若 patch 含任一持久化字段，写穿 localStorage（保证刷新可恢复）。
    if (PERSISTED_KEYS.some((k) => k in patch)) {
      savePersistedState(this.snapshot);
    }
    this.version++;
    this.listeners.forEach((cb) => cb());
  }

  reset(): void {
    this.snapshot = EMPTY;
    this.hydrated = false;
    clearPersistedState();
    this.version++;
    this.listeners.forEach((cb) => cb());
  }
}

declare global {
  var __piPlanModeStore: PlanModeStore | undefined;
}

export function getPlanModeStore(): PlanModeStore {
  // globalThis 单例跨 HMR 存活：若热重载后旧实例缺少新方法（如 hydrate），
  // 直接复用会触发 "store.hydrate is not a function"。检测到方法缺失时重建，
  // 重建会走构造期（不读 localStorage），随后由 usePlanMode 的 useEffect 重新 hydrate。
  const existing = globalThis.__piPlanModeStore;
  if (!existing || typeof existing.hydrate !== "function") {
    const store = new PlanModeStore();
    globalThis.__piPlanModeStore = store;
    return store;
  }
  return existing;
}

export function usePlanMode(): PlanModeSnapshot {
  const store = getPlanModeStore();
  // SSR 与客户端 hydration 首帧都返回 EMPTY（getServerSnapshot 的职责），
  // 避免服务端渲染与客户端首帧不一致导致 hydration mismatch。
  // 挂载后由下方 useEffect 调用 store.hydrate() 并入 localStorage 持久化值。
  useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    // getServerSnapshot：SSR 与首帧一致返回 version=0 对应的 EMPTY。
    store.getSnapshot,
  );
  useEffect(() => {
    store.hydrate();
  }, [store]);
  return store.getState();
}

// ─── 命令式操作（非 React 组件内调用） ─────────────────────────────

export function setPlanMode(v: boolean): void {
  getPlanModeStore().update({ planMode: v });
}
export function setOrchestratorId(id: string | null): void {
  getPlanModeStore().update({ orchestratorId: id });
}
/**
 * 退出计划模式时暂存当前编排器 id，使其可被恢复。
 * 内部读取当前 orchestratorId（无参形式，消除调用方闭包陈旧风险），
 * orchestratorId 清空（退出当前讨论的活跃态），resumableOrchestratorId 置位。
 * 保留 planStatus 以便恢复后输入框判断交互方式。
 */
export function stashResumable(): void {
  const store = getPlanModeStore();
  const id = store.getState().orchestratorId;
  store.update({
    orchestratorId: null,
    resumableOrchestratorId: id,
  });
}
/**
 * 恢复上次未完成的讨论：把暂存的编排器 id 移回 orchestratorId，触发 PlanPanel 的 SSE 重连。
 * 同时清空 resumableOrchestratorId，避免重复恢复。
 */
export function resumeOrchestrator(): void {
  const store = getPlanModeStore();
  const id = store.getState().resumableOrchestratorId;
  if (!id) return;
  store.update({ orchestratorId: id, resumableOrchestratorId: null });
}
/** 放弃可恢复的讨论，清空暂存 id，回到干净的新建状态。 */
export function discardResumable(): void {
  getPlanModeStore().update({ resumableOrchestratorId: null });
}
export function setPlanStatus(status: string): void {
  getPlanModeStore().update({ planStatus: status });
}
export function requestOpenEngine(v: boolean): void {
  getPlanModeStore().update({ requestOpenEngine: v });
}
export function setPlanConfig(patch: Partial<PlanConfigSlice>): void {
  const store = getPlanModeStore();
  store.update({ planConfig: { ...store.getState().planConfig, ...patch } });
}

/**
 * 把编排器 id 绑定到 pi sessionId（侧栏条目）。
 * ChatInput 在 plan 分支创建编排成功后调用：
 *   1. POST /api/agent/new 建轻量 pi session → 拿到 piSessionId
 *   2. POST /api/agent/[piSessionId] 调 set_session_name 写侧栏可见名
 *   3. linkPlanSession(piSessionId, orchId, cwd) 持久化链接
 * 之后侧栏 SessionSidebar 会通过 listAllSessions() 看到这条带 📋 前缀的会话；
 * 点击该条目时 AppShell.handleSelectSession 反向查 link 触发恢复。
 */
export function linkPlanSession(piSessionId: string, entry: PlanLinkEntry): void {
  if (!piSessionId || !entry.orchestratorId) return;
  const store = getPlanModeStore();
  store.update({
    planSessionLinks: { ...store.getState().planSessionLinks, [piSessionId]: entry },
  });
}

/** 解除 pi session 与编排器的绑定（删除侧栏条目时反向清理）。 */
export function unlinkPlanSession(piSessionId: string): void {
  if (!piSessionId) return;
  const store = getPlanModeStore();
  const next = { ...store.getState().planSessionLinks };
  if (!(piSessionId in next)) return;
  delete next[piSessionId];
  store.update({ planSessionLinks: next });
}

/** 查 pi sessionId 对应的编排器链接（AppShell 选中侧栏条目时调用）。 */
export function getPlanLink(piSessionId: string): PlanLinkEntry | undefined {
  if (!piSessionId) return undefined;
  return getPlanModeStore().getState().planSessionLinks[piSessionId];
}

/** 按 orchestratorId 反查 plan 链接（点击侧栏虚拟根时调用，虚拟根的 session.id = orchId）。
 *  planSessionLinks 的 key 是 piSessionId，点击虚拟根时 getPlanLink(orchId) 必 miss，
 *  需此反查把 orchId 映射回 { piSessionId, entry } 才能正确恢复 PlanPanel。 */
export function getPlanLinkByOrchId(
  orchId: string,
): { piSessionId: string; entry: PlanLinkEntry } | undefined {
  if (!orchId) return undefined;
  const links = getPlanModeStore().getState().planSessionLinks;
  for (const [piSessionId, entry] of Object.entries(links)) {
    if (entry.orchestratorId === orchId) return { piSessionId, entry };
  }
  return undefined;
}
