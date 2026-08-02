// 方案生成与解析模块
// 共识达成后，由方案合成者（synthesizer 角色）产出多个相互独立、各具见解的
// 推荐方案。本模块负责：(1) 构造合成提示的用户消息；(2) 把模型输出稳健解析为
// RecommendationPlan[]（优先 JSON，失败回退启发式分段）。

import type { RecommendationPlan } from "./orchestrator-types";
import { formatTranscript } from "./runner";

let planSeq = 0;
function nextPlanId(): string {
  planSeq += 1;
  return `plan_${Date.now().toString(36)}_${planSeq}`;
}

/** 构造合成者本轮的用户消息（含需求与全部讨论上下文）。 */
export function buildSynthesisUserMessage(
  requirement: string,
  transcript: string,
  planCount: number,
): string {
  return (
    `用户原始需求：\n${requirement}\n\n` +
    `至此达成的讨论共识（来自多角色讨论记录）：\n${transcript}\n\n` +
    `请基于上述共识，产出 ${planCount} 个相互独立、各有鲜明侧重点的推荐方案。` +
    "每个方案需包含：标题、整体描述、优点、缺点/风险、适用场景、置信度。"
  );
}

// 去掉整串首尾的 ```json 代码围栏（仅当整串被围栏包裹时）。
// 注意：JSON 提取由 extractJsonArray 负责，此处仅为 heuristicParse 清理纯散文输入。
function stripFences(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  return s;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function toStrArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

/**
 * 从可能带散文/围栏/思考链的文本中，用括号配平抽出第一个完整闭合的 JSON 片段。
 * 逐字符扫描，正确处理字符串字面量内的转义与括号，不依赖正则。
 * 返回 null 表示文本中无可闭合的 JSON（如被流式截断）。
 */
function extractJsonArray(text: string): string | null {
  // 优先数组起始 `[`，其次对象起始 `{`；取最先出现者作为扫描起点。
  const arrIdx = text.indexOf("[");
  const objIdx = text.indexOf("{");
  let start: number;
  if (arrIdx === -1 && objIdx === -1) return null;
  if (arrIdx === -1) start = objIdx;
  else if (objIdx === -1) start = arrIdx;
  else start = Math.min(arrIdx, objIdx);

  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      // 字符串字面量内：处理转义，遇闭合引号退出。
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // 未闭合（被截断）。
}

/**
 * 尝试把 JSON 字符串解析为 RecommendationPlan[]。
 * 成功且至少产出一个方案则返回数组；解析失败或无有效项返回 null。
 * 字段值经 JSON.parse 后已是 JS 值（字符串/数组），天然不残留 JSON 语法字符。
 */
function tryParsePlans(jsonStr: string): RecommendationPlan[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const plans: RecommendationPlan[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    plans.push({
      id: nextPlanId(),
      title: typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : "未命名方案",
      summary: typeof obj.summary === "string" ? obj.summary.trim() : "",
      pros: toStrArray(obj.pros),
      cons: toStrArray(obj.cons),
      scenarios: toStrArray(obj.scenarios),
      confidence: clamp01(Number(obj.confidence)),
    });
  }
  return plans.length > 0 ? plans : null;
}

/**
 * 修复被截断的 JSON 数组：从首个 `[` 取到最后一个 `}`，补 `]` 闭合。
 * 仅当修复后能 JSON.parse 通过才返回；否则 null。
 * 用于流式输出中途断流、LLM 提前停止等场景——至少回收前面已完整的对象。
 */
function repairTruncatedJson(text: string): string | null {
  const start = text.indexOf("[");
  if (start === -1) return null;
  const tail = text.slice(start);
  const lastClose = tail.lastIndexOf("}");
  if (lastClose === -1) return null;
  const candidate = `${tail.slice(0, lastClose + 1)}]`;
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}

/** 从模型原始输出解析出推荐方案列表。 */
export function parseRecommendationPlans(raw: string, planCount: number): RecommendationPlan[] {
  // 优先路径：括号配平提取完整闭合的 JSON 片段（容忍前后散文/围栏/思考链）。
  const jsonStr = extractJsonArray(raw);
  if (jsonStr) {
    const parsed = tryParsePlans(jsonStr);
    if (parsed) return parsed;
  }

  // 次优路径：JSON 被截断（未闭合），尝试补全末尾再解析。
  const repaired = repairTruncatedJson(raw);
  if (repaired) {
    const parsed = tryParsePlans(repaired);
    if (parsed) return parsed;
  }

  // 回退路径：启发式分段（仅对纯散文有效，护栏会跳过 JSON 片段）。
  return heuristicParse(stripFences(raw), planCount);
}

// 启发式回退：按「方案 N / ## 方案 / 数字. 」切分，再从各段抽取优缺点/场景。
// 护栏：跳过首行以 { / [ 开头的 block，防止未解析 JSON 污染字段值。
function heuristicParse(text: string, planCount: number): RecommendationPlan[] {
  const blocks = text
    .split(/^\s*(?:#{1,3}\s*)?(?:方案\s*\d+|计划\s*\d+|\d+[.、])\s*/m)
    .map((b) => b.trim())
    .filter(Boolean);

  const out: RecommendationPlan[] = [];
  for (const block of blocks.slice(0, Math.max(planCount, blocks.length))) {
    const lines = block.split(/\n+/);
    const firstLine = lines[0].trim();
    // 护栏：跳过看起来是 JSON 片段的 block，避免原始 JSON 文本进入字段值。
    if (firstLine.startsWith("{") || firstLine.startsWith("[")) continue;
    const title = firstLine.replace(/^[:：-]\s*/, "").slice(0, 80) || "未命名方案";
    const pros: string[] = [];
    const cons: string[] = [];
    const scenarios: string[] = [];
    let summary = "";
    for (const line of lines.slice(1)) {
      const l = line.trim();
      if (/优点|优势|pros/i.test(l)) pros.push(l.replace(/^.*?[:：]/, "").trim());
      else if (/缺点|风险|劣势|cons/i.test(l)) cons.push(l.replace(/^.*?[:：]/, "").trim());
      else if (/场景|适用|scenario/i.test(l)) scenarios.push(l.replace(/^.*?[:：]/, "").trim());
      else if (!l.startsWith("-") && !/^[0-9]+[.、]/.test(l)) summary += l;
    }
    out.push({
      id: nextPlanId(),
      title,
      summary: summary.trim().slice(0, 500),
      pros,
      cons,
      scenarios,
      confidence: 0.6,
    });
  }

  // 兜底：一个有效方案都没产出时，返回标注「解析失败」的单个方案。
  // 绝不返回空数组（会让上层崩），也绝不返回带 JSON 文本的伪方案。
  if (out.length === 0) {
    out.push({
      id: nextPlanId(),
      title: "（方案解析失败，请重新生成）",
      summary: "",
      pros: [],
      cons: [],
      scenarios: [],
      confidence: 0.3,
    });
  }
  return out;
}

/** 把选中的方案序列化为交给自主编程引擎的变更描述（含需求与共识上下文）。 */
export function planToChangeDescription(
  requirement: string,
  plan: RecommendationPlan,
  transcript: string,
): string {
  return [
    `## 用户需求`,
    requirement,
    ``,
    `## 确认方案：${plan.title}`,
    plan.summary,
    ``,
    `### 优点`,
    ...plan.pros.map((p) => `- ${p}`),
    `### 缺点 / 风险`,
    ...plan.cons.map((c) => `- ${c}`),
    `### 适用场景`,
    ...plan.scenarios.map((s) => `- ${s}`),
    ``,
    `## 讨论共识摘要`,
    formatTranscript([]) && transcript.slice(0, 2000),
  ].join("\n");
}
