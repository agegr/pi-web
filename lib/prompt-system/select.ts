// 动态提交策略 —— 启发式选择（离线、零额外调用、确定性、可单测）。
//
// 本模块刻意 @/-free（仅相对导入 ./types 与 ./tokenize.ts），以便纯 node:test 单测。
// LLM 精排在 select-llm.ts（依赖 SDK，服务侧）。

import type { PromptModule, SelectionResult } from "./types";
import { estimateTokens } from "./tokenize";

/** 选择选项。 */
export interface SelectOptions {
  /** 当前用户输入（任务描述）。 */
  userInput?: string;
  /** 上下文（项目信息、历史摘要等）。 */
  context?: string;
  /** 显式任务标签（覆盖从文本推导）。 */
  tags?: string[];
  /** 无用户输入/上下文/标签时是否全量发送（默认 true，保语义完整）。 */
  passthroughWhenEmpty?: boolean;
}

// 任务类型关键词 → 分类关键词映射（从自由文本推导相关模块）。
// 用子串包含匹配，天然兼容中文（中文无空格，按整句做 token 会漏匹配）。
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "output-format": [
    "格式",
    "format",
    "json",
    "table",
    "markdown",
    "表格",
    "列表",
    "bullet",
    "代码块",
    "codeblock",
  ],
  tone: ["语气", "tone", "风格", "style", "正式", "formal", "友好", "friendly"],
  grounding: ["项目", "project", "上下文", "context", "代码库", "codebase", "仓库", "repo"],
  examples: ["示例", "example", "样例", "举例", "few-shot", "fewshot"],
  localization: ["中文", "chinese", "语言", "language", "翻译", "i18n", "zh"],
  safety: ["安全", "safety", "禁止", "do not", "forbid", "forbidden", "security"],
  identity: ["身份", "identity", "你是", "you are", "角色", "role", "persona"],
  constraints: ["约束", "constraint", "规则", "rule", "限制", "limit", "要求", "requirement"],
};

/** 计算模块与查询的相关度分数（>0 表示相关）。 */
export function scoreModule(
  module: PromptModule,
  queryLower: string,
  explicitTags: Set<string>,
): number {
  let score = 0;
  const q = queryLower.toLowerCase();
  for (const t of module.tags) {
    const tl = t.toLowerCase();
    if (explicitTags.has(tl)) score += 3;
    else if (tl && q.includes(tl)) score += 2;
  }
  for (const kw of CATEGORY_KEYWORDS[module.category] || []) {
    if (kw && q.includes(kw.toLowerCase())) score += 1;
  }
  return score;
}

function buildResult(selected: PromptModule[], all: PromptModule[]): SelectionResult {
  const selSet = new Set(selected.map((m) => m.id));
  const skipped = all.filter((m) => !selSet.has(m.id));
  const tokensBefore = all.reduce((s, m) => s + estimateTokens(m.text), 0);
  const tokensAfter = selected.reduce((s, m) => s + estimateTokens(m.text), 0);
  return { selected, skipped, tokensBefore, tokensAfter, tokensSaved: tokensBefore - tokensAfter };
}

/**
 * 从候选模块中按相关度筛选将被发送的模块。
 * - 无用户输入/上下文/标签且 passthroughWhenEmpty（默认）时，全量发送以保语义完整。
 * - 有查询时：alwaysOn 必含；其余按 scoreModule 打分（子串匹配），>0 入选；
 *   筛选后若为空则回退全量，避免漏发核心指令。
 */
export function selectModules(
  candidates: PromptModule[],
  opts: SelectOptions = {},
): SelectionResult {
  const explicitTags = new Set((opts.tags || []).map((t) => t.toLowerCase()));
  const hasQuery = Boolean(opts.userInput || opts.context || (opts.tags && opts.tags.length));
  const passthrough = opts.passthroughWhenEmpty !== false;

  if (!hasQuery && passthrough) {
    const selected = [...candidates].sort((a, b) => Number(b.alwaysOn) - Number(a.alwaysOn));
    return buildResult(selected, candidates);
  }

  const queryLower = [opts.userInput || "", opts.context || ""].join(" ").toLowerCase();
  const scored = candidates.map((m) => ({
    m,
    s: m.alwaysOn ? Number.POSITIVE_INFINITY : scoreModule(m, queryLower, explicitTags),
  }));
  const selected = scored.filter((x) => x.s > 0).map((x) => x.m);
  const finalSelected = selected.length ? selected : candidates;
  return buildResult(finalSelected, candidates);
}
