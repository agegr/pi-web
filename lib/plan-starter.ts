// lib/plan-starter.ts —— 发起一次多 Agent 计划讨论。
//
// 供 /plan slash 命令（useAgentSession.handleBuiltinSlashCommand）与（可选）
// planMode 下底部输入分流复用。后端 route：POST /api/plan/orchestrate
// body: { requirement, cwd?, config?, mock? } → { id, status }
//
// 纯客户端 fetch 封装，不依赖任何 hook；零上游耦合（route 是 pi-web 独有）。

export interface StartPlanOptions {
  /** 工作目录（orchestrator 用于加载项目上下文）。 */
  cwd?: string;
  /** 测试用 mock 讨论（不调用真实 LLM）。 */
  mock?: boolean;
}

/**
 * 发起讨论并返回 orchestratorId；失败返回 null。
 * 调用方拿到 id 后：setPlanMode(true) + setOrchestratorId(id) + navigate("plan")。
 */
export async function startPlanDiscussion(
  requirement: string,
  opts: StartPlanOptions = {},
): Promise<string | null> {
  const res = await fetch("/api/plan/orchestrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requirement,
      cwd: opts.cwd,
      mock: opts.mock,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  if (!res.ok || !data.id) return null;
  return data.id;
}
