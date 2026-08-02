// 多 Agent 协同编排核心逻辑单测（node:test，脱 LLM，使用 Mock runner）。
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 持久化现在会在 status/round.end/plans 处落盘，隔离到临时目录避免污染真实 agentDir。
const __orchTmp = mkdtempSync(join(tmpdir(), "pi-orch-"));
process.env.PI_CODING_AGENT_DIR = __orchTmp;
process.once("exit", () => {
  try {
    rmSync(__orchTmp, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function load() {
  // 直接加载纯逻辑模块（避开 index.ts 对 llm-backend 的 re-export，
  // 后者依赖 @/ 路径别名，纯 Node 运行时无法解析）。
  const [o, r, i, c, p, t] = await Promise.all([
    import("./orchestrator.ts"),
    import("./runner.ts"),
    import("./intent-parser.ts"),
    import("./convergence.ts"),
    import("./plan-synthesizer.ts"),
    import("./task-scheduler.ts"),
  ]);
  return { ...o, ...r, ...i, ...c, ...p, ...t };
}

test("意图解析：关键词命中相关领域并动态实例化角色", async () => {
  const { parseIntentHeuristic, selectRolesFromTags } = await load();
  const intent = parseIntentHeuristic("我们需要一个前端页面，带登录鉴权和数据库存储");
  assert.ok(intent.tags.includes("frontend"));
  assert.ok(intent.tags.includes("security"));
  assert.ok(intent.tags.includes("data"));
  const roles = selectRolesFromTags(intent.tags);
  assert.ok(roles.includes("product")); // 基线角色
  assert.ok(roles.includes("architect")); // 基线角色
  assert.ok(roles.includes("frontend"));
  assert.ok(roles.includes("security"));
});

test("意图解析：空需求仍返回基线角色，不抛错", async () => {
  const { parseIntentHeuristic } = await load();
  const intent = parseIntentHeuristic("");
  assert.equal(intent.selectedRoleIds.includes("product"), true);
  assert.equal(intent.selectedRoleIds.includes("architect"), true);
});

test("收敛判定：仲裁者信号优先收敛", async () => {
  const { evaluateConvergence, arbiterSignalsConsensus } = await load();
  assert.equal(arbiterSignalsConsensus("CONSENSUS 已达成一致"), true);
  assert.equal(arbiterSignalsConsensus("NO_CONSENSUS 仍有分歧"), false);
  const c = evaluateConvergence({
    round: 2,
    maxRounds: 4,
    fingerprint: "a",
    prevFingerprint: "b",
    stabilizeThreshold: 0.85,
    arbiterConsensus: true,
  });
  assert.equal(c.converged, true);
  assert.equal(c.reason, "arbiter_signal");
});

test("收敛判定：达到轮次上限即收敛", async () => {
  const { evaluateConvergence } = await load();
  const c = evaluateConvergence({
    round: 4,
    maxRounds: 4,
    fingerprint: "x",
    prevFingerprint: "y",
    stabilizeThreshold: 0.85,
    arbiterConsensus: false,
  });
  assert.equal(c.converged, true);
  assert.equal(c.reason, "round_threshold");
});

test("收敛判定：相似度达阈值判定稳定收敛", async () => {
  const { evaluateConvergence, roundFingerprint, similarity } = await load();
  const a = roundFingerprint([
    {
      content: "前端应做组件拆分",
      round: 1,
      from: "f",
      fromName: "前端",
      kind: "agent",
      id: "1",
      at: 0,
    },
  ]);
  const b = roundFingerprint([
    {
      content: "前端应做组件拆分",
      round: 2,
      from: "f",
      fromName: "前端",
      kind: "agent",
      id: "2",
      at: 0,
    },
  ]);
  assert.ok(similarity(a, b) >= 0.85);
  const c = evaluateConvergence({
    round: 3,
    maxRounds: 4,
    fingerprint: b,
    prevFingerprint: a,
    stabilizeThreshold: 0.85,
    arbiterConsensus: false,
  });
  assert.equal(c.converged, true);
  assert.equal(c.reason, "stabilized");
});

test("方案解析：JSON 输出被正确解析为结构化方案", async () => {
  const { parseRecommendationPlans } = await load();
  const raw = JSON.stringify([
    {
      title: "方案A",
      summary: "描述A",
      pros: ["快"],
      cons: ["脆"],
      scenarios: ["原型"],
      confidence: 0.8,
    },
    {
      title: "方案B",
      summary: "描述B",
      pros: ["稳"],
      cons: ["慢"],
      scenarios: ["生产"],
      confidence: 0.6,
    },
  ]);
  const plans = parseRecommendationPlans(raw, 2);
  assert.equal(plans.length, 2);
  assert.equal(plans[0].title, "方案A");
  assert.deepEqual(plans[0].pros, ["快"]);
  assert.equal(plans[1].confidence, 0.6);
});

test("方案解析：非 JSON 回退启发式分段", async () => {
  const { parseRecommendationPlans } = await load();
  const raw = "方案 1：轻量方案\n优点：快\n缺点：不健壮\n\n方案 2：稳健方案\n优点：稳";
  const plans = parseRecommendationPlans(raw, 2);
  assert.ok(plans.length >= 1);
  assert.ok(plans[0].title.includes("轻量") || plans[0].title.includes("方案"));
});

test("方案解析：带 ```json 围栏且前后有散文仍能提取", async () => {
  const { parseRecommendationPlans } = await load();
  const raw =
    "好的，我来基于讨论共识生成推荐方案。\n\n" +
    "```json\n" +
    JSON.stringify(
      [
        {
          title: "方案甲",
          summary: "侧重速度",
          pros: ["快"],
          cons: ["脆"],
          scenarios: ["原型"],
          confidence: 0.8,
        },
        {
          title: "方案乙",
          summary: "侧重稳健",
          pros: ["稳"],
          cons: ["慢"],
          scenarios: ["生产"],
          confidence: 0.6,
        },
      ],
      null,
      2,
    ) +
    "\n```\n\n以上是两套推荐方案。";
  const plans = parseRecommendationPlans(raw, 2);
  assert.equal(plans.length, 2);
  assert.equal(plans[0].title, "方案甲");
  assert.equal(plans[1].title, "方案乙");
  // 红线：字段值不得残留 JSON 语法字符。
  for (const p of plans) {
    assert.ok(!p.title.includes("{"));
    assert.ok(!p.title.includes('"'));
    assert.ok(!p.summary.includes('"'));
    for (const s of [...p.pros, ...p.cons, ...p.scenarios]) {
      assert.ok(!s.includes("{"));
    }
  }
});

test("方案解析：JSON 前后带思考散文仍能提取", async () => {
  const { parseRecommendationPlans } = await load();
  const raw =
    "经过分析，我认为应给出两套方案。\n" +
    '[{"title":"快路径","summary":"缓存优先","pros":["低延迟"],"cons":["一致性弱"],"scenarios":["读多写少"],"confidence":0.7}]\n' +
    "这是最终建议。";
  const plans = parseRecommendationPlans(raw, 1);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].title, "快路径");
  assert.deepEqual(plans[0].pros, ["低延迟"]);
  assert.ok(!plans[0].summary.includes('"'));
});

test("方案解析：被截断的 JSON 不泄漏原始文本，返回兜底方案", async () => {
  const { parseRecommendationPlans } = await load();
  // 缺少结尾的 `]`，模拟流式中途断流。
  const raw =
    '我来生成方案。\n[{"title":"方案甲","summary":"描述甲","pros":["a"],"cons":["b"],"scenarios":["c"],"confidence":0.5},';
  const plans = parseRecommendationPlans(raw, 1);
  // 不得抛错、不得返回空数组。
  assert.ok(Array.isArray(plans));
  assert.ok(plans.length >= 1);
  // 红线：任何方案的 title/summary 不得残留 JSON 语法字符。
  for (const p of plans) {
    assert.ok(!p.title.includes("{"), `title 不应含 {：${p.title}`);
    assert.ok(!p.title.includes("["), `title 不应含 [：${p.title}`);
    assert.ok(!p.summary.includes('"'), `summary 不应含 "：${p.summary}`);
  }
});

test("方案解析：字段值本身是合法 JSON 字符串时原样保留", async () => {
  const { parseRecommendationPlans } = await load();
  // summary 的值是一个 JSON 字符串字面量（合法输入，不应被误删）。
  const raw = JSON.stringify([
    { title: "T", summary: '{"foo":1}', pros: [], cons: [], scenarios: [], confidence: 0.5 },
  ]);
  const plans = parseRecommendationPlans(raw, 1);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].summary, '{"foo":1}');
});

