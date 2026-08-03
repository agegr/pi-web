"use client";

// 面板控制层 —— 右侧工作区面板列的统一控制面。
//
// 解决的问题（见 docs/PLAN-ENGINE-INTEGRATION.md 2.4）：
//   WorkspacePanelsHost 原本是封闭组件：activeId 不外露（外部无法请求切 tab）、
//   可见性无条件（无开关）、无通知通道（讨论结束/引擎完成无法提示）。
//   /plan 发起要切到 plan tab、confirm 要交接 engine tab —— 都缺一个
//   外部可调用的"面板导航"。
//
// 本模块提供：
//   1. navigate(id)          —— 外部请求切换当前面板（持久化到 localStorage）
//   2. badges                —— 面板级通知徽标（讨论结束 / 引擎完成 → +1）
//   3. visibility            —— 面板开关偏好（localStorage，默认 DEFAULT_VISIBLE）
//   4. engineAvailable       —— comet 依赖探测结果（服务端 API 异步回填，null=未知）
//
// 架构：globalThis 单例（跨热重载存活），subscribe/getSnapshot/useSyncExternalStore
// 模式与 lib/agent-runtime-store.ts 一致；SSR 安全（客户端 localStorage 惰性读取）。

import { useSyncExternalStore } from "react";

export type PanelId = "todo" | "inspector" | "prompts" | "plan" | "engine";

export interface PanelSnapshot {
  /** 当前激活的面板（null = 未选，由宿主 fallback 到第一个可见面板）。 */
  activeId: PanelId | null;
  /** 面板 → 未读通知计数（侧栏 tab 徽标）。 */
  badges: Partial<Record<PanelId, number>>;
  /** comet 依赖探测结果：true/false/null(未知)。 */
  engineAvailable: boolean | null;
}

const VISIBLE_KEY = "pi-panels-visible";
const ACTIVE_KEY = "pi-panels-active";

/**
 * 面板可见性默认值。
 * 注意：prompts/plan 当前是死功能/孤岛（接通前），默认关；接通后应改为 true。
 * todo/inspector 轻量常用；engine 已通电默认开。
 */
const DEFAULT_VISIBLE: Record<PanelId, boolean> = {
  todo: true,
  inspector: true,
  prompts: true,
  plan: true,
  engine: true,
};

const EMPTY: PanelSnapshot = { activeId: null, badges: {}, engineAvailable: null };

function readJson<T>(key: string): T | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

class PanelController {
  private snapshot: PanelSnapshot = { ...EMPTY };
  private listeners = new Set<() => void>();
  private version = 0;

  constructor() {
    // 恢复上次激活的面板（刷新后回到同一 tab）。
    const saved = readJson<PanelId>(ACTIVE_KEY);
    if (saved) this.snapshot.activeId = saved;
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = (): number => this.version;

  getPanelSnapshot = (): PanelSnapshot => this.snapshot;

  private notify(): void {
    this.version++;
    this.listeners.forEach((cb) => cb());
  }

  /** 请求切换当前面板（幂等；持久化，刷新后保持）。 */
  navigate(id: PanelId): void {
    if (this.snapshot.activeId === id) return;
    this.snapshot = { ...this.snapshot, activeId: id };
    writeJson(ACTIVE_KEY, id);
    this.notify();
  }

  /** 面板开关偏好（读 localStorage，缺省合并 DEFAULT_VISIBLE）。 */
  getVisibility(): Record<PanelId, boolean> {
    const saved = readJson<Partial<Record<PanelId, boolean>>>(VISIBLE_KEY);
    return { ...DEFAULT_VISIBLE, ...(saved ?? {}) };
  }

  /** 开关某面板。触发重渲染，宿主按新偏好过滤。 */
  setVisible(id: PanelId, visible: boolean): void {
    const next = { ...this.getVisibility(), [id]: visible };
    writeJson(VISIBLE_KEY, next);
    this.notify();
  }

  /** 面板徽标 +1（讨论结束 / 引擎完成等）。 */
  bumpBadge(id: PanelId): void {
    const badges = { ...this.snapshot.badges, [id]: (this.snapshot.badges[id] ?? 0) + 1 };
    this.snapshot = { ...this.snapshot, badges };
    this.notify();
  }

  /** 清空某面板徽标（进入该 tab 时）。 */
  clearBadge(id: PanelId): void {
    if (!this.snapshot.badges[id]) return;
    const badges = { ...this.snapshot.badges, [id]: 0 };
    this.snapshot = { ...this.snapshot, badges };
    this.notify();
  }

  /** 回填 comet 探测结果（服务端 API 异步）。 */
  setEngineAvailable(v: boolean): void {
    if (this.snapshot.engineAvailable === v) return;
    this.snapshot = { ...this.snapshot, engineAvailable: v };
    this.notify();
  }
}

const g = globalThis as unknown as { __piPanelController?: PanelController };
export const getPanelController = (): PanelController =>
  (g.__piPanelController ??= new PanelController());

/** 组件订阅：activeId / badges / engineAvailable 变化时重渲染。 */
export function usePanelController(): PanelSnapshot {
  const c = getPanelController();
  useSyncExternalStore(c.subscribe, c.getSnapshot, c.getSnapshot);
  return c.getPanelSnapshot();
}

/** 非 hook 环境读取（事件回调等）。 */
export const getPanelSnapshot = (): PanelSnapshot => getPanelController().getPanelSnapshot();
