// 多 Agent 协同工作流 —— 领域类型
// 本模块定义「Plan 讨论模式」背后多智能体编排系统的全部领域类型。
// 业务层（API 路由、PlanPanel 组件）只依赖这些类型，不感知具体后端。

// 代理角色类别：讨论参与者、汇总/仲裁者、方案合成者、用户代理。
export type AgentRoleKind = "participant" | "arbiter" | "synthesizer" | "user";

// 角色专业领域标签（用于意图解析时的动态角色选择）。
export type RoleTag =
  | "product"
  | "architecture"
  | "frontend"
  | "backend"
  | "data"
  | "infra"
  | "security"
  | "qa"
  | "ux"
  | "performance"
  | "cost";

// 一个 Agent 角色定义（角色库中的一项）。
export interface AgentRole {
  /** 稳定标识，如 "architect" */
  id: string;
  /** 展示名（i18n 键，见 lib/i18n） */
  name: string;
  kind: AgentRoleKind;
  /** 专业领域标签，意图解析据此动态选择角色 */
  expertise: RoleTag[];
  /** 该角色的固定系统提示词（讨论约束 + 专业视角） */
  systemPrompt: string;
  /** UI 着色（Tailwind 色名），仅展示用 */
  color: string;
  /** 一句话能力描述（i18n 键） */
  blurb: string;
  /** 该角色默认底层模型（provider/model），缺省时回退到全局默认模型。 */
  modelId?: string;
}

// 运行时被实例化的 Agent（讨论参与者）。
export interface AgentInstance {
  /** 实例 id（roleId + 序号） */
  id: string;
  roleId: string;
  roleName: string;
  kind: AgentRoleKind;
  color: string;
  /** 生命周期状态 */
  status: AgentStatus;
  /** 加入讨论的轮次（动态实例化） */
  joinedRound: number;
  /** 最近一次响应的消息 id */
  lastMessageId?: string;
  /** 累计 token（来自 runner，可选） */
  tokens?: number;
}

export type AgentStatus = "pending" | "thinking" | "responded" | "done" | "error";

// 讨论消息（消息队列中的一条）。
export interface DiscussionMessage {
  id: string;
  /** 所属轮次（user 消息为 0） */
  round: number;
  /** 发送方：角色 id；system 表示编排器注入的指令；user 表示用户原始需求 */
  from: string;
  fromName: string;
  kind: "user" | "agent" | "system" | "arbiter";
  content: string;
  /** 毫秒时间戳 */
  at: number;
}

// 单轮讨论的汇总（用于收敛判定与前端时间线）。
export interface RoundSummary {
  round: number;
  messageIds: string[];
  /** 该轮发言者角色 id 列表 */
  speakers: string[];
  /** 轮次结束时的收敛信号（仲裁者是否给出共识） */
  arbiterConsensus?: boolean;
  /** 该轮文本指纹（用于稳定度收敛判定） */
  fingerprint: string;
  /**
   * 该轮的压缩摘要（由本轮消息确定性派生，零额外 Token），
   * 用于后续轮次的上下文压缩（formatCompactTranscript）：旧轮次只保留此摘要，降低 Token 消耗。
   */
  summaryText?: string;
}

// 收敛状态。
export interface ConvergenceState {
  converged: boolean;
  /** 收敛原因：round_threshold / arbiter_signal / stabilized / user_forced */
  reason: "round_threshold" | "arbiter_signal" | "stabilized" | "user_forced" | "none";
  /** 已达轮次 */
  round: number;
  /** 0~1 共识度（由仲裁者评分或稳定度推导） */
  consensusScore?: number;
}

// --- 总控 Agent（混合策略节奏管控）------------------------------------------

/** 总控模式：deterministic 纯规则 / llm 每轮轻量裁定 / hybrid 混合（默认）。 */
export type ControllerMode = "deterministic" | "llm" | "hybrid";

/** 总控每轮的结构化决策。 */
export type ControllerDecision =
  | { action: "continue"; reason: string }
  | { action: "stop"; reason: string; converged: boolean }
  | { action: "redirect"; targetRoleId: string; question: string; reason: string }
  | { action: "clarify"; question: string; reason: string };

/** 总控运行状态（暴露给前端展示节奏与节省）。 */
export interface ControllerState {
  mode: ControllerMode;
  /** 计划轮次（maxRounds） */
  roundsPlanned: number;
  /** 实际执行轮次 */
  roundsExecuted: number;
  /** 估算节省的 Token（早停未执行轮次 × 参与者 × 单轮单角色预估） */
  tokensSavedEstimate: number;
  /** 全部决策历史 */
  decisions: ControllerDecision[];
  /** 最近一次决策 */
  lastDecision?: ControllerDecision;
  /** 连续信息增量过低的轮数 */
  stagnantRounds: number;
}