test("任务拆解：方案描述被拆分为有序依赖链", async () => {
  const { decomposePlanHeuristic } = await load();
  const plan = {
    id: "p1",
    title: "T",
    summary: "先搭建脚手架。接着实现登录接口。最后接入数据库。",
    pros: [],
    cons: [],
    scenarios: [],
    confidence: 0.7,
  };
  const tasks = decomposePlanHeuristic(plan);
  assert.ok(tasks.length >= 2);
  assert.equal(tasks[0].dependsOn.length, 0);
  assert.equal(tasks[1].dependsOn[0], tasks[0].id);
});

// 等待编排器状态满足条件（含订阅前已满足的情况）。
function waitFor(orch, predicate) {
  return new Promise((resolve) => {
    if (predicate(orch.getSnapshot())) return resolve();
    const unsub = orch.subscribe(() => {
      if (predicate(orch.getSnapshot())) {
        unsub();
        resolve();
      }
    });
  });
}

test("端到端（Mock）：讨论收敛并产出多套方案", async () => {
  const { createOrchestrator, createMockRunner } = await load();
  const orch = createOrchestrator({
    requirement: "做一个带登录的博客系统",
    config: { maxRounds: 3, planCount: 2 },
    runner: createMockRunner({ planCount: 2, convergeAtRound: 2, participantJitter: true }),
  });
  orch.start();
  await waitFor(orch, (s) => s.status === "awaiting_confirm" || s.status === "failed");
  const snap = orch.getSnapshot();
  assert.equal(snap.status, "awaiting_confirm");
  assert.ok(snap.intent && snap.intent.selectedRoleIds.length > 0);
  assert.ok(snap.agents.some((a) => a.roleId === "arbiter"));
  assert.ok(snap.rounds.length >= 1);
  assert.equal(snap.convergence.converged, true);
  assert.equal(snap.plans.length, 2);
});

