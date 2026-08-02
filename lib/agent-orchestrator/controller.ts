// 总控 Agent（混合策略）—— 管控讨论节奏与轮数，避免无效讨论浪费 Token
// 纯逻辑模块（node --test 可直连此文件单测），仅依赖 convergence 的相似度与类型，
// 不引入 pi SDK，可脱离 LLM 运行。
//
// 决策策略（mode）：
//  - deterministic：纯规则（收敛分 / 信息增量 / 跨轮重复），零额外 Token；
//  - llm：每轮调用一次轻量 LLM 控制器裁定（最智能、Token 略高）；
//  - hybrid（默认）：以确定性调度为主，仅当「临近轮数上限或分数胶着」时调用一次
//    轻量 LLM 控制器做最终裁定 / 定向追问 / 澄清请求，平衡智能与省 Token。

import { similarity } from "./convergence";
import type {
  ControllerDecision,
  ControllerMode,
  ControllerState,
  OrchestratorConfig,
} from "./orchestrator-types";

/** 控制器每轮决策所需的上下文（由编排器在每轮结束后填充）。 */
export interface ControllerContext {
  round: number;
  maxRounds: number;
  config: OrchestratorConfig;
  /** 参与者角色（用于估算节省 Token 与 redirect 目标校验）。 */
  participants: Array<{ id: string; name: string }>;
  /** 本轮讨论指纹（与 convergence.roundFingerprint 一致）。 */
  fingerprint: string;
  /** 上一轮指纹（首轮为 undefined）。 */
  prevFingerprint?: string;
  /** 本轮之前所有轮的指纹（用于跨轮重复检测）。 */
  historyFingerprints: string[];
  /** 收敛判定结果（来自 convergence.evaluateConvergence）。 */
  converged: boolean;
  consensusScore: number;
  /** 可选轻量 LLM 控制器（cheap 模型单次补全）。 */
  llm?: (systemPrompt: string, userMessage: string) => Promise<string>;
}

const CONTROLLER_SYSTEM_PROMPT =
  "你是多智能体讨论的【总控】。你不直接贡献方案，只基于已有讨论判断是否继续、收敛、追问或要求澄清。\n" +
  "请严格按以下格式输出（不要多余说明）：\n" +
  "DECISION: <STOP|REDIRECT|CLARIFY|CONTINUE>\n" +
  "TARGET: <仅当 REDIRECT 时填角色 id>\n" +
  "QUESTION: <仅当 REDIRECT 或 CLARIFY 时填，给该角色或用户的具体问题>\n" +
  "REASON: <一句话理由>\n" +
  "判断准则：若核心分歧已收敛则用 STOP；若仅某角色能推进关键分歧用 REDIRECT+TARGET；" +
  "若需求本身含糊、缺关键信息则 CLARIFY；否则 CONTINUE。";

/** 从 LLM 控制器文本解析结构化决策（失败返回 continue 兜底）。 */
export function parseControllerDecision(text: string): ControllerDecision {
  const raw = text.trim();
  const decisionLine = raw.match(/DECISION:\s*(STOP|REDIRECT|CLARIFY|CONTINUE)/i);
  const action = (decisionLine?.[1] ?? "CONTINUE").toUpperCase() as
    "STOP" | "REDIRECT" | "CLARIFY" | "CONTINUE";
  const reason = raw.match(/REASON:\s*(.+)/i)?.[1]?.trim() || "总控未给出明确理由";
  const target = raw.match(/TARGET:\s*(\S+)/i)?.[1]?.trim();
  const question = raw.match(/QUESTION:\s*(.+)/i)?.[1]?.trim();

  switch (action) {
    case "STOP":
      return { action: "stop", reason, converged: false };
    case "REDIRECT":
      if (target && question) return { action: "redirect", targetRoleId: target, question, reason };
      return { action: "continue", reason: "REDIRECT 缺目标或问题，退化为继续" };
    case "CLARIFY":
      if (question) return { action: "clarify", question, reason };
      return { action: "continue", reason: "CLARIFY 缺问题，退化为继续" };
    default:
      return { action: "continue", reason };
  }
}

export class DiscussionController {
  readonly state: ControllerState;
  private history: string[] = [];
  private stagnantRounds = 0;
  private estimatedTokensPerTurn: number;

  constructor(mode: ControllerMode, maxRounds: number, estimatedTokensPerTurn: number) {
    this.estimatedTokensPerTurn = estimatedTokensPerTurn;
    this.state = {
      mode,
      roundsPlanned: maxRounds,
      roundsExecuted: 0,
      tokensSavedEstimate: 0,
      decisions: [],
      stagnantRounds: 0,
    };
  }