// 推荐方案（共识转化后的多个独立见解）。
export interface RecommendationPlan {
  id: string;
  title: string;
  /** 方案整体描述 */
  summary: string;
  /** 优点 */
  pros: string[];
  /** 缺点 / 风险 */
  cons: string[];
  /** 适用场景 */
  scenarios: string[];
  /** 置信度 0~1（合成者自评） */
  confidence: number;
  /** 主要作者角色 id（可选） */
  authorRoleId?: string;
}

// 经确认后拆分的执行任务。
export interface OrchestratedTask {
  id: string;
  title: string;
  description: string;
  /** 执行该任务的角色 id（可选） */
  assigneeRoleId?: string;
  /** 前置任务 id（DAG 边） */
  dependsOn: string[];
  order: number;
}

// 编排器对外状态。
export type OrchestrationStatus =
  | "idle"
  | "parsing"
  | "discussing"
  | "synthesizing"
  | "awaiting_confirm"
  | "awaiting_clarify"
  | "executing"
  | "done"
  | "failed"
  | "cancelled";

// 编排配置（可覆盖的默认值）。
export interface OrchestratorConfig {
  /** 讨论轮次硬上限（收敛阈值之一） */
  maxRounds: number;
  /** 连续两轮指纹相似度达到该值即判定稳定收敛（0~1） */
  stabilizeThreshold: number;
  /** 推荐方案数量 */
  planCount: number;
  /** 角色发言并发度（1=串行，>1 可并行调用 runner） */
  concurrency: number;
  /** 单轮单角色 LLM 超时（ms） */
  turnTimeoutMs: number;
  /** 单轮单角色最大重试 */
  turnMaxRetries: number;
  /** 总控模式：hybrid（默认）/ deterministic / llm */
  controllerMode: ControllerMode;
  /** 信息增量低于该值视为无进展（连续 2 轮触发早停） */
  infoDeltaThreshold: number;
  /** 跨轮重复度高于该值视为原地踏步、触发早停（0~1） */
  repetitionThreshold: number;
  /** 单轮单角色预估 Token（用于总控节省估算，仅统计展示用） */
  estimatedTokensPerTurn: number;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxRounds: 4,
  stabilizeThreshold: 0.85,
  planCount: 2,
  concurrency: 1,
  turnTimeoutMs: 90_000,
  turnMaxRetries: 1,
  controllerMode: "hybrid",
  infoDeltaThreshold: 0.08,
  repetitionThreshold: 0.9,
  estimatedTokensPerTurn: 1200,
};

// 意图解析结果（需求接收与解析模块输出）。
export interface IntentParseResult {
  /** 归一化后的需求摘要 */
  summary: string;
  /** 抽取的关键词 */
  keywords: string[];
  /** 命中的专业领域标签 */
  tags: RoleTag[];
  /** 动态实例化的角色 id（含 user/arbiter/synthesizer 之外的参与者） */
  selectedRoleIds: string[];
  /** 解析置信度 0~1 */
  confidence: number;
}

// 对外快照（前端订阅渲染）。
export interface OrchestrationSnapshot {
  id: string;
  status: OrchestrationStatus;
  requirement: string;
  cwd?: string;
  config: OrchestratorConfig;
  intent?: IntentParseResult;
  agents: AgentInstance[];
  messages: DiscussionMessage[];
  rounds: RoundSummary[];
  convergence: ConvergenceState;
  plans: RecommendationPlan[];
  /** 当前选中的方案 id（用户交互） */
  selectedPlanId?: string;
  /** 确认后拆分的任务（执行阶段） */
  tasks: OrchestratedTask[];
  /** 总控运行状态（节奏/轮次/节省 Token 展示） */
  control?: ControllerState;
  /** 总控澄清问题（awaiting_clarify 时展示，引导用户提供反馈） */
  clarifyQuestion?: string;
  error?: string;
  updatedAt: number;
}

// 编排器对外事件（事件驱动，SSE 推送）。
export type OrchestratorEvent =
  | { type: "status"; status: OrchestrationStatus; at: number }
  | { type: "intent"; intent: IntentParseResult; at: number }
  | { type: "agent.joined"; agent: AgentInstance; at: number }
  | { type: "round.start"; round: number; at: number }
  | { type: "agent.thinking"; agentId: string; round: number; at: number }
  | { type: "message"; message: DiscussionMessage; at: number }
  | { type: "round.end"; summary: RoundSummary; convergence: ConvergenceState; at: number }
  | { type: "controller.decision"; decision: ControllerDecision; round: number; at: number }
  | { type: "plans"; plans: RecommendationPlan[]; at: number }
  | { type: "task.changed"; tasks: OrchestratedTask[]; at: number }
  | {
      type: "log";
      level: "debug" | "info" | "warn" | "error";
      scope: "orchestrator";
      message: string;
      at: number;
    }
  | { type: "error"; message: string; at: number }
  | { type: "done"; snapshot: OrchestrationSnapshot; at: number };
