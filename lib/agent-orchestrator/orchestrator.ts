// 多 Agent 协同编排器（门面 + 生命周期管理）
// 串联四大模块：需求解析 → 多轮讨论（事件驱动/消息队列）→ 收敛 → 方案合成 →
// 交互确认 → 任务拆解。编排器是单次讨论的运行时实例，挂在 globalThis 注册表上，
// 供 API 路由（start/confirm）与 SSE（事件流）跨请求访问。

import type {
  AgentInstance,
  AgentRole,
  ConvergenceState,
  DiscussionMessage,
  IntentParseResult,
  OrchestrationSnapshot,
  OrchestrationStatus,
  OrchestratorConfig,
  OrchestratorEvent,
  RecommendationPlan,
  RoundSummary,
  OrchestratedTask,
} from "./orchestrator-types";
import { DEFAULT_ORCHESTRATOR_CONFIG } from "./orchestrator-types";
import { getRole } from "./role-library";
import { parseIntentHeuristic, INTENT_SYSTEM_PROMPT } from "./intent-parser";
import type { AgentRunner, LlmCompletion } from "./runner";
import { createMockRunner, formatCompactTranscript } from "./runner";
import { arbiterSignalsConsensus, evaluateConvergence, roundFingerprint } from "./convergence";
import { createController, type DiscussionController } from "./controller";
import { log } from "../engine-logger";
import { saveOrchestratorSnapshot, loadAllOrchestratorSnapshots } from "./persistence";
import { buildSynthesisUserMessage, parseRecommendationPlans } from "./plan-synthesizer";
import type { ConfirmPayload } from "./task-scheduler";
import { buildConfirmPayload, decomposePlanHeuristic } from "./task-scheduler";

export interface OrchestratorOptions {
  requirement: string;
  cwd?: string;
  config?: Partial<OrchestratorConfig>;
  /** 注入自定义 runner；默认使用确定性 Mock（便于无 LLM 环境运行/测试）。 */
  runner?: AgentRunner;
  /** 是否用 LLM 解析意图（需 runner 支持 completeSimple）；默认启发式。 */
  useLlmIntent?: boolean;
  /** 总控 LLM 控制器（轻量模型单次补全），用于 hybrid/llm 模式的裁定/追问/澄清。缺省时降级为确定性调度。 */
  controllerLlm?: LlmCompletion;
}

type Listener = (e: OrchestratorEvent) => void;

let orchSeq = 0;
function nextId(): string {
  orchSeq += 1;
  return `orch_${Date.now().toString(36)}_${orchSeq}`;
}

// 角色必须存在；缺失时抛错而非静默返回 undefined。
function requireRole(id: string): AgentRole {
  const r = getRole(id);
  if (!r) throw new Error(`缺少角色定义：${id}`);
  return r;
}

// 由一轮消息确定性派生压缩摘要（零额外 Token），用于后续轮次的上下文压缩。
function summarizeRound(round: number, messages: DiscussionMessage[]): string {
  const parts = messages
    .filter((m) => m.kind !== "system")
    .map((m) => {
      const name = m.kind === "user" ? "用户" : m.kind === "arbiter" ? "仲裁者" : m.fromName;
      const snippet = m.content.replace(/\s+/g, " ").trim().slice(0, 140);
      return `${name}：${snippet}`;
    });
  return `【第${round}轮摘要】${parts.join("；")}`;
}

// 构造某参与者本轮的用户消息（需求 + 讨论上下文 + 本轮指令）。
function buildParticipantUserMessage(
  requirement: string,
  transcript: string,
  round: number,
  role: AgentRole,
): string {
  return (
    `用户原始需求：\n${requirement}\n\n` +
    `前序讨论记录：\n${transcript}\n\n` +
    `现在是第 ${round} 轮讨论。请作为【${role.name}】，基于以上信息给出你本轮的` +
    "专业判断：认可哪些观点、反对哪些并提出替代、指出关键风险与待澄清问题。"
  );
}

