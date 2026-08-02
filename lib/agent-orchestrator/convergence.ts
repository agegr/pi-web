// 收敛判定模块 —— 讨论轮次阈值与收敛条件
// 三种收敛条件（满足其一即停止讨论）：
//  1. arbiter_signal  —— 仲裁者给出 CONSENSUS；
//  2. stabilized       —— 连续两轮讨论指纹相似度达到阈值（观点趋于稳定）；
//  3. round_threshold  —— 达到最大轮次硬上限。
// 指纹采用字符二元组（shingle）Jaccard 相似度，对中文友好且确定性、可单测。

import type { ConvergenceState, DiscussionMessage } from "./orchestrator-types";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function shingles(s: string, k = 2): Set<string> {
  const n = normalize(s);
  const set = new Set<string>();
  if (n.length === 0) return set;
  if (n.length < k) {
    set.add(n);
    return set;
  }
  for (let i = 0; i + k <= n.length; i++) set.add(n.slice(i, i + k));
  return set;
}

/** 两轮讨论内容的相似度 0~1（Jaccard）。 */
export function similarity(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 单轮讨论指纹：该轮所有消息正文归一化拼接。 */
export function roundFingerprint(messages: DiscussionMessage[]): string {
  return normalize(messages.map((m) => m.content).join("|"));
}

export interface ConvergenceInput {
  round: number;
  maxRounds: number;
  /** 本轮讨论指纹 */
  fingerprint: string;
  /** 上一轮指纹（首轮为 undefined） */
  prevFingerprint?: string;
  stabilizeThreshold: number;
  /** 仲裁者本轮是否给出共识信号 */
  arbiterConsensus: boolean;
}

export function evaluateConvergence(input: ConvergenceInput): ConvergenceState {
  const { round, maxRounds, fingerprint, prevFingerprint, stabilizeThreshold, arbiterConsensus } =
    input;

  if (arbiterConsensus) {
    return { converged: true, reason: "arbiter_signal", round, consensusScore: 1 };
  }
  if (prevFingerprint !== undefined) {
    const sim = similarity(prevFingerprint, fingerprint);
    if (sim >= stabilizeThreshold) {
      return { converged: true, reason: "stabilized", round, consensusScore: sim };
    }
  }
  if (round >= maxRounds) {
    const sim = prevFingerprint !== undefined ? similarity(prevFingerprint, fingerprint) : 0.7;
    return { converged: true, reason: "round_threshold", round, consensusScore: sim };
  }
  return { converged: false, reason: "none", round };
}

/** 从仲裁者发言文本判断其是否给出共识信号。 */
export function arbiterSignalsConsensus(text: string): boolean {
  const head = text.trim().toUpperCase();
  return head.startsWith("CONSENSUS");
}
