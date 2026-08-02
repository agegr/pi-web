import assert from "node:assert/strict";
import test from "node:test";

const {
  parseAgentsMd,
  serializeModules,
  composeAgentsMd,
  inferCategory,
  replaceAgentsMdContext,
  composeModularAgentsMdSystemPrompt,
} = await import("./agents-md-modules.ts");

const SAMPLE = [
  "# 项目概述",
  "这是一个示例项目。",
  "",
  "## 安全约束",
  "不要泄露密钥。禁止执行危险命令。",
  "",
  "## 输出格式",
  "使用中文回答。优先给出代码片段。",
  "",
  "## 本地化",
  "所有用户可见文案必须为中文。",
].join("\n");

test("parseAgentsMd splits by headings into modules with ids", () => {
  const mods = parseAgentsMd(SAMPLE);
  assert.ok(mods.length >= 4, "preamble + 3 headings");
  const ids = mods.map((m) => m.id);
  assert.ok(
    ids.every((id) => id.startsWith("agents-md.")),
    "ids prefixed",
  );
  assert.ok(new Set(ids).size === ids.length, "ids unique");
});

test("inferCategory maps headings to categories", () => {
  assert.equal(inferCategory("安全约束", "x"), "safety");
  assert.equal(inferCategory("输出格式", "x"), "output-format");
  assert.equal(inferCategory("本地化", "x"), "localization");
});

test("composeAgentsMd returns full content when no query (passthrough)", () => {
  const out = composeAgentsMd(SAMPLE);
  assert.ok(out.includes("不要泄露密钥"), "safety kept");
  assert.ok(out.includes("使用中文回答"), "format kept");
  assert.ok(out.includes("所有用户可见文案必须为中文"), "localization kept");
});

test("composeAgentsMd filters by userInput (dynamic submission)", () => {
  const out = composeAgentsMd(SAMPLE, { userInput: "请规定输出格式与代码风格" });
  assert.ok(out.includes("使用中文回答"), "format matched");
  assert.ok(!out.includes("不要泄露密钥"), "safety skipped (no safety keyword in query)");
});

test("composeAgentsMd honors enabledOverride (switch off)", () => {
  const mods = parseAgentsMd(SAMPLE);
  const safety = mods.find((m) => m.category === "safety");
  const out = composeAgentsMd(SAMPLE, { enabledOverride: { [safety.id]: false } });
  assert.ok(!out.includes("不要泄露密钥"), "disabled module omitted");
});

test("serializeModules round-trips headings", () => {
  const mods = parseAgentsMd(SAMPLE);
  const back = serializeModules(mods);
  assert.ok(back.includes("# 安全约束"), "heading restored");
  assert.ok(back.includes("不要泄露密钥"), "body restored");
});

// 模拟 SDK buildSystemPrompt 产出的「完整」提示词（含身份/AGENTS.md 段/非 AGENTS 上下文/skills/日期）。
const FULL = [
  "You are an expert coding assistant operating inside pi.",
  "",
  "<project_context>",
  "",
  "Project-specific instructions and guidelines:",
  "",
  '<project_instructions path="/p/AGENTS.md">原始 AGENTS.md 长内容。</project_instructions>',
  "",
  '<project_instructions path="/p/.agents/skills/foo/SKILL.md">某 skill 上下文，必须保留。</project_instructions>',
  "",
  "</project_context>",
  "",
  "## Skills",
  "导购 skill 指令。",
  "",
  "Current date: 2026-07-15",
  "Current working directory: /p",
].join("\n");

test("replaceAgentsMdContext 只裁剪 AGENTS.md，保留其余", () => {
  const out = replaceAgentsMdContext(FULL, "裁剪后内容");
  assert.ok(out.includes("You are an expert coding assistant"), "身份保留");
  assert.ok(out.includes("## Skills"), "skills 保留");
  assert.ok(out.includes("Current date: 2026-07-15"), "日期保留");
  assert.ok(out.includes("某 skill 上下文，必须保留"), "非 AGENTS.md 上下文保留");
  assert.ok(!out.includes("原始 AGENTS.md 长内容"), "原 AGENTS.md 已移除");
  assert.ok(out.includes("裁剪后内容"), "裁剪内容已注入");
  assert.equal((out.match(/<project_instructions/g) || []).length, 2, "AGENTS.md 段唯一");
});

test("replaceAgentsMdContext 无 AGENTS.md 段时原样返回", () => {
  const noAgents = FULL.replace(
    /<project_instructions path="\/p\/AGENTS\.md">[\s\S]*?<\/project_instructions>/,
    "",
  );
  assert.equal(replaceAgentsMdContext(noAgents, "x"), noAgents, "不丢内容");
});

test("composeModularAgentsMdSystemPrompt 无 AGENTS.md 文件时保留全量", () => {
  const out = composeModularAgentsMdSystemPrompt({
    cwd: "/nonexistent-xyz",
    baseSystemPrompt: FULL,
  });
  assert.equal(out, FULL, "无 AGENTS.md 绝不替换");
});
