// unified-engine-adapter.ts —— 编排层（组合两能力端口 + 运行时，实现 UnifiedEnginePort）
// 业务层只依赖 UnifiedEnginePort；本文件是组装点，确保适配层为唯一上游导入处。
import { getEngineRuntime, type EngineRuntime } from "./unified-engine-runtime";
import { getAutoPlanAdapter } from "./autoplan-adapter";
import { getCometAdapter } from "./comet-adapter";
import {
  registerUnifiedEngineAdapter,
  hasUnifiedEngineAdapter,
  type UnifiedEnginePort,
} from "./unified-engine-ports";
import type { LlmCompletionFn } from "./unified-engine-types";
import { createPiLlmCompletion } from "@/lib/agent-orchestrator/llm-backend";

export { getUnifiedEngineAdapter } from "./unified-engine-ports";

/** 默认 LLM 工厂：按 cwd 解析已配置模型的补全函数（无模型时调用会抛错，由适配器兜底降级）。 */
function defaultCreateLlm(cwd: string): LlmCompletionFn {
  return createPiLlmCompletion(cwd);
}

export function createUnifiedEngineAdapter(
  createLlm?: (cwd: string) => LlmCompletionFn | null,
): UnifiedEnginePort {
  const llm = createLlm ?? defaultCreateLlm;
  const runtime = getEngineRuntime(getAutoPlanAdapter(llm), getCometAdapter());
  return {
    createChange: (input) => runtime.createChange(input),
    startRun: (runId) => runtime.startRun(runId),
    pauseRun: (runId) => runtime.pauseRun(runId),
    resumeRun: (runId) => runtime.resumeRun(runId),
    getRunState: async (runId) => runtime.getRunState(runId),
  };
}

/** 获取全局运行时单例（供 API 路由订阅事件 / 列举运行） */
export function getEngineRuntimeInstance(
  createLlm?: (cwd: string) => LlmCompletionFn | null,
): EngineRuntime {
  return getEngineRuntime(getAutoPlanAdapter(createLlm ?? defaultCreateLlm), getCometAdapter());
}

/** 注册默认融合引擎（幂等） */
export function registerDefaultEngine(): void {
  if (hasUnifiedEngineAdapter()) return;
  registerUnifiedEngineAdapter(createUnifiedEngineAdapter(defaultCreateLlm));
}