export class AgentOrchestrator {
  readonly id: string;
  requirement: string;
  cwd?: string;
  config: OrchestratorConfig;
  private runner: AgentRunner;

  status: OrchestrationStatus = "idle";
  intent?: IntentParseResult;
  agents: AgentInstance[] = [];
  messages: DiscussionMessage[] = [];
  rounds: RoundSummary[] = [];
  convergence: ConvergenceState = { converged: false, reason: "none", round: 0 };
  plans: RecommendationPlan[] = [];
  selectedPlanId?: string;
  tasks: OrchestratedTask[] = [];
  error?: string;
  updatedAt = Date.now();

  /** 总控定向追问（仅生效一轮）：指定角色在下一轮收到该问题。 */
  private pendingRedirect?: { targetRoleId: string; question: string };
  /** 总控澄清问题（awaiting_clarify 时展示，引导用户提供反馈）。 */
  clarifyQuestion?: string;

  private listeners = new Set<Listener>();
  private msgSeq = 0;
  private running = false;
  private controller: DiscussionController;
  private controllerLlm?: LlmCompletion;

  constructor(opts: OrchestratorOptions) {
    this.id = nextId();
    this.requirement = opts.requirement;
    this.cwd = opts.cwd;
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...(opts.config ?? {}) };
    this.runner = opts.runner ?? createMockRunner({ planCount: this.config.planCount });
    this.useLlmIntent = opts.useLlmIntent ?? false;
    this.controllerLlm = opts.controllerLlm;
    this.controller = createController(
      this.config.controllerMode,
      this.config.maxRounds,
      this.config.estimatedTokensPerTurn,
    );
  }

  private useLlmIntent: boolean;

  // --- 订阅 / 快照 ---------------------------------------------------------
  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: OrchestratorEvent): void {
    this.updatedAt = e.at;
    for (const cb of this.listeners) cb(e);
  }

  private setStatus(status: OrchestrationStatus): void {
    this.status = status;
    // 进入终态时同步释放运行锁，使「状态事件」与「running 标志」保持一致，
    // 避免订阅者在收到 awaiting_confirm 后立刻调用 rediscuss 仍命中 running===true 而被拒。
    if (
      status === "awaiting_confirm" ||
      status === "awaiting_clarify" ||
      status === "failed" ||
      status === "done" ||
      status === "cancelled"
    ) {
      this.running = false;
    }
    this.emit({ type: "status", status, at: Date.now() });
    this.persist();
  }

  /** 把当前快照原子落盘，确保刷新/重启/空闲清除后可恢复（best-effort）。 */
  private persist(): void {
    try {
      saveOrchestratorSnapshot(this.getSnapshot());
    } catch {
      // 持久化失败不阻断讨论。
    }
  }

  getSnapshot(): OrchestrationSnapshot {
    return {
      id: this.id,
      status: this.status,
      requirement: this.requirement,
      cwd: this.cwd,
      config: this.config,
      intent: this.intent,
      agents: this.agents,
      messages: this.messages,
      rounds: this.rounds,
      convergence: this.convergence,
      plans: this.plans,
      selectedPlanId: this.selectedPlanId,
      tasks: this.tasks,
      control: this.controller?.state,
      clarifyQuestion: this.clarifyQuestion,
      error: this.error,
      updatedAt: this.updatedAt,
    };
  }

  // --- 生命周期：创建 / 运行 / 取消 / 重新讨论 -----------------------------
  /** 启动完整流水线（fire-and-forget，事件经 SSE 推送）。 */
  start(): void {
    if (this.running) return;
    void this.run();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    log("info", "orchestrator", `开始讨论编排（总控模式=${this.config.controllerMode}）`, {
      orchestratorId: this.id,
    });
    try {
      await this.parseIntent();
      await this.instantiateAgents();
      await this.runDiscussion(1);
      await this.synthesize();
      this.setStatus("awaiting_confirm");
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      log("error", "orchestrator", `讨论编排失败：${this.error}`, { orchestratorId: this.id });
      this.setStatus("failed");
      this.emit({ type: "error", message: this.error, at: Date.now() });
    } finally {
      this.running = false;
    }
  }

  /** 模块一：需求接收与解析 —— 提取意图并动态实例化角色。 */
  private async parseIntent(): Promise<void> {
    this.setStatus("parsing");
    let intent: IntentParseResult;
    if (this.useLlmIntent) {
      try {
        const res = await this.runner.complete(
          {
            id: "intent",
            name: "意图解析",
            kind: "participant",
            expertise: [],
            color: "slate",
            blurb: "",
            systemPrompt: INTENT_SYSTEM_PROMPT,
          },
          INTENT_SYSTEM_PROMPT,
          `需求：${this.requirement}`,
          0,
        );
        intent = this.parseIntentFromLlm(res.content);
      } catch {
        intent = parseIntentHeuristic(this.requirement);
      }
    } else {
      intent = parseIntentHeuristic(this.requirement);
    }
    this.intent = intent;
    this.emit({ type: "intent", intent, at: Date.now() });
    // 记录用户原始需求为第 0 轮消息。
    this.pushMessage({
      round: 0,
      from: "user",
      fromName: "用户",
      kind: "user",
      content: this.requirement,
    });
  }

  private parseIntentFromLlm(raw: string): IntentParseResult {
    try {
      const obj = JSON.parse(raw.replace(/^```(?:json)?|```$/gi, "").trim()) as {
        summary?: string;
        keywords?: string[];
        tags?: string[];
      };
      const tags = (obj.tags ?? []).filter(Boolean).slice(0, 5) as IntentParseResult["tags"];
      const base = parseIntentHeuristic(this.requirement);
      return {
        summary: obj.summary?.trim() || base.summary,
        keywords: obj.keywords ?? base.keywords,
        tags: tags.length ? tags : base.tags,
        selectedRoleIds: base.selectedRoleIds,
        confidence: Math.min(1, base.confidence + 0.1),
      };
    } catch {
      return parseIntentHeuristic(this.requirement);
    }
  }

  /** 依据意图动态实例化参与者 + 框架角色（仲裁者/合成者）。 */
  private async instantiateAgents(): Promise<void> {
    const participantIds = this.intent?.selectedRoleIds ?? [];
    const frameworkIds = ["arbiter", "synthesizer"];
    const allIds = [...participantIds, ...frameworkIds];
    for (const roleId of allIds) {
      const role = getRole(roleId);
      if (!role) continue;
      const agent: AgentInstance = {
        id: `${roleId}`,
        roleId: role.id,
        roleName: role.name,
        kind: role.kind,
        color: role.color,
        status: "pending",
        joinedRound: 0,
      };
      this.agents.push(agent);
      this.emit({ type: "agent.joined", agent, at: Date.now() });
    }
  }

  private agentByRole(roleId: string): AgentInstance | undefined {
    return this.agents.find((a) => a.roleId === roleId);
  }

  /** 模块二 + 收敛：多轮讨论（事件驱动），由总控 Agent 管控节奏与轮数、避免无效讨论。 */
  private async runDiscussion(startRound = 1): Promise<void> {
    this.setStatus("discussing");
    const participants = this.agents.filter((a) => a.kind === "participant");
    const arbiter = this.agentByRole("arbiter");
    const priorRounds = this.rounds;
    let prevFingerprint: string | undefined =
      priorRounds.length > 0 ? priorRounds[priorRounds.length - 1].fingerprint : undefined;

    for (let round = startRound; round <= this.config.maxRounds; round++) {
      this.emit({ type: "round.start", round, at: Date.now() });
      log("info", "orchestrator", `第 ${round}/${this.config.maxRounds} 轮讨论开始`, {
        orchestratorId: this.id,
      });
      const roundMsgIds: string[] = [];
      const speakers: string[] = [];

      if (this.config.concurrency > 1) {
        await Promise.all(
          participants.map((agent) => this.runParticipantTurn(agent, round, roundMsgIds, speakers)),
        );
      } else {
        for (const agent of participants) {
          await this.runParticipantTurn(agent, round, roundMsgIds, speakers);
        }
      }

      const roundMessages = this.messages.filter((m) => m.round === round);
      const fingerprint = roundFingerprint(roundMessages);
      const summary: RoundSummary = {
        round,
        messageIds: roundMsgIds,
        speakers,
        fingerprint,
        summaryText: summarizeRound(round, roundMessages),
      };

      // 仲裁者收敛判定。
      let arbiterConsensus = false;
      if (arbiter) {
        arbiter.status = "thinking";
        const transcript = formatCompactTranscript(this.messages, this.rounds, round);
        const res = await this.runner.complete(
          requireRole("arbiter"),
          requireRole("arbiter").systemPrompt,
          `第 ${round} 轮讨论记录：\n${transcript}\n\n请给出本轮共识度与 CONSENSUS/NO_CONSENSUS 结论。`,
          round,
        );
        arbiterConsensus = arbiterSignalsConsensus(res.content);
        summary.arbiterConsensus = arbiterConsensus;
        this.pushMessage({
          round,
          from: "arbiter",
          fromName: "仲裁者",
          kind: "arbiter",
          content: res.content,
        });
        arbiter.status = "responded";
      }

      const conv = evaluateConvergence({
        round,
        maxRounds: this.config.maxRounds,
        fingerprint,
        prevFingerprint,
        stabilizeThreshold: this.config.stabilizeThreshold,
        arbiterConsensus,
      });
      this.convergence = conv;
      this.rounds.push(summary);
      this.emit({ type: "round.end", summary, convergence: conv, at: Date.now() });
      this.persist();

      // 总控决策：早停 / 收敛 / 定向追问 / 澄清。
      const decision = await this.controller.decide({
        round,
        maxRounds: this.config.maxRounds,
        config: this.config,
        participants: participants.map((p) => ({ id: p.roleId, name: p.roleName })),
        fingerprint,
        prevFingerprint,
        historyFingerprints: this.rounds.filter((r) => r.round < round).map((r) => r.fingerprint),
        converged: conv.converged,
        consensusScore: conv.consensusScore ?? 0,
        llm: this.controllerLlm,
      });
      this.emit({ type: "controller.decision", decision, round, at: Date.now() });
      log("info", "orchestrator", `总控决策：${decision.action}（${decision.reason}）`, {
        orchestratorId: this.id,
        round,
      });

      if (decision.action === "stop") {
        log(
          "info",
          "orchestrator",
          `讨论提前停止，预计节省约 ${this.controller.state.tokensSavedEstimate} Token`,
          {
            orchestratorId: this.id,
          },
        );
        break;
      }
      if (decision.action === "clarify") {
        this.clarifyQuestion = decision.question;
        log("info", "orchestrator", `总控请求澄清：${decision.question}`, {
          orchestratorId: this.id,
        });
        this.setStatus("awaiting_clarify");
        return;
      }
      if (decision.action === "redirect") {
        this.pendingRedirect = { targetRoleId: decision.targetRoleId, question: decision.question };
        log("info", "orchestrator", `总控定向追问 ${decision.targetRoleId}：${decision.question}`, {
          orchestratorId: this.id,
        });
      }
      prevFingerprint = fingerprint;
    }

    for (const a of this.agents)
      if (a.status === "responded" || a.status === "thinking") a.status = "done";
  }

  private async runParticipantTurn(
    agent: AgentInstance,
    round: number,
    roundMsgIds: string[],
    speakers: string[],
  ): Promise<void> {
    const role = getRole(agent.roleId);
    if (!role) return;
    agent.status = "thinking";
    this.emit({ type: "agent.thinking", agentId: agent.id, round, at: Date.now() });
    const transcript = formatCompactTranscript(this.messages, this.rounds, round);
    let userMessage = buildParticipantUserMessage(this.requirement, transcript, round, role);
    // 总控定向追问：仅对目标角色生效一轮。
    if (this.pendingRedirect && this.pendingRedirect.targetRoleId === agent.roleId) {
      userMessage += `\n\n【总控定向追问】${this.pendingRedirect.question}`;
      this.pendingRedirect = undefined;
    }
    const res = await this.runner.complete(role, role.systemPrompt, userMessage, round);
    const msg = this.pushMessage({
      round,
      from: agent.roleId,
      fromName: agent.roleName,
      kind: "agent",
      content: res.content,
    });
    agent.status = "responded";
    agent.lastMessageId = msg.id;
    agent.tokens = (agent.tokens ?? 0) + (res.tokens ?? 0);
    roundMsgIds.push(msg.id);
    speakers.push(agent.roleId);
  }

  /** 模块三：方案生成 —— 共识转化为多个独立推荐方案。 */
  private async synthesize(): Promise<void> {
    this.setStatus("synthesizing");
    const synthesizer = this.agentByRole("synthesizer");
    if (synthesizer) synthesizer.status = "thinking";
    const transcript = formatCompactTranscript(
      this.messages,
      this.rounds,
      this.rounds.length ? this.rounds[this.rounds.length - 1].round : 0,
    );
    const res = await this.runner.complete(
      requireRole("synthesizer"),
      requireRole("synthesizer").systemPrompt,
      buildSynthesisUserMessage(this.requirement, transcript, this.config.planCount),
      0,
    );
    const plans = parseRecommendationPlans(res.content, this.config.planCount);
    this.plans = plans;
    if (synthesizer) synthesizer.status = "done";
    this.emit({ type: "plans", plans, at: Date.now() });
    this.persist();
  }

  // --- 交互确认（模块三闭环） ---------------------------------------------
  /** 用户选择某方案（交互闭环：选择）。 */
  selectPlan(planId: string): void {
    this.selectedPlanId = planId;
  }

  /** 模块四：任务执行前置 —— 拆解确认方案为有序任务，返回引擎载荷。 */
  prepareTasks(planId?: string): ConfirmPayload {
    const id = planId ?? this.selectedPlanId ?? this.plans[0]?.id;
    const plan = this.plans.find((p) => p.id === id);
    if (!plan) throw new Error("未找到选中的方案");
    this.selectedPlanId = plan.id;
    const tasks = decomposePlanHeuristic(plan);
    this.tasks = tasks;
    this.emit({ type: "task.changed", tasks, at: Date.now() });
    return buildConfirmPayload(this.requirement, plan, this.cwd ?? "", tasks);
  }

  /** 标记执行阶段完成（由 API 路由在 createChange+startRun 后调用）。 */
  markExecuting(): void {
    this.setStatus("executing");
  }

  markDone(): void {
    this.setStatus("done");
    this.emit({ type: "done", snapshot: this.getSnapshot(), at: Date.now() });
  }

  /**
   * 退回重议（交互闭环：退回）—— 增量重议：保留历史讨论与已实例化角色，
   * 将用户反馈作为新的约束（用户消息）注入，由总控从下一轮续跑，避免重复消费。
   */
  async rediscuss(feedback: string): Promise<void> {
    if (this.running) return;
    this.error = undefined;
    this.clarifyQuestion = undefined;
    this.plans = [];
    this.tasks = [];
    this.selectedPlanId = undefined;
    const nextRound = this.rounds.length + 1;
    this.pushMessage({
      round: nextRound,
      from: "user",
      fromName: "用户",
      kind: "user",
      content: `【修改意见】${feedback}`,
    });
    this.convergence = { converged: false, reason: "none", round: this.rounds.length };
    this.running = true;
    this.status = "discussing";
    log("info", "orchestrator", `增量重议：注入反馈并续跑（从第 ${nextRound} 轮）`, {
      orchestratorId: this.id,
    });
    try {
      await this.runDiscussion(nextRound);
      await this.synthesize();
      this.setStatus("awaiting_confirm");
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      log("error", "orchestrator", `增量重议失败：${this.error}`, { orchestratorId: this.id });
      this.setStatus("failed");
      this.emit({ type: "error", message: this.error, at: Date.now() });
    } finally {
      this.running = false;
    }
  }

  cancel(): void {
    this.setStatus("cancelled");
  }

  // --- 内部工具 -------------------------------------------------------------
  private pushMessage(partial: Omit<DiscussionMessage, "id" | "at">): DiscussionMessage {
    this.msgSeq += 1;
    const msg: DiscussionMessage = {
      id: `msg_${this.id}_${this.msgSeq}`,
      at: Date.now(),
      ...partial,
    };
    this.messages.push(msg);
    this.emit({ type: "message", message: msg, at: msg.at });
    return msg;
  }

  /** 从快照还原（恢复全部状态；running 复位为 false，可继续交互 / 重新讨论）。 */
  static fromSnapshot(snap: OrchestrationSnapshot): AgentOrchestrator {
    const runner =
      runnerFactory && snap.cwd !== undefined
        ? runnerFactory(snap.cwd)
        : createMockRunner({ planCount: snap.config?.planCount ?? 2 });
    const orch = new AgentOrchestrator({
      requirement: snap.requirement,
      cwd: snap.cwd,
      config: snap.config,
      runner,
    });
    orch.status = snap.status;
    orch.intent = snap.intent;
    orch.agents = snap.agents;
    orch.messages = snap.messages;
    orch.rounds = snap.rounds;
    orch.convergence = snap.convergence;
    orch.plans = snap.plans;
    orch.selectedPlanId = snap.selectedPlanId;
    orch.tasks = snap.tasks;
    orch.error = snap.error;
    orch.clarifyQuestion = snap.clarifyQuestion;
    orch.updatedAt = snap.updatedAt;
    orch.msgSeq = snap.messages.length;
    orch.controller = createController(
      snap.config.controllerMode,
      snap.config.maxRounds,
      snap.config.estimatedTokensPerTurn,
    );
    if (snap.control) Object.assign(orch.controller.state, snap.control);
    orch.running = false;
    return orch;
  }
}

