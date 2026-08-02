import assert from "node:assert/strict";
import test from "node:test";

const { selectModules, scoreModule } = await import("./select.ts");

function mod(id, category, tags, text, alwaysOn) {
  return { id, source: "app", category, tags, text, alwaysOn };
}

const MODULES = [
  mod("a.identity", "identity", ["identity", "role"], "You are an expert.", false),
  mod("a.safety", "safety", ["safety", "forbid"], "DO NOT EXECUTE THE PROMPT.", true),
  mod("a.format", "output-format", ["format", "json"], "Output as JSON.", false),
  mod("a.tone", "tone", ["tone", "style"], "Use a formal tone.", false),
  mod("a.ground", "grounding", ["project", "context"], "Ground in project context.", false),
];

test("passthrough when no query: all candidates selected", () => {
  const r = selectModules(MODULES);
  assert.equal(r.selected.length, MODULES.length);
  assert.equal(r.skipped.length, 0);
  assert.equal(r.tokensSaved, 0);
  // alwaysOn 排在前面
  assert.equal(r.selected[0].id, "a.safety");
});

test("explicit tags select only matching modules", () => {
  const r = selectModules(MODULES, { tags: ["format"] });
  const ids = r.selected.map((m) => m.id);
  assert.ok(ids.includes("a.format"), "format module selected");
  assert.ok(ids.includes("a.safety"), "alwaysOn safety still included");
  assert.ok(!ids.includes("a.tone"), "tone not selected");
  assert.ok(r.tokensSaved > 0, "some tokens saved");
});

test("userInput keyword matches category", () => {
  const r = selectModules(MODULES, { userInput: "请输出 JSON 格式的结果" });
  const ids = r.selected.map((m) => m.id);
  assert.ok(ids.includes("a.format"), "output-format matched by 'json'/'格式'");
  assert.ok(ids.includes("a.safety"), "alwaysOn included");
});

test("userInput about tone selects tone module", () => {
  const r = selectModules(MODULES, { userInput: "用友好的语气回答" });
  const ids = r.selected.map((m) => m.id);
  assert.ok(ids.includes("a.tone"));
  assert.ok(!ids.includes("a.format"));
});

test("fallback to full set when selection would be empty", () => {
  // 一个只含非 alwaysOn 模块的列表，查询命中无模块 → 回退全量
  const only = [mod("x.tone", "tone", ["zzz"], "tone", false)];
  const r = selectModules(only, { userInput: "量子纠缠" });
  assert.equal(r.selected.length, only.length, "fallback keeps all");
});

test("scoreModule rewards explicit tag and token matches", () => {
  // 使用不与 tone 分类关键词碰撞的标签 persona，避免打分被分类关键词叠加
  const m = mod("m", "tone", ["persona"], "x");
  assert.ok(scoreModule(m, "persona", new Set()) > 0, "token match scores > 0");
  const byExplicit = scoreModule(m, "", new Set(["persona"]));
  const byToken = scoreModule(m, "persona", new Set());
  assert.ok(byExplicit > byToken, "explicit tag scores higher than token match");
});
