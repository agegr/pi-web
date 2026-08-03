"use client";

import { useCallback, useEffect, useState } from "react";
import { useTodoLiveRefresh } from "./useTodoLiveRefresh";
import { useAgentRuntime } from "@/lib/agent-runtime-store";
import type { TodoTask } from "@/lib/todo-types";

/**
 * 统一的 todo 数据 hook —— 合并 fetch + 实时刷新 + agent 运行结束后重取。
 *
 * 此前 TodoPanel / TodoBadge / InspectorPanel 各自实现了一份 reload 逻辑
 *（fetch /api/task-list + useTodoLiveRefresh + agentRunning 监听），三份重复。
 * 收敛到此，消费者一行接入。
 *
 * sessionId 从 useAgentRuntime 内部自取，消费者无需传入。
 *
 * - 挂载时 fetch 一次；
 * - todo 工具完成时（tool_execution_end）实时刷新（debounce 80ms）；
 * - agent 运行结束后重取（捕捉 agent 期间产生的 todo 更新）。
 *
 * @returns tasks 任务列表；entryIds taskId→消息 entryId（点击跳转用，P1）；
 *          loading 初始加载；error 失败信息（null=成功/未失败）；reload 手动刷新。
 */
export function useTodoTasks(): {
  tasks: TodoTask[];
  entryIds: Record<number, string>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const runtime = useAgentRuntime();
  const sessionId = runtime.sessionId;
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