// ---------------------------------------------------------------------------
// 持久化恢复：进程重启 / 刷新后从磁盘 rehydrate 进内存注册表
// ---------------------------------------------------------------------------
// 服务器侧运行时会通过 setOrchestratorRunnerFactory 注入「真实角色感知 runner 工厂」，
// 使 rehydrate 出的编排器可继续真实讨论；未注入时回退为 Mock（安全，仅用于展示）。
type OrchestratorRunnerFactory = (cwd?: string) => AgentRunner;
let runnerFactory: OrchestratorRunnerFactory | undefined;

export function setOrchestratorRunnerFactory(factory: OrchestratorRunnerFactory): void {
  runnerFactory = factory;
}

let rehydrated = false;
function ensureRehydrated(): void {
  if (rehydrated) return;
  rehydrated = true;
  try {
    for (const rec of loadAllOrchestratorSnapshots()) {
      if (!registry().has(rec.id)) {
        registry().set(
          rec.id,
          AgentOrchestrator.fromSnapshot(rec.snapshot as OrchestrationSnapshot),
        );
      }
    }
  } catch {
    // best-effort：恢复失败不阻断主流程。
  }
}

// ---------------------------------------------------------------------------
// globalThis 注册表（跨请求 / 热重载存活）
// ---------------------------------------------------------------------------
declare global {
  var __piOrchestrators: Map<string, AgentOrchestrator> | undefined;
}

function registry(): Map<string, AgentOrchestrator> {
  if (!globalThis.__piOrchestrators) globalThis.__piOrchestrators = new Map();
  return globalThis.__piOrchestrators;
}

export function createOrchestrator(opts: OrchestratorOptions): AgentOrchestrator {
  const orch = new AgentOrchestrator(opts);
  registry().set(orch.id, orch);
  return orch;
}

export function getOrchestrator(id: string): AgentOrchestrator | undefined {
  ensureRehydrated();
  return registry().get(id);
}

export function listOrchestrators(): AgentOrchestrator[] {
  ensureRehydrated();
  return [...registry().values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function latestOrchestrator(): AgentOrchestrator | undefined {
  return listOrchestrators()[0];
}

export function disposeOrchestrator(id: string): void {
  registry().delete(id);
}
