// 可插拔 LLM Runner —— 讨论引擎与具体后端的边界
// 讨论引擎只依赖 AgentRunner 接口；真实后端（completeSimple）与测试用的
// Mock 都实现该接口。这样讨论调度、收敛、方案合成等核心逻辑可脱离 LLM 单测。

import type { AgentRole, DiscussionMessage } from "./orchestrator-types";

// 单轮对话补全：给定角色系统提示词与用户消息，返回模型文本。
export type LlmCompletion = (systemPrompt: string, userMessage: string) => Promise<string>;

export interface AgentTurnResult {
  content: string;
  tokens?: number;
}

export interface AgentRunner {
  /** 执行某角色在某一轮的发言。 */
  complete(
    role: AgentRole,
    systemPrompt: string,
    userMessage: string,
    round: number,
  ): Promise<AgentTurnResult>;
}

// 把讨论消息拼接为可读的上下文文本（供 runner 注入用户消息）。
export function formatTranscript(messages: DiscussionMessage[]): string {
  if (messages.length === 0) return "（尚无讨论，这是第一轮。）";
  return messages
    .map((m) => {
      const prefix =
        m.kind === "user"
          ? "【用户需求】"
          : m.kind === "arbiter"
            ? "【仲裁者】"
            : `【${m.fromName}】`;
      return `${prefix}\n${m.content}`;
    })
    .join("\n\n");
}

/**
 * 上下文压缩版 transcript（Token 优化）：
 * - 当前轮（round >= currentRound）与用户原始需求（round 0）保留全文；
 * - 更早的轮次若存在压缩摘要，则只保留一行摘要，显著降低后续轮次的上下文体积。
 * 无摘要（如重构前数据或 round 0）时回退为全文，保证向后兼容。
 */
export function formatCompactTranscript(
  messages: DiscussionMessage[],
  rounds: Array<{ round: number; summaryText?: string }>,
  currentRound: number,
): string {
  if (messages.length === 0) return "（尚无讨论，这是第一轮。）";
  const summaryByRound = new Map<number, string>();
  for (const r of rounds) {
    if (r.round < currentRound && r.summaryText) summaryByRound.set(r.round, r.summaryText);
  }
  return messages
    .map((m) => {
      if (m.round >= currentRound || m.round === 0 || !summaryByRound.has(m.round)) {
        const prefix =
          m.kind === "user"
            ? "【用户需求】"
            : m.kind === "arbiter"
              ? "【仲裁者】"
              : `【${m.fromName}】`;
        return `${prefix}\n${m.content}`;
      }
      return summaryByRound.get(m.round) as string;
    })
    .join("\n\n");
}

/** 真实后端：封装 completeSimple 的单轮补全（单一模型）。 */
export function createCompleteSimpleRunner(llm: LlmCompletion): AgentRunner {
  return {
    async complete(_role, systemPrompt, userMessage) {
      const content = await llm(systemPrompt, userMessage);
      return { content };
    },
  };
}

/**
 * 角色感知 Runner：按角色动态选择底层模型。
 * factory(role) 返回该角色对应的 LlmCompletion（由 resolveLlmForRole 构造），
 * 从而实现「每个专业领域 Agent 使用不同底层大模型」。
 */
export function createRoleAwareRunner(factory: (role: AgentRole) => LlmCompletion): AgentRunner {
  return {
    async complete(role, _systemPrompt, userMessage) {
      const llm = factory(role);
      const content = await llm(role.systemPrompt, userMessage);
      return { content };
    },
  };
}

// ---------------------------------------------------------------------------
// Mock Runner —— 确定性，用于单测讨论/收敛/合成逻辑，无需真实 LLM。
// ---------------------------------------------------------------------------
export interface MockRunnerOptions {
  /** 推荐方案数量 */
  planCount?: number;
  /** 仲裁者自该轮起返回 CONSENSUS（默认等于 maxRounds，即末轮才收敛） */
  convergeAtRound?: number;
  /** 参与者发言是否带轮次抖动（true=每轮不同，便于测试轮次阈值；false=稳定便于测试稳定收敛） */
  participantJitter?: boolean;
}

export function createMockRunner(opts: MockRunnerOptions = {}): AgentRunner {
  const planCount = opts.planCount ?? 2;
  const convergeAtRound = opts.convergeAtRound ?? Number.MAX_SAFE_INTEGER;
  const jitter = opts.participantJitter ?? true;

  return {
    async complete(role, _systemPrompt, _userMessage, round) {
      if (role.kind === "arbiter") {
        const reached = round >= convergeAtRound;
        const body = reached
          ? "核心分歧已收敛，关键决策已有明确倾向。"
          : "在架构选型与范围边界上仍存在明显分歧，需继续讨论。";
        return { content: `${reached ? "CONSENSUS" : "NO_CONSENSUS"} ${body}` };
      }
      if (role.kind === "synthesizer") {
        const plans = Array.from({ length: planCount }, (_, i) => ({
          title: `推荐方案 ${i + 1}`,
          summary: `这是第 ${i + 1} 套相互独立的方案，侧重不同权衡。`,
          pros: [`优点 ${i + 1}-1`, `优点 ${i + 1}-2`],
          cons: [`风险 ${i + 1}-1`],
          scenarios: [`适用场景 ${i + 1}`],
          confidence: Math.round((0.6 + i * 0.15) * 100) / 100,
        }));
        return { content: JSON.stringify(plans) };
      }
      const tail = jitter ? `（第${round}轮新见解）` : "";
      return {
        content: `[${role.name}] 第${round}轮：从本专业视角审视需求，提出关键判断与待澄清问题。${tail}`,
      };
    },
  };
}
