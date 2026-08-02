// autoplan-llm-adapter 单测：node --test --experimental-strip-types
// 验证 B 阶段真实适配器（无内存桩）：LLM 生成计划/多文件写入、测试验证、失败回滚、
// 路径穿越拒绝、LLM 抛错如实失败、连续失败熔断。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLlmAutoPlanAdapter } from "./autoplan-llm-adapter";

const tmp = mkdtempSync(join(tmpdir(), "pi-llm-adapter-"));
process.once("exit", () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// 默认关闭自动测试，单测专注于写文件/失败语义；回滚用例单独开启。
process.env.ENGINE_AUTOPLAN_RUN_TESTS = "0";

// 确定性假 LLM：按 system 关键词返回计划或多文件编辑。
const PLAN_TEXT = `目标：演示。\n关键步骤：先打地基。\n- 任务：编写入口文件\n- 任务：编写工具函数\n- 任务：补充测试`;
function fakeLlm(system) {
  if (system.includes("架构师")) {
    return Promise.resolve(PLAN_TEXT);
  }
  return Promise.resolve(
    JSON.stringify({
      edits: [
        { path: "src/demo.js", content: "export const demo = 1;\n" },
        { path: "src/util.js", content: "export const util = 2;\n" },
      ],
    }),
  );
}

// 计划成功、任务阶段抛错（用于「LLM 抛错 / 熔断」用例，避免 generatePlan 也抛错）。
function planOkTaskBoom(system) {
  return system.includes("架构师")
    ? Promise.resolve(PLAN_TEXT)
    : Promise.reject(new Error("LLM 挂了"));
}

async function planAndTasks(adapter, title) {
  const plan = await adapter.generatePlan({ title, description: "x", cwd: tmp });
  const tasks = await adapter.enqueueTasks(plan.id);
  return { plan, tasks };
}

test("generatePlan 经 LLM 生成 spec，enqueueTasks 解析任务标题", async () => {
  const adapter = createLlmAutoPlanAdapter(() => fakeLlm);
  const { plan, tasks } = await planAndTasks(adapter, "demo");
  assert.ok(plan.spec.includes("演示"), "计划应含 LLM 生成的 spec");
  assert.equal(tasks.length, 3);
  assert.equal(tasks[0].title, "编写入口文件");
});

test("runTask 多文件真实写入 cwd 内并返回 completed", async () => {
  const ctx = { cwd: tmp, changeName: "multi-change" };
  const adapter = createLlmAutoPlanAdapter(() => fakeLlm);
  const { tasks } = await planAndTasks(adapter, "demo");
  const res = await adapter.runTask(tasks[0].id, ctx);
  assert.equal(res.status, "completed");
  assert.ok(existsSync(join(tmp, "src", "demo.js")));
  assert.ok(existsSync(join(tmp, "src", "util.js")));
  assert.equal(readFileSync(join(tmp, "src", "demo.js"), "utf8"), "export const demo = 1;\n");
  assert.ok(res.output.includes("src/demo.js") && res.output.includes("src/util.js"));
});

test("createLlm 返回 null → generatePlan 如实抛错（无内存桩兜底）", async () => {
  const adapter = createLlmAutoPlanAdapter(() => null);
  await assert.rejects(
    () => adapter.generatePlan({ title: "stub", description: "y", cwd: tmp }),
    /无可用 LLM|未注入 LLM/,
  );
});

test("路径穿越被拒绝 → 任务 failed，且不写出界文件", async () => {
  process.env.ENGINE_AUTOPLAN_MAX_FAILURES = "99"; // 防止本次失败触发熔断，便于断言 failed
  const ctx = { cwd: tmp, changeName: "traversal-change" };
  const evilLlm = () =>
    Promise.resolve(JSON.stringify({ path: "../../etc/evil.txt", content: "pwned" }));
  const adapter = createLlmAutoPlanAdapter(() => evilLlm);
  const { tasks } = await planAndTasks(adapter, "evil");
  const res = await adapter.runTask(tasks[0].id, ctx);
  assert.equal(res.status, "failed", "越界写入被拦截后应如实失败");
  assert.ok(res.output.includes("非法写入路径"), "应记录路径被拒原因");
  assert.ok(!existsSync(join(tmp, "..", "..", "etc", "evil.txt")));
  delete process.env.ENGINE_AUTOPLAN_MAX_FAILURES;
});

test("LLM 抛错 → 任务 failed（不静默完成）", async () => {
  process.env.ENGINE_AUTOPLAN_MAX_FAILURES = "99";
  const ctx = { cwd: tmp, changeName: "err-change" };
  const adapter = createLlmAutoPlanAdapter(() => planOkTaskBoom);
  const { tasks } = await planAndTasks(adapter, "err");
  const res = await adapter.runTask(tasks[0].id, ctx);
  assert.equal(res.status, "failed");
  assert.ok(res.output.includes("执行失败") || res.output.includes("LLM 挂了"));
  delete process.env.ENGINE_AUTOPLAN_MAX_FAILURES;
});

test("连续失败达阈值 → runTask 熔断抛错", async () => {
  process.env.ENGINE_AUTOPLAN_MAX_FAILURES = "2";
  const ctx = { cwd: tmp, changeName: "breaker-change" };
  const adapter = createLlmAutoPlanAdapter(() => planOkTaskBoom);
  const { tasks } = await planAndTasks(adapter, "breaker");
  const first = await adapter.runTask(tasks[0].id, ctx);
  assert.equal(first.status, "failed", "第 1 次失败未达阈值，应 failed");
  await assert.rejects(
    () => adapter.runTask(tasks[1].id, ctx),
    /熔断/,
    "第 2 次连续失败应熔断抛错",
  );
  delete process.env.ENGINE_AUTOPLAN_MAX_FAILURES;
});

test("测试失败 → 回滚写入并标记 failed", async () => {
  process.env.ENGINE_AUTOPLAN_RUN_TESTS = "1";
  process.env.ENGINE_AUTOPLAN_TEST_CMD = "node -e process.exit(1)";
  process.env.ENGINE_AUTOPLAN_MAX_FAILURES = "99";
  // 用唯一文件名，避免与前面用例已存在的 src/demo.js 混淆（已存在文件回滚是还原而非删除）。
  const rbFile = `src/rb-${Math.random().toString(36).slice(2, 8)}.js`;
  const rbLlm = (system) =>
    system.includes("架构师")
      ? Promise.resolve(PLAN_TEXT)
      : Promise.resolve(JSON.stringify({ path: rbFile, content: "x" }));
  const ctx = { cwd: tmp, changeName: "rollback-change" };
  const adapter = createLlmAutoPlanAdapter(() => rbLlm);
  const { tasks } = await planAndTasks(adapter, "rollback");
  const target = join(tmp, rbFile);
  const res = await adapter.runTask(tasks[0].id, ctx);
  assert.equal(res.status, "failed", "测试未通过应 failed");
  assert.ok(res.output.includes("已回滚") || res.output.includes("测试未通过"), "应回滚");
  assert.ok(!existsSync(target), "回滚后应删除本次新建文件");
  delete process.env.ENGINE_AUTOPLAN_RUN_TESTS;
  delete process.env.ENGINE_AUTOPLAN_TEST_CMD;
  delete process.env.ENGINE_AUTOPLAN_MAX_FAILURES;
});

test("测试通过 → 保留写入并 completed", async () => {
  process.env.ENGINE_AUTOPLAN_RUN_TESTS = "1";
  process.env.ENGINE_AUTOPLAN_TEST_CMD = "node -e process.exit(0)";
  const ctx = { cwd: tmp, changeName: "pass-change" };
  const adapter = createLlmAutoPlanAdapter(() => fakeLlm);
  const { tasks } = await planAndTasks(adapter, "pass");
  const res = await adapter.runTask(tasks[0].id, ctx);
  assert.equal(res.status, "completed");
  assert.ok(existsSync(join(tmp, "src", "demo.js")));
  delete process.env.ENGINE_AUTOPLAN_RUN_TESTS;
  delete process.env.ENGINE_AUTOPLAN_TEST_CMD;
});

test("超出单运行文件写入上限 → 任务 failed（不超限写入）", async () => {
  process.env.ENGINE_AUTOPLAN_MAX_FILES = "1";
  process.env.ENGINE_AUTOPLAN_MAX_FAILURES = "99";
  // 一次返回 2 个文件编辑，但上限为 1。
  const ctx = { cwd: tmp, changeName: "limit-change" };
  const adapter = createLlmAutoPlanAdapter(() => fakeLlm);
  const { tasks } = await planAndTasks(adapter, "limit");
  const res = await adapter.runTask(tasks[0].id, ctx);
  assert.equal(res.status, "failed");
  assert.ok(res.output.includes("文件写入上限"), "应记录超限原因");
  delete process.env.ENGINE_AUTOPLAN_MAX_FILES;
  delete process.env.ENGINE_AUTOPLAN_MAX_FAILURES;
});

// 清理：测试间遗留的 src 目录不影响断言，但销毁临时根在进程退出时统一处理。
