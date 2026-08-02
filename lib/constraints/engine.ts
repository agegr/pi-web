// 约束引擎——把结构化约束规范与程序运行时状态/事件深度联动。
//
// 核心机制：
// 1) 约束以数据（ConstraintSpec）声明，引擎负责调度与求值。
// 2) triggers 将约束绑定到「状态源名」或「事件名」；运行时状态变化时引擎自动重算相关约束
//    （正向联动：状态/事件 → 约束）。
// 3) 引擎产出 ConstraintFinding 集合，经 useSyncExternalStore 暴露给 UI；约束违反亦可通过
//    guard() 拦截业务动作（反向联动：约束 → 业务）。
// 4) emit() 让业务代码主动投递领域事件（如「上报了某条用户可见状态文案」），触发约束实时校验。
//
// 本文件保持环境无关（不导入 React / 路径别名），便于在 node 测试与浏览器中复用。

import type {
  ConstraintContext,
  ConstraintEvent,
  ConstraintFinding,
  ConstraintSeverity,
  ConstraintSpec,
  ConstraintRule,
  ConstraintCondition,
  EvaluatorFn,
} from "./types";

export class ConstraintEngine {
  private specs = new Map<string, ConstraintSpec>();
  private evaluators = new Map<string, EvaluatorFn>();
  private findings = new Map<string, ConstraintFinding>();
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: ConstraintEvent) => void>();
  private readonly contextBuilder: () => ConstraintContext;
  private findingsVersion = 0;
  private cachedFindings: ConstraintFinding[] = [];

  constructor(contextBuilder: () => ConstraintContext) {
    this.contextBuilder = contextBuilder;
  }

  /** 注册一个命名校验函数，供 spec.evaluator 引用。 */
  registerEvaluator(name: string, fn: EvaluatorFn): void {
    this.evaluators.set(name, fn);
  }

  addConstraint(spec: ConstraintSpec): void {
    this.specs.set(spec.id, spec);
  }

  removeConstraint(id: string): void {
    this.specs.delete(id);
    if (this.findings.delete(id)) this.rebuildAndNotify();
  }

  getSpecs(): ConstraintSpec[] {
    return [...this.specs.values()];
  }

  /**
   * 把外部状态源桥接到引擎：当 store 变化时回调，触发对应触发器重算。
   * 返回取消订阅函数。
   */
  bindStateSource(trigger: string, subscribe: (cb: () => void) => () => void): () => void {
    return subscribe(() => this.reconcile(trigger));
  }

  /** 领域事件入口：业务代码 emit 事件 → 触发匹配约束（带事件载荷）。 */
  emit(type: string, payload?: unknown): void {
    this.reconcile(type, payload);
  }

  private reconcile(trigger: string, payload?: unknown): void {
    const ctx = this.buildCtx(payload !== undefined ? { type: trigger, payload } : undefined);
    let changed = false;
    for (const spec of this.specs.values()) {
      if (!spec.triggers.includes(trigger)) continue;
      const finding = this.evaluateSpec(spec, ctx);
      changed = this.applyFinding(spec, finding) || changed;
    }
    if (changed) this.rebuildAndNotify();
  }

  /** 全量重算（如启动时、UI 手动「重新校验」时）。 */
  evaluateAll(): void {
    const ctx = this.buildCtx();
    let changed = false;
    for (const spec of this.specs.values()) {
      const finding = this.evaluateSpec(spec, ctx);
      changed = this.applyFinding(spec, finding) || changed;
    }
    if (changed) this.rebuildAndNotify();
  }

  private buildCtx(event?: { type: string; payload?: unknown }): ConstraintContext {
    const base = this.contextBuilder();
    return event ? { ...base, event } : base;
  }

  private evaluateSpec(spec: ConstraintSpec, ctx: ConstraintContext): ConstraintFinding | null {
    // 声明式规则：描述「必须成立」的状态；不成立即视为违反。
    let ruleHolds = true;
    if (spec.rule) ruleHolds = evaluateRule(spec.rule, ctx);

    let finding: ConstraintFinding | null = null;
    if (spec.evaluator) {
      const fn = this.evaluators.get(spec.evaluator);
      if (!fn) {
        finding = makeFinding(spec, `未注册的校验器：${spec.evaluator}`);
      } else {
        const res = fn(ctx, spec);
        if (res) finding = makeFinding(spec, res.message, res.context);
      }
    }
    if (!ruleHolds) {
      finding = finding ?? makeFinding(spec, spec.description);
    }
    return finding;
  }

  /** 合并/消解一条 finding；返回是否有变化。 */
  private applyFinding(spec: ConstraintSpec, finding: ConstraintFinding | null): boolean {
    const prev = this.findings.get(spec.id);
    if (finding) {
      if (!prev || prev.message !== finding.message || prev.severity !== finding.severity) {
        this.findings.set(spec.id, finding);
        this.emitConstraintEvent(prev ? "updated" : "violated", finding);
        return true;
      }
      return false;
    }
    if (prev) {
      this.findings.delete(spec.id);
      this.emitConstraintEvent("resolved", prev);
      return true;
    }
    return false;
  }

  private emitConstraintEvent(kind: ConstraintEvent["kind"], finding: ConstraintFinding): void {
    const evt: ConstraintEvent = { kind, specId: finding.specId, at: finding.at, finding };
    this.eventListeners.forEach((cb) => cb(evt));
  }

  private rebuildAndNotify(): void {
    this.cachedFindings = [...this.findings.values()];
    this.findingsVersion++;
    this.listeners.forEach((cb) => cb());
  }

  // ----- 对外读取（供 useSyncExternalStore 等消费） -----

  getFindings(): ConstraintFinding[] {
    return this.cachedFindings;
  }

  /** 稳定版本号，供 useSyncExternalStore 判断是否需要重渲染。 */
  getSnapshot = (): number => this.findingsVersion;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  onConstraintEvent(cb: (e: ConstraintEvent) => void): () => void {
    this.eventListeners.add(cb);
    return () => {
      this.eventListeners.delete(cb);
    };
  }

  hasViolation(severity?: ConstraintSeverity): boolean {
    for (const f of this.findings.values()) {
      if (severity && f.severity !== severity) continue;
      return true;
    }
    return false;
  }

  /**
   * 反向联动：业务动作执行前查询被该约束封锁的硬约束。
   * 仅 error 级且 spec.params.guards 包含 actionId 的 finding 会阻塞。
   */
  guard(actionId: string): { allowed: boolean; blocking: ConstraintFinding[] } {
    const blocking: ConstraintFinding[] = [];
    for (const f of this.findings.values()) {
      if (f.severity !== "error") continue;
      const spec = this.specs.get(f.specId);
      const guards = (spec?.params?.guards as string[] | undefined) ?? [];
      if (guards.includes(actionId)) blocking.push(f);
    }
    return { allowed: blocking.length === 0, blocking };
  }

  /** 序列化全部规范（证明约束可被程序解析，也便于持久化/审计）。 */
  serializeSpecs(): string {
    return JSON.stringify([...this.specs.values()], null, 2);
  }
}

