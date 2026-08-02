// 总控 Agent（混合策略）纯逻辑单测：node --test --experimental-strip-types
// 直接 import 具体文件（controller.ts），不依赖 @/ 别名，可脱离 LLM 运行。

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseControllerDecision, createController, DiscussionController } from "./controller.ts";
import { DEFAULT_ORCHESTRATOR_CONFIG } from "./orchestrator-types.ts";

const PARTICIPANTS = [
  { id: "a", name: "甲" },
  { id: "b", name: "乙" },
];

/** 构造一轮决策上下文。 */
function ctx(overrides = {}) {
  return {
    round: 1,
    maxRounds: 4,
    config: DEFAULT_ORCHESTRATOR_CONFIG,
    participants: PARTICIPANTS,
    fingerprint: "本轮讨论内容",
    historyFingerprints: [],
    converged: false,
    consensusScore: 0.5,
    ...overrides,
  };
}

test("parseControllerDecision 解析四种决策", () => {
  assert.deepEqual(parseControllerDecision("DECISION: STOP\nREASON: 已收敛"), {
    action: "stop",
    reason: "已收敛",
    converged: false,
  });
  assert.deepEqual(
    parseControllerDecision(
      "DECISION: REDIRECT\nTARGET: architect\nQUESTION: 为何选A？\nREASON: r",
    ),
    { action: "redirect", targetRoleId: "architect", question: "为何选A？", reason: "r" },
  );
  assert.deepEqual(parseControllerDecision("DECISION: CLARIFY\nQUESTION: 需求边界？\nREASON: r"), {
    action: "clarify",
    question: "需求边界？",
    reason: "r",
  });
  assert.deepEqual(parseControllerDecision("DECISION: CONTINUE\nREASON: r"), {
    action: "continue",
    reason: "r",
  });
  // 残缺 REDIRECT → 退化为 continue
  assert.equal(parseControllerDecision("DECISION: REDIRECT\nREASON: 缺目标").action, "continue");
  // 无法解析 → 兜底 continue
  assert.equal(parseControllerDecision("乱七八糟").action, "continue");
});

test("确定性：收敛即停止", async () => {
  const c = new DiscussionController("deterministic", 4, 1200);
  const d = await c.decide(ctx({ round: 2, converged: true, consensusScore: 1 }));
  assert.equal(d.action, "stop");
  assert.equal(c.state.roundsExecuted, 2);
});

test("确定性：连续两轮低增量早停", async () => {
  const c = new DiscussionController("deterministic", 4, 1200);
  // 第1轮：无 prevFingerprint，增量视为 1 → continue
  let d = await c.decide(ctx({ round: 1, fingerprint: "相同内容", prevFingerprint: undefined }));
  assert.equal(d.action, "continue");
  // 第2轮：与第1轮几乎相同 → 增量低，stagnant=1 → continue
  d = await c.decide(
    ctx({
      round: 2,
      fingerprint: "相同内容",
      prevFingerprint: "相同内容",
      historyFingerprints: ["相同内容"],
    }),
  );
  assert.equal(d.action, "continue");
  // 第3轮：仍相同 → stagnant=2 → stop
  d = await c.decide(
    ctx({
      round: 3,
      fingerprint: "相同内容",
      prevFingerprint: "相同内容",
      historyFingerprints: ["相同内容", "相同内容"],
    }),
  );
  assert.equal(d.action, "stop");
  assert.match(d.reason, /无实质进展/);
});

test("确定性：跨轮重复早停", async () => {
  const c = new DiscussionController("deterministic", 4, 1200);
  await c.decide(ctx({ round: 1, fingerprint: "第1轮", prevFingerprint: undefined }));
  // 第2轮有增量（与第1轮不同）→ continue
  let d = await c.decide(
    ctx({
      round: 2,
      fingerprint: "第2轮完全不同",
      prevFingerprint: "第1轮",
      historyFingerprints: ["第1轮"],
    }),
  );
  assert.equal(d.action, "continue");
  // 第3轮指纹与「第1轮」高度相似（非相邻轮）→ 重复早停
  d = await c.decide(
    ctx({
      round: 3,
      fingerprint: "第1轮",
      prevFingerprint: "第2轮完全不同",
      historyFingerprints: ["第1轮", "第2轮完全不同"],
    }),
  );
  assert.equal(d.action, "stop");
  assert.match(d.reason, /循环/);
});

test("混合：临近上限触发一次轻量 LLM 裁定", async () => {
  let llmCalls = 0;
  const llm = async () => {
    llmCalls += 1;
    return "DECISION: STOP\nREASON: 接近上限，裁定收敛";
  };
  const c = new DiscussionController("hybrid", 4, 1200);
  // 第3轮 = maxRounds-1，未收敛 → 应调用 LLM
  const d = await c.decide(
    ctx({
      round: 3,
      fingerprint: "内容",
      prevFingerprint: "内容",
      historyFingerprints: ["内容"],
      llm,
    }),
  );
  assert.equal(llmCalls, 1);
  assert.equal(d.action, "stop");
});

test("混合：非临近上限且不胶着时不调用 LLM", async () => {
  let llmCalls = 0;
  const llm = async () => {
    llmCalls += 1;
    return "DECISION: CONTINUE\nREASON: r";
  };
  const c = new DiscussionController("hybrid", 4, 1200);
  const d = await c.decide(
    ctx({
      round: 1,
      fingerprint: "完全不相同的全新内容",
      prevFingerprint: undefined,
      historyFingerprints: [],
      llm,
    }),
  );
  assert.equal(llmCalls, 0);
  assert.equal(d.action, "continue");
});

test("LLM 故障兜底为确定性停止", async () => {
  const llm = async () => {
    throw new Error("boom");
  };
  const c = new DiscussionController("hybrid", 4, 1200);
  const d = await c.decide(
    ctx({
      round: 3,
      fingerprint: "内容",
      prevFingerprint: "内容",
      historyFingerprints: ["内容"],
      llm,
    }),
  );
  assert.equal(d.action, "stop");
  assert.match(d.reason, /兜底/);
});

test("早停估算节省 Token", async () => {
  const c = new DiscussionController("deterministic", 4, 1200);
  await c.decide(ctx({ round: 1, converged: true, consensusScore: 1 }));
  // 第1轮即收敛：节省 3 轮 × 2 参与者 × 1200 = 7200
  assert.equal(c.state.tokensSavedEstimate, 3 * 2 * 1200);
});

test("createController 工厂与状态初始化", () => {
  const c = createController("hybrid", 5, 800);
  assert.equal(c.state.mode, "hybrid");
  assert.equal(c.state.roundsPlanned, 5);
  assert.equal(c.state.tokensSavedEstimate, 0);
});
