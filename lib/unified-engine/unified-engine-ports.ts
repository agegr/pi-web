// UnifiedEnginePort —— 业务门面（业务层唯一依赖）
// 由 unified-engine-adapter 组合两能力端口实现并注册。
import type { ChangeInput, RunState } from "./unified-engine-types";

export interface UnifiedEnginePort {
  /** 创建一次自主编程变更（需求 + comet change 二合一） */
  readonly createChange: (input: ChangeInput) => Promise<RunState>;
  /** 启动运行：按阶段驱动 计划生成→任务执行→守卫校验→流转 */
  readonly startRun: (runId: string) => Promise<RunState>;
  /** 暂停运行 */
  readonly pauseRun: (runId: string) => Promise<void>;
  /** 恢复运行（断点续跑） */
  readonly resumeRun: (runId: string) => Promise<RunState>;
  /** 读取运行全状态 */
  readonly getRunState: (runId: string) => Promise<RunState>;
}

let registered: UnifiedEnginePort | null = null;

export function registerUnifiedEngineAdapter(adapter: UnifiedEnginePort): void {
  registered = adapter;
}

export function getUnifiedEngineAdapter(): UnifiedEnginePort {
  if (!registered) {
    throw new Error("UnifiedEngineAdapter 尚未注册（请先调用 registerUnifiedEngineAdapter）");
  }
  return registered;
}

export function hasUnifiedEngineAdapter(): boolean {
  return registered !== null;
}