function makeFinding(
  spec: ConstraintSpec,
  message: string,
  context?: Record<string, unknown>,
): ConstraintFinding {
  return {
    id: spec.id,
    specId: spec.id,
    severity: spec.severity,
    title: spec.title,
    message,
    at: Date.now(),
    context,
  };
}

/** 声明式规则求值器：all 为与、any 为或；空规则视为通过。 */
export function evaluateRule(rule: ConstraintRule, ctx: ConstraintContext): boolean {
  if (rule.all && !rule.all.every((c) => evalCond(c, ctx))) return false;
  if (rule.any && !rule.any.some((c) => evalCond(c, ctx))) return false;
  return true;
}

function getPath(ctx: ConstraintContext, path: string): unknown {
  if (path === "locale") return ctx.locale;
  if (path.startsWith("runtime.")) {
    const key = path.slice("runtime.".length);
    const rt = ctx.runtime as Record<string, unknown> | null;
    return rt ? rt[key] : undefined;
  }
  return (ctx as unknown as Record<string, unknown>)[path];
}

function evalCond(c: ConstraintCondition, ctx: ConstraintContext): boolean {
  const v = getPath(ctx, c.path);
  switch (c.op) {
    case "eq":
      return v === c.value;
    case "neq":
      return v !== c.value;
    case "in":
      return Array.isArray(c.value) && c.value.includes(v);
    case "nin":
      return Array.isArray(c.value) && !c.value.includes(v);
    case "exists":
      return v !== undefined && v !== null;
    case "matches":
      return typeof v === "string" && new RegExp(String(c.value)).test(v);
    default:
      return true;
  }
}
