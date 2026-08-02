// plan-export 单测：node --test --experimental-strip-types
// 验证 snapshotToMarkdown / snapshotToHtml 的结构完整性与边界兜底。
// 直连具体文件（遵循 AGENTS.md：agent-orchestrator 测试不 import ./index.ts）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotToMarkdown, snapshotToHtml } from "./plan-export.ts";

/** 构造一个有完整数据的测试快照。 */
function makeFullSnapshot() {
  return {
    id: "orc-test-1234",
    status: "awaiting_confirm",
    requirement: "设计一个登录页改造方案",
    cwd: "/tmp/demo",
    config: {
      maxRounds: 4,
      stabilizeThreshold: 0.85,
      concurrency: 1,
      controllerMode: "hybrid",
      planCount: 2,
      infoDeltaThreshold: 0.08,
      repetitionThreshold: 0.9,
      turnTimeoutMs: 30000,
      turnMaxRetries: 1,
    },
    agents: [],
    messages: [
      {
        id: "m1",
        round: 0,
        from: "user",
        fromName: "用户",
        kind: "user",
        content: "我需要改造登录页",
        at: 1700000000000,
      },
      {
        id: "m2",
        round: 1,
        from: "architect",
        fromName: "架构师",
        kind: "agent",
        content: "建议采用 **JWT** 方案",
        at: 1700000001000,
      },
      {
        id: "m3",
        round: 1,
        from: "arbiter",
        fromName: "仲裁者",
        kind: "arbiter",
        content: "共识倾向于 JWT",
        at: 1700000002000,
      },
    ],
    rounds: [
      {
        round: 1,
        messageIds: ["m2", "m3"],
        speakers: ["architect", "arbiter"],
        fingerprint: "abc",
        summaryText: "讨论了 JWT",
      },
    ],
    convergence: { converged: true, reason: "arbiter_signal", round: 1, consensusScore: 0.85 },
    plans: [
      {
        id: "p1",
        title: "JWT 登录方案",
        summary: "使用 JWT 做无状态认证",
        pros: ["无状态", "易扩展"],
        cons: ["token 撤销复杂"],
        scenarios: ["中大型应用"],
        confidence: 0.88,
      },
      {
        id: "p2",
        title: "Session 方案",
        summary: "服务端 session",
        pros: ["简单"],
        cons: ["不易横向扩展"],
        scenarios: ["小型应用"],
        confidence: 0.6,
      },
    ],
    selectedPlanId: "p1",
    tasks: [{ id: "t1", title: "实现登录接口", description: "POST /api/login" }],
    updatedAt: 1700000003000,
  };
}

test("snapshotToMarkdown: 完整快照包含三节（时间线/方案/任务）", () => {
  const md = snapshotToMarkdown(makeFullSnapshot());
  assert.ok(md.includes("# 计划讨论：设计一个登录页改造方案"), "应含标题");
  assert.ok(md.includes("## 讨论时间线"), "应含讨论时间线节");
  assert.ok(md.includes("## 推荐方案"), "应含推荐方案节");
  assert.ok(md.includes("## 执行任务"), "应含执行任务节");
});

test("snapshotToMarkdown: 讨论时间线保留所有消息与发送方", () => {
  const md = snapshotToMarkdown(makeFullSnapshot());
  assert.ok(md.includes("【用户需求】"), "应含用户需求标签");
  assert.ok(md.includes("【架构师】"), "应含架构师标签");
  assert.ok(md.includes("【仲裁者】"), "应含仲裁者标签");
  assert.ok(md.includes("我需要改造登录页"), "应含用户原始需求内容");
  assert.ok(md.includes("建议采用 **JWT** 方案"), "应含 agent 发言内容");
  assert.ok(md.includes("（第 1 轮）"), "应含轮次标记");
});

test("snapshotToMarkdown: 推荐方案含置信度与优缺点", () => {
  const md = snapshotToMarkdown(makeFullSnapshot());
  assert.ok(md.includes("JWT 登录方案"), "应含方案标题");
  assert.ok(md.includes("置信度 88%"), "应含置信度百分比");
  assert.ok(md.includes("- 无状态"), "应含优点");
  assert.ok(md.includes("- token 撤销复杂"), "应含缺点");
  assert.ok(md.includes("- 中大型应用"), "应含适用场景");
});

test("snapshotToMarkdown: 收敛信息正确展示", () => {
  const md = snapshotToMarkdown(makeFullSnapshot());
  assert.ok(md.includes("收敛：仲裁者达成共识"), "应含收敛原因中文");
  assert.ok(md.includes("共识度：85%"), "应含共识度");
});

test("snapshotToMarkdown: 空 plans 兜底不报错", () => {
  const snap = makeFullSnapshot();
  snap.plans = [];
  const md = snapshotToMarkdown(snap);
  assert.ok(md.includes("（暂无推荐方案）"), "空方案应有兜底文案");
});

test("snapshotToMarkdown: 空 messages 兜底", () => {
  const snap = makeFullSnapshot();
  snap.messages = [];
  const md = snapshotToMarkdown(snap);
  assert.ok(md.includes("（尚无讨论记录）"), "空消息应有兜底文案");
});

test("snapshotToMarkdown: 含错误信息时追加错误节", () => {
  const snap = makeFullSnapshot();
  snap.error = "合成失败";
  const md = snapshotToMarkdown(snap);
  assert.ok(md.includes("## 错误信息"), "应含错误信息节");
  assert.ok(md.includes("合成失败"), "应含错误内容");
});

test("snapshotToHtml: 生成有效 HTML 文档结构", () => {
  const html = snapshotToHtml(makeFullSnapshot());
  assert.ok(html.startsWith("<!DOCTYPE html>"), "应以 DOCTYPE 开头");
  assert.ok(html.includes("<html"), "应含 html 标签");
  assert.ok(html.includes("</html>"), "应闭合 html 标签");
  assert.ok(html.includes("<style>"), "应含内联样式");
});

test("snapshotToHtml: 转义特殊字符防止破坏结构", () => {
  const snap = makeFullSnapshot();
  snap.messages[0].content = '<script>alert("xss")</script>';
  const html = snapshotToHtml(snap);
  assert.ok(!html.includes("<script>alert"), "应转义 script 标签");
  assert.ok(html.includes("&lt;script&gt;"), "应含转义后的内容");
});
