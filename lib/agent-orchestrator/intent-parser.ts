// 需求接收与解析模块
// 接收用户输入（原始需求），由主控 Plan 模块提取意图，并据此从角色库
// 动态实例化相关 Agent。提供两种实现：
//  - parseIntentHeuristic：纯启发式关键词匹配，无需 LLM，确定性、可单测；
//  - parseIntentWithLlm：经 runner 调用 LLM 抽取结构化意图（更准，但需后端）。

import type { IntentParseResult, RoleTag } from "./orchestrator-types";
import { ROLE_LIBRARY, TAG_TO_ROLES } from "./role-library";

// 领域标签 → 中文关键词（命中即认为需求涉及该领域）。
const TAG_KEYWORDS: Array<{ tag: RoleTag; words: string[] }> = [
  { tag: "product", words: ["需求", "用户", "价值", "目标", "范围", "验收", "场景", "痛点"] },
  {
    tag: "architecture",
    words: ["架构", "模块", "设计", "系统", "分层", "微服务", "扩展", "解耦"],
  },
  {
    tag: "frontend",
    words: ["前端", "界面", "页面", "组件", "react", "vue", "样式", "交互", "ui"],
  },
  { tag: "backend", words: ["后端", "服务", "接口", "api", "服务端", "逻辑", "并发"] },
  { tag: "data", words: ["数据", "数据库", "存储", "模型", "表", "sql", "缓存", "索引", "流"] },
  { tag: "infra", words: ["部署", "服务器", "容器", "docker", "k8s", "ci", "cd", "运维", "监控"] },
  {
    tag: "security",
    words: ["安全", "认证", "登录", "权限", "授权", "加密", "token", "漏洞", "合规"],
  },
  { tag: "qa", words: ["测试", "质量", "用例", "回归", "自动化", "bug", "缺陷"] },
  { tag: "ux", words: ["体验", "可用性", "交互设计", "流程", "易用", "无障碍", "可达性"] },
  { tag: "performance", words: ["性能", "速度", "延迟", "吞吐", "优化", "并发", "负载", "瓶颈"] },
  { tag: "cost", words: ["成本", "预算", "投入", "开销", "性价比", "费用"] },
];

const TAG_LABEL: Record<RoleTag, string> = {
  product: "产品",
  architecture: "架构",
  frontend: "前端",
  backend: "后端",
  data: "数据",
  infra: "基础设施",
  security: "安全",
  qa: "测试",
  ux: "体验",
  performance: "性能",
  cost: "成本",
};

/** 从命中的领域标签推导需要实例化的角色 id（去重，保持角色库顺序）。 */
export function selectRolesFromTags(tags: RoleTag[]): string[] {
  const ids = new Set<string>();
  for (const tag of tags) {
    for (const roleId of TAG_TO_ROLES[tag] ?? []) ids.add(roleId);
  }
  // 基线角色：产品负责人与架构师始终参与，保证讨论有锚点。
  ids.add("product");
  ids.add("architect");
  return ROLE_LIBRARY.filter((r) => r.kind === "participant" && ids.has(r.id)).map((r) => r.id);
}

/** 启发式意图解析（确定性、可单测）。 */
export function parseIntentHeuristic(requirement: string): IntentParseResult {
  const text = requirement.trim();
  const lower = text.toLowerCase();
  const tagHits: Array<{ tag: RoleTag; count: number }> = [];

  for (const { tag, words } of TAG_KEYWORDS) {
    let count = 0;
    for (const w of words) {
      if (lower.includes(w.toLowerCase())) count++;
    }
    if (count > 0) tagHits.push({ tag, count });
  }

  tagHits.sort((a, b) => b.count - a.count);
  // 取覆盖度最高的前 5 个领域，避免一次拉入过多角色。
  const tags = tagHits.slice(0, 5).map((h) => h.tag);
  const keywords = tagHits.flatMap((h) => {
    const entry = TAG_KEYWORDS.find((t) => t.tag === h.tag);
    return entry ? entry.words.filter((w) => lower.includes(w.toLowerCase())) : [];
  });

  const selectedRoleIds = selectRolesFromTags(tags);
  const coverage = tagHits.length / TAG_KEYWORDS.length;
  const confidence = Math.min(1, 0.4 + coverage * 0.6 + (text.length > 20 ? 0.1 : 0));

  return {
    summary: text.length > 200 ? `${text.slice(0, 200)}…` : text,
    keywords: Array.from(new Set(keywords)),
    tags,
    selectedRoleIds,
    confidence: Math.round(confidence * 100) / 100,
  };
}

// LLM 意图解析的提示词（结构化输出，便于解析）。
export const INTENT_SYSTEM_PROMPT =
  "你是需求分析助手。阅读用户需求，提取意图并选择相关专家领域。\n" +
  "严格按如下 JSON 输出，不要任何额外说明：\n" +
  "{\n" +
  '  "summary": "需求摘要（一句话）",\n' +
  '  "keywords": ["关键词1", "关键词2"],\n' +
  '  "tags": ["product|architecture|frontend|backend|data|infra|security|qa|ux|performance|cost"]\n' +
  "}\n" +
  "tags 请从上述枚举中挑选 1~5 个最相关的领域。";

export const TAG_LABELS = TAG_LABEL;
