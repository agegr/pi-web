"use client";

// useEngineRuntime —— 订阅统一引擎监控状态（进程监控/需求生命周期/任务状态）。
// 模式：SSE(/api/engine/stream) 仅作「变更通知」，收到即经 REST(/api/engine/state)
// 拉取最新快照并写入客户端镜像 store，useSyncExternalStore 驱动重渲染（对账模式，
// 避免逐事件增量合并的竞态；复用 useAgentSession 的 SSE 重连范式）。
import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import type { UnifiedEngineState } from "@/lib/engine-runtime-store";
import { isEngineStateEquivalent } from "@/lib/engine-runtime-store";

async function engineFetchJson<T = unknown>(
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; data: T | undefined }> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  let data: T | undefined;
  try {
    data = (await res.json()) as T;
  } catch {
    /* 空响应或非法 JSON 时 data 保持 undefined */
  }
  return { ok: res.ok, data };
}

/** 订阅视图：统一状态面 + SSE 实时连接状态（供 UI 显示「实时已连接/重连中」）。 */
export interface EngineRuntimeView extends UnifiedEngineState {
  connected: boolean;
}

const EMPTY: UnifiedEngineState = {
  engineId: "unified-engine",
  phase: "idle",
  processes: [],
  requirementLifecycle: [],
  taskStatus: { pending: 0, running: 0, completed: 0, failed: 0, skipped: 0, total: 0 },
  runs: [],
  autoplan: { ready: false, features: [] },
  terminals: [],
  processTree: [],
  guardStatus: [],
  stats: { startedAt: 0, updatedAt: 0, errorCount: 0 },
};

let clientState: UnifiedEngineState = EMPTY;
const listeners = new Set<() => void>();

function setClientState(next: UnifiedEngineState) {
  // 内容无实质变化则跳过更新，避免 SSE 高频通知触发无意义 React 重渲染。
  if (isEngineStateEquivalent(clientState, next)) return;
  clientState = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): UnifiedEngineState {
  return clientState;
}

async function pull(): Promise<void> {
  const { ok, data } = await engineFetchJson<UnifiedEngineState>("/api/engine/state", {
    method: "GET",
  });
  if (ok && data) setClientState(data);
}

const SSE_RECONNECT_MS = 3000;

export function useEngineRuntime(): EngineRuntimeView {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      es = new EventSource("/api/engine/stream");
      setConnected(true);
      es.onmessage = () => {
        void pull();
      };
      es.onerror = () => {
        setConnected(false);
        es?.close();
        es = null;
        if (!closed) timer = setTimeout(connect, SSE_RECONNECT_MS);
      };
    };

    void pull();
    connect();

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, []);

  return { ...state, connected };
}