  private deterministicDecision(ctx: ControllerContext): ControllerDecision {
    if (ctx.converged) {
      return { action: "stop", reason: "已达收敛（仲裁共识/稳定/上限）", converged: ctx.converged };
    }
    if (this.stagnantRounds >= 2) {
      return {
        action: "stop",
        reason: `连续 ${this.stagnantRounds} 轮信息增量过低，讨论已无实质进展`,
        converged: false,
      };
    }
    // 跨轮重复：本轮指纹与更早（非上一轮）某轮高度相似 → 原地踏步。
    const repetition = this.repetitionOf(ctx.fingerprint, ctx.historyFingerprints);
    if (repetition >= ctx.config.repetitionThreshold) {
      return {
        action: "stop",
        reason: `检测到跨轮重复（相似度 ${repetition.toFixed(2)}），讨论陷入循环`,
        converged: false,
      };
    }
    return { action: "continue", reason: "仍有信息增量，继续讨论" };
  }

  /** 当前指纹与历史非相邻轮的最大相似度（识别循环踏步）。 */
  private repetitionOf(fingerprint: string, history: string[]): number {
    let max = 0;
    // history 已含本轮之前所有轮；跳过「最近一轮」（它是相邻轮，由增量判定处理）。
    for (let i = 0; i < history.length - 1; i++) {
      const sim = similarity(history[i], fingerprint);
      if (sim > max) max = sim;
    }
    return max;
  }

  /** 执行一轮决策（异步以容纳可选 LLM 调用）。返回结构化决策。 */
  async decide(ctx: ControllerContext): Promise<ControllerDecision> {
    this.state.roundsExecuted = ctx.round;
    this.history = [...ctx.historyFingerprints, ctx.fingerprint];

    const infoIncrement =
      ctx.prevFingerprint !== undefined ? 1 - similarity(ctx.prevFingerprint, ctx.fingerprint) : 1;
    if (infoIncrement < ctx.config.infoDeltaThreshold) this.stagnantRounds += 1;
    else this.stagnantRounds = 0;
    this.state.stagnantRounds = this.stagnantRounds;

    let decision: ControllerDecision = this.deterministicDecision(ctx);

    // 混合模式：临近上限或胶着时，调用一次轻量 LLM 控制器做最终裁定/追问/澄清。
    const nearLimit = ctx.round >= ctx.maxRounds - 1 && !ctx.converged;
    const stuck = this.stagnantRounds >= 2;
    if (
      (this.state.mode === "hybrid" && (nearLimit || stuck) && decision.action === "continue") ||
      this.state.mode === "llm"
    ) {
      if (ctx.llm) {
        try {
          const prompt =
            `第 ${ctx.round}/${ctx.maxRounds} 轮结束。共识度 ${ctx.consensusScore.toFixed(2)}，` +
            `信息增量 ${infoIncrement.toFixed(2)}，胶着轮数 ${this.stagnantRounds}。` +
            `参与者：${ctx.participants.map((p) => p.name).join("、")}。`;
          const res = await ctx.llm(CONTROLLER_SYSTEM_PROMPT, prompt);
          const llmDecision = parseControllerDecision(res);
          // 收敛或触顶时，LLM 仍判 CONTINUE 也强制 STOP，严守轮数上限。
          if (llmDecision.action === "continue" && (nearLimit || ctx.converged)) {
            decision = {
              action: "stop",
              reason: "已达轮数上限/收敛，强制停止",
              converged: ctx.converged,
            };
          } else {
            decision = llmDecision;
          }
        } catch {
          // LLM 故障：兜底为确定性决策，绝不拖垮讨论。
          if (decision.action === "continue") {
            decision = {
              action: "stop",
              reason: "LLM 控制器不可用，按确定性兜底停止",
              converged: ctx.converged,
            };
          }
        }
      }
    }

    // 早停时估算节省 Token（未执行的轮次 × 参与者 × 单轮单角色预估）。
    if (decision.action === "stop") {
      const savedRounds = Math.max(0, ctx.maxRounds - ctx.round);
      this.state.tokensSavedEstimate =
        savedRounds * ctx.participants.length * this.estimatedTokensPerTurn;
    }

    this.state.lastDecision = decision;
    this.state.decisions.push(decision);
    return decision;
  }
}

/** 工厂：按模式构造控制器。 */
export function createController(
  mode: ControllerMode,
  maxRounds: number,
  estimatedTokensPerTurn = 1200,
): DiscussionController {
  return new DiscussionController(mode, maxRounds, estimatedTokensPerTurn);
}
