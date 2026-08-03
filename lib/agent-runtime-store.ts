"use client";

// Agent runtime state store — a globalThis-level singleton that exposes the
// current agent session's runtime state (running flag, phase, tools, stats) to
// any consumer, bypassing the React prop chain.
//
// useAgentSession writes to this store whenever its internal state changes.
// AppShell, extension panels, and other components read via useAgentRuntime().
//
// Mirrors the subscribe/getSnapshot/useSyncExternalStore pattern from
// lib/extensions/registry.ts. Stored on globalThis so it survives hot-reload.

import { useSyncExternalStore } from "react";
import type { ToolEntry } from "@/lib/tool-presets";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { AgentPhase } from "@/hooks/useAgentSession";

export interface ContextUsageInfo {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export interface AgentRuntimeSnapshot {
  /** The session id whose state this snapshot reflects, or null. */
  sessionId: string | null;
  agentRunning: boolean;
  agentPhase: AgentPhase;
  tools: ToolEntry[];
  sessionStats: SessionStatsInfo | null;
  contextUsage: ContextUsageInfo | null;
}

const EMPTY_SNAPSHOT: AgentRuntimeSnapshot = {
  sessionId: null,
  agentRunning: false,
  agentPhase: null,
  tools: [],
  sessionStats: null,
  contextUsage: null,
};

class AgentRuntimeStore {
  private snapshot: AgentRuntimeSnapshot = EMPTY_SNAPSHOT;
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = (): number => this.version;

  getRuntimeSnapshot = (): AgentRuntimeSnapshot => this.snapshot;

  /** Update one or more fields of the snapshot. Only notifies if something changed. */
  update(patch: Partial<AgentRuntimeSnapshot>): void {
    const current = this.snapshot as unknown as Record<string, unknown>;
    const incoming = patch as unknown as Record<string, unknown>;
    let changed = false;
    for (const key of Object.keys(incoming)) {
      // Deep compare via JSON to avoid infinite loops from objects/arrays that
      // get a new reference every render but have identical content (e.g.
      // sessionStats is recomputed as a fresh object each render).
      if (JSON.stringify(current[key]) !== JSON.stringify(incoming[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.version++;
    this.listeners.forEach((cb) => cb());
  }

  /** Reset to empty (e.g. when the session unmounts). */
  reset(): void {
    this.snapshot = EMPTY_SNAPSHOT;
    this.version++;
    this.listeners.forEach((cb) => cb());
  }

  // ---- scrollToEntry 命令通道（不进 snapshot，不触发 notify）----
  // 函数无法序列化，故 update() 的 JSON.stringify 深比较会失真；命令通道独立于
  // 渲染状态。ChatWindow 挂载时注册，面板（TodoPanel）经 WorkspacePanelContext
  // 的 scrollToEntry 调用，实现「点击任务→跳转聊天对应消息」。
  private scrollToEntryFn: ((entryId: string) => void) | null = null;
  setScrollToEntry(fn: ((entryId: string) => void) | null): void {
    this.scrollToEntryFn = fn;
  }
  scrollToEntry(entryId: string): void {
    this.scrollToEntryFn?.(entryId);
  }
}

declare global {
  var __piAgentRuntimeStore: AgentRuntimeStore | undefined;
}

export function getAgentRuntimeStore(): AgentRuntimeStore {
  if (!globalThis.__piAgentRuntimeStore) {
    globalThis.__piAgentRuntimeStore = new AgentRuntimeStore();
  }
  return globalThis.__piAgentRuntimeStore;
}

/** React hook: subscribe to the agent runtime store and return the snapshot. */
export function useAgentRuntime(): AgentRuntimeSnapshot {
  const store = getAgentRuntimeStore();
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return store.getRuntimeSnapshot();
}
