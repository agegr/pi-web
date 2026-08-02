// 方案文档落盘单测：node --test --experimental-strip-types
// 验证 slugifyForPlanDoc（含中文保留）/ resolveRepoRoot / 模板组装 / 落盘冲突重命名。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  slugifyForPlanDoc,
  resolveRepoRoot,
  detectNpmScripts,
  buildPlanDocMarkdown,
  savePlanDoc,
  readPlanDoc,
  slugFromPath,
} from "./plan-doc-store.ts";

// 公共测试数据。
const plan = {
  id: "plan_1",
  title: "为引擎增加并发任务调度",
  summary: "把引擎的串行任务执行改为并发，提升整体吞吐。",
  pros: ["吞吐提升", "资源利用率更高"],
  cons: ["调试更复杂", "竞态风险"],
  scenarios: ["多任务无依赖场景"],
  confidence: 0.7,
};
const tasks = [
  { id: "t1", title: "分析现状", description: "分析", dependsOn: [], order: 0 },
  { id: "t2", title: "实现并发", description: "实现", dependsOn: ["t1"], order: 1 },
];

// --- slugifyForPlanDoc --------------------------------------------------

test("slug 保留中文字符", () => {
  assert.equal(slugifyForPlanDoc("为引擎增加并发任务调度"), "为引擎增加并发任务调度");
});

test("slug 收敛分隔符与 trim", () => {
  assert.equal(
    slugifyForPlanDoc("  Add / Concurrency -- to Engine!! "),
    "add-concurrency-to-engine",
  );
});

test("slug 截断到 40 字符", () => {
  const long = "a".repeat(50);
  assert.equal(slugifyForPlanDoc(long).length, 40);
});

test("slug 空值兜底 plan-<时间戳>", () => {
  const s = slugifyForPlanDoc("   !!!   ");
  assert.ok(s.startsWith("plan-"));
  assert.ok(s.length > "plan-".length);
});

test("slug 小写化英文", () => {
  assert.equal(slugifyForPlanDoc("Plan Mode Engine"), "plan-mode-engine");
});

// --- resolveRepoRoot ----------------------------------------------------

test("resolveRepoRoot 找到 .git 祖先", () => {
  const root = mkdtempSync(join(tmpdir(), "planroot-git-"));
  const sub = join(root, "a", "b", "c");
  mkdirSync(sub, { recursive: true });
  mkdirSync(join(root, ".git"));
  assert.equal(resolveRepoRoot(sub), root);
  rmSync(root, { recursive: true, force: true });
});

test("resolveRepoRoot 找到 package.json 祖先", () => {
  const root = mkdtempSync(join(tmpdir(), "planroot-pkg-"));
  const sub = join(root, "x", "y");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(root, "package.json"), "{}");
  assert.equal(resolveRepoRoot(sub), root);
  rmSync(root, { recursive: true, force: true });
});

test("resolveRepoRoot 在 cwd 自身含 package.json 时返回 cwd", () => {
  // 在临时根下再建一层独立目录，确保祖先链不含 .git/package.json，
  // 仅在 cwd 自身放置 package.json，验证就近返回 cwd。
  const parent = mkdtempSync(join(tmpdir(), "planroot-self-parent-"));
  const cwd = join(parent, "proj");
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "package.json"), "{}");
  assert.equal(resolveRepoRoot(cwd), cwd);
  rmSync(parent, { recursive: true, force: true });
});

// --- detectNpmScripts ---------------------------------------------------

test("detectNpmScripts 按顺序返回存在的脚本", () => {
  const dir = mkdtempSync(join(tmpdir(), "planscripts-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { build: "next build", test: "vitest run", dev: "next dev" } }),
  );
  const scripts = detectNpmScripts(dir);
  const keys = scripts.map((s) => s.key);
  // 顺序按 order 数组：dev 在 test/build 之前。
  assert.equal(keys[0], "dev");
  assert.equal(keys[1], "test");
  assert.ok(keys.includes("build"));
  rmSync(dir, { recursive: true, force: true });
});

test("detectNpmScripts 无 package.json 返回空", () => {
  const dir = mkdtempSync(join(tmpdir(), "planscripts-empty-"));
  assert.deepEqual(detectNpmScripts(dir), []);
  rmSync(dir, { recursive: true, force: true });
});

// --- buildPlanDocMarkdown -----------------------------------------------

test("模板含全部章节且含需求与方案标题", () => {
  const md = buildPlanDocMarkdown({
    cwd: "/tmp/proj",
    requirement: "我要提速",
    plan,
    tasks,
    mode: "engine",
  });
  assert.match(md, /# 方案：为引擎增加并发任务调度/);
  assert.match(md, /我要提速/);
  assert.match(md, /吞吐提升/);
  assert.match(md, /竞态风险/);
  assert.match(md, /自主编程引擎/);
  assert.match(md, /## 一、用户需求/);
  assert.match(md, /## 十一、回滚方案/);
});

test("普通模式标注「普通模式」", () => {
  const md = buildPlanDocMarkdown({ cwd: "/tmp/p", requirement: "r", plan, tasks, mode: "plan" });
  assert.match(md, /普通模式（仅生成方案）/);
});

test("模板任务清单按 order 排序并标注依赖", () => {
  // 故意打乱传入顺序。
  const md = buildPlanDocMarkdown({
    cwd: "/tmp/p",
    requirement: "r",
    plan,
    tasks: [tasks[1], tasks[0]],
    mode: "engine",
  });
  // t1（order 0）应排在 t2 之前。
  const i1 = md.indexOf("分析现状");
  const i2 = md.indexOf("实现并发");
  assert.ok(i1 >= 0 && i2 >= 0 && i1 < i2);
  assert.match(md, /依赖：t1/);
});

// --- savePlanDoc / readPlanDoc ------------------------------------------

test("savePlanDoc 写入 docs/plans/<slug>.md 并可读回", () => {
  const root = mkdtempSync(join(tmpdir(), "plansave-"));
  const input = { cwd: root, requirement: "需求", plan, tasks, mode: "engine" };
  const result = savePlanDoc(input);
  assert.ok(existsSync(result.path));
  assert.equal(slugFromPath(result.path), result.slug);
  assert.match(result.slug, /为引擎增加并发任务调度/);
  const content = readPlanDoc(result.path);
  assert.ok(content);
  assert.match(content, /# 方案：为引擎增加并发任务调度/);
  rmSync(root, { recursive: true, force: true });
});

test("savePlanDoc 同标题冲突时追加随机后缀", () => {
  const root = mkdtempSync(join(tmpdir(), "planconflict-"));
  const input = { cwd: root, requirement: "需求", plan, tasks, mode: "engine" };
  const r1 = savePlanDoc(input);
  const r2 = savePlanDoc(input);
  assert.notEqual(r1.path, r2.path);
  assert.ok(existsSync(r1.path));
  assert.ok(existsSync(r2.path));
  rmSync(root, { recursive: true, force: true });
});

test("savePlanDoc 无仓库根时落到 cwd/docs/plans", () => {
  const cwd = mkdtempSync(join(tmpdir(), "plannorepo-"));
  const input = { cwd, requirement: "需求", plan, tasks, mode: "plan" };
  const result = savePlanDoc(input);
  assert.ok(result.path.includes(join("docs", "plans")));
  assert.ok(existsSync(result.path));
  rmSync(cwd, { recursive: true, force: true });
});

test("readPlanDoc 缺失返回 null", () => {
  assert.equal(readPlanDoc(join(tmpdir(), "nonexistent-plan-doc.md")), null);
});
