// 约束规则系统的结构化类型定义。
//
// 设计目标：约束不是散落在 Markdown 里的静态文字，而是「可被程序解析的纯数据对象」
// （ConstraintSpec）。引擎读取这些规范，在运行时状态/事件变化时动态调度校验，并把
// 违反结果（ConstraintFinding）反馈给 UI 与业务逻辑，形成双向绑定。
//
// - ConstraintSpec 可序列化为 JSON、从 JSON 解析（见 serializeSpecs）。
// - triggers 声明该约束监听的状态源名或事件名；命中即重新求值（正向联动）。
// - evaluator 引用在引擎中注册的校验函数（处理复杂逻辑）；rule 是声明式 DSL（纯数据可解析）。
// - params.guards 声明该约束会封锁哪些业务动作；guard() 据此拦截（反向联动）。

export type ConstraintSeverity = "error" | "warn" | "info";

export type ConstraintScope = "client" | "server" | "both";

export type Locale = "en" | "zh";

/** 声明式条件：可被程序解析的 DSL 片段。 */
export interface ConstraintCondition {
  /** 状态路径，如 "locale" 或 "runtime.agentRunning"。 */
  path: string;
  op: "eq" | "neq" | "in" | "nin" | "exists" | "matches";
  value?: unknown;
}

/** 声明式规则：all（与）/ any（或）组合条件，可嵌套。描述「必须成立」的状态。 */
export interface ConstraintRule {
  all?: ConstraintCondition[];
  any?: ConstraintCondition[];
}

/** 结构化约束规范——引擎调度的最小单元，纯数据、可序列化。 */
export interface ConstraintSpec {
  id: string;
  title: string;
  description: string;
  severity: ConstraintSeverity;
  scope: ConstraintScope;
  /** 监听的触发器：状态源名或事件名；命中即重新求值。 */
  triggers: string[];
  /** 引用在引擎中注册的校验函数 id（处理复杂逻辑）。 */
  evaluator?: string;
  /** 传给 evaluator / 规则的可序列化参数（如 criticalKeys、guards）。 */
  params?: Record<string, unknown>;
  /** 声明式规则（纯数据，可由程序解析与求值）；与 evaluator 二选一或并存。 */
  rule?: ConstraintRule;
  /** 标签，便于分组/过滤。 */
  tags?: string[];
}

/** 校验器返回的中间结果（待引擎补全元数据）。 */
export interface ConstraintFindingInput {
  message: string;
  context?: Record<string, unknown>;
}

/** 约束求值上下文：由 contextBuilder 在每个求值点汇编。 */
export interface ConstraintContext {
  locale: Locale;
  i18n: { en: Record<string, string>; zh: Record<string, string> };
  runtime: unknown;
  /** 由领域事件注入的本次求值触发信息。 */
  event?: { type: string; payload?: unknown };
}

/** 校验函数签名：读取上下文与规范，返回违反信息或 null（通过）。 */
export type EvaluatorFn = (
  ctx: ConstraintContext,
  spec: ConstraintSpec,
) => ConstraintFindingInput | null;

/** 一条已生效的约束违反结果。 */
export interface ConstraintFinding {
  id: string;
  specId: string;
  severity: ConstraintSeverity;
  title: string;
  message: string;
  at: number;
  /** 触发本次求值的事件名（若有）。 */
  trigger?: string;
  /** 关联状态/数据，便于 UI 高亮与定位。 */
  context?: Record<string, unknown>;
}

export type ConstraintEventKind = "violated" | "resolved" | "updated";

export interface ConstraintEvent {
  kind: ConstraintEventKind;
  specId: string;
  at: number;
  finding?: ConstraintFinding;
}
