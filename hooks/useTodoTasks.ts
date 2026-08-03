"use client";

import { useCallback, useEffect, useState } from "react";
import { useTodoLiveRefresh } from "./useTodoLiveRefresh";
import { useAgentRuntime } from "@/lib/agent-runtime-store";
import type { TodoTask } from "@/lib/todo-types";

/**
 * 统一的 todo 数据 hook —— 合并 fetch + 实时刷新 + agent 运行结束后重取。
 *
 * sessionId 由调用方传入（TodoPanel 从 WorkspacePanelContext.session.id，
 * 即真实选中会话）。不依赖 agent-runtime-store.sessionId——该 store 的
 * snapshot 当前未被填充（遗留缺陷，见 docs/TODO-INSPECTOR-CLEANUP.md Bug-D），
 * 故 sessionId 走参数注入。
 *
 * - 挂载时 fetch 一次；
 * - todo 工具完成时（tool_execution_end）实时刷新（debounce 80ms）；
 * - agent 运行结束后重取（runtime.agentRunning 兜底；liveRefresh 已覆盖主要场景）。
 *
 * @returns tasks 任务列表；entryIds taskId→消息 entryId（点击跳转用）；
 *          loading 初始加载；error 失败信息；reload 手动刷新。
 */
export function useTodoTasks(sessionId: string | null | undefined): {
  tasks: TodoTask[];
  entryIds: Record<number, string>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const runtime = useAgentRuntime();
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [entryIds, setEntryIds] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!sessionId) {
      setTasks([]);
      setEntryIds({});
      setLoading(false);
      setError(null);
      return;
    }
    try {
      const res = await fetch(`/api/task-list?sessionId=${encodeURIComponent(sessionId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { tasks?: TodoTask[]; entryIds?: Record<number, string> };
      setTasks(d.tasks ?? []);
      setEntryIds(d.entryIds ?? {});
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useTodoLiveRefresh(sessionId, reload);

  useEffect(() => {
    if (!runtime.agentRunning && sessionId) void reload();
  }, [runtime.agentRunning, sessionId, reload]);

  return { tasks, entryIds, loading, error, reload };
}