test("交互闭环：确认方案产出引擎载荷并标记完成", async () => {
  const { createOrchestrator, createMockRunner } = await load();
  const orch = createOrchestrator({
    requirement: "做一个待办应用",
    cwd: "/tmp/demo",
    config: { maxRounds: 2, planCount: 2 },
    runner: createMockRunner({ planCount: 2, convergeAtRound: 1 }),
  });
  orch.start();
  await waitFor(orch, (s) => s.status === "awaiting_confirm" || s.status === "failed");
  const payload = orch.prepareTasks();
  assert.equal(payload.cwd, "/tmp/demo");
  assert.ok(payload.title.length > 0);
  assert.ok(payload.description.includes("确认方案"));
  orch.markDone();
  assert.equal(orch.getSnapshot().status, "done");
  assert.ok(orch.getSnapshot().tasks.length >= 1);
});

test("退回重议：状态彻底重置且 agents 不重复、消息重新播种", async () => {
  const { createOrchestrator, createMockRunner } = await load();
  const orch = createOrchestrator({
    requirement: "做一个待办应用",
    config: { maxRounds: 5, planCount: 2 },
    runner: createMockRunner({ planCount: 2, convergeAtRound: 2 }),
  });
  orch.start();
  await waitFor(orch, (s) => s.status === "awaiting_confirm" || s.status === "failed");
  const before = orch.getSnapshot();
  assert.ok(before.agents.length > 0);
  const agentCount = before.agents.length;
  const msgCountBefore = before.messages.length;

  // 退回重议：注入修改意见。用 updatedAt 阈值区分「初次运行」与「重议运行」，
  // 避免 waitFor 命中重议前残留的 awaiting_confirm 快照。
  const marker = orch.getSnapshot().updatedAt;
  orch.rediscuss("请减少方案数量并突出成本");
  await waitFor(
    orch,
    (s) => s.updatedAt > marker && (s.status === "awaiting_confirm" || s.status === "failed"),
  );

  const after = orch.getSnapshot();
  // 1) 角色数量不应翻倍（无重复实例化）。
  assert.equal(after.agents.length, agentCount);
  // 2) 增量重议：轮次绝不重置（保留历史，且不会回退到单轮）。
  assert.ok(
    after.rounds.length >= before.rounds.length,
    `重议后轮次应不减少（before=${before.rounds.length}, after=${after.rounds.length}）`,
  );
  // 3) 修改意见应作为用户消息注入讨论中。
  assert.ok(
    after.messages.some((m) => m.kind === "user" && m.content.includes("修改意见")),
    "重议后应包含修改意见消息",
  );
  // 4) 增量重议：历史消息保留并追加（规模增长而非重置）。
  assert.ok(after.messages.length > msgCountBefore, "重议应保留历史消息并追加新内容");
  assert.equal(after.plans.length, 2);
});
