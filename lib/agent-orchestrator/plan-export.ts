// 计划讨论快照导出器：把 OrchestrationSnapshot 序列化为 Markdown / HTML。
// 纯函数，不依赖 pi CLI（普通会话导出走 pi 的 export-html 模块只认 .jsonl，
// 计划讨论数据结构不同，需独立 formatter）。复用现有类型定义，不改数据层。

import type {
  ConvergenceState,
  DiscussionMessage,
  OrchestrationSnapshot,
  RecommendationPlan,
} from "./orchestrator-types";

/** 收敛原因的中文标签（供导出文档可读，不依赖前端 i18n）。 */
const CONVERGE_LABEL: Record<ConvergenceState["reason"], string> = {
  round_threshold: "达到轮次上限",
  arbiter_signal: "仲裁者达成共识",
  stabilized: "观点趋于稳定",
  user_forced: "用户强制结束",
  none: "未收敛",
};

/** 讨论消息的发送方显示名。 */
function senderLabel(m: DiscussionMessage): string {
  if (m.kind === "user") return "用户需求";
  if (m.kind === "arbiter") return "仲裁者";
  if (m.kind === "system") return "系统";
  return m.fromName || m.from;
}

/** 把单个推荐方案渲染为 Markdown 片段。 */
function planToMarkdown(p: RecommendationPlan, index: number): string {
  const confidence = `${Math.round(p.confidence * 100)}%`;
  const sections = [
    `### ${index + 1}. ${p.title}（置信度 ${confidence}）`,
    "",
    p.summary || "（无描述）",
    "",
    "**优点**",
    ...(p.pros.length > 0 ? p.pros.map((x) => `- ${x}`) : ["- （无）"]),
    "",
    "**缺点 / 风险**",
    ...(p.cons.length > 0 ? p.cons.map((x) => `- ${x}`) : ["- （无）"]),
    "",
    "**适用场景**",
    ...(p.scenarios.length > 0 ? p.scenarios.map((x) => `- ${x}`) : ["- （无）"]),
  ];
  return sections.join("\n");
}

/** 把 OrchestrationSnapshot 序列化为完整 Markdown 文档。
 *  结构：标题 + 元信息 → 讨论时间线（完整 messages）→ 推荐方案 → 执行任务。 */
export function snapshotToMarkdown(s: OrchestrationSnapshot): string {
  const updated = new Date(s.updatedAt).toLocaleString("zh-CN", { hour12: false });
  const meta = [
    `> 状态：${s.status}　|　轮次：${s.rounds.length}　|　更新：${updated}`,
    s.convergence.converged
      ? `> 收敛：${CONVERGE_LABEL[s.convergence.reason] ?? s.convergence.reason}`
      : "",
    typeof s.convergence.consensusScore === "number"
      ? `> 共识度：${Math.round(s.convergence.consensusScore * 100)}%`
      : "",
  ].filter(Boolean);

  const timeline = [
    "## 讨论时间线",
    "",
    ...(s.messages.length === 0
      ? ["（尚无讨论记录）"]
      : s.messages.map((m) => {
          const label = senderLabel(m);
          const roundTag = m.round > 0 ? `（第 ${m.round} 轮）` : "";
          return [`#### 【${label}】${roundTag}`, "", m.content].join("\n");
        })),
  ];

  const plansSection = [
    "## 推荐方案",
    "",
    ...(s.plans.length === 0 ? ["（暂无推荐方案）"] : s.plans.map((p, i) => planToMarkdown(p, i))),
  ];

  const tasksSection =
    s.tasks.length > 0
      ? ["", "## 执行任务", "", ...s.tasks.map((t, i) => `${i + 1}. ${t.title}`)]
      : [];

  const errorSection = s.error ? ["", "## 错误信息", "", s.error] : [];

  return [
    `# 计划讨论：${s.requirement || "（无标题）"}`,
    "",
    ...meta,
    "",
    ...timeline,
    "",
    ...plansSection,
    ...tasksSection,
    ...errorSection,
  ].join("\n");
}

/** HTML 转义（防止讨论内容含 < > & 破坏文档结构）。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 简易 Markdown → HTML 行级转换（仅处理导出文档用到的子集：标题/列表/引用/加粗/段落）。
 *  不引入 markdown 解析依赖；PlanPanel 前端预览用 react-markdown，导出文档只需可读 HTML。 */
function markdownLineToHtml(line: string): string {
  // 标题
  const h = /^(#{1,4})\s+(.*)$/.exec(line);
  if (h) {
    const level = h[1].length;
    return `<h${level}>${escapeHtml(h[2])}</h${level}>`;
  }
  // 引用
  if (line.startsWith("> ")) return `<blockquote>${escapeHtml(line.slice(2))}</blockquote>`;
  // 无序列表
  if (line.startsWith("- ")) return `<li>${inlineMd(escapeHtml(line.slice(2)))}</li>`;
  // 有序列表
  const ol = /^\d+\.\s+(.*)$/.exec(line);
  if (ol) return `<li>${inlineMd(escapeHtml(ol[1]))}</li>`;
  // 空行
  if (line.trim() === "") return "";
  // 普通段落
  return `<p>${inlineMd(escapeHtml(line))}</p>`;
}

/** 行内 Markdown：加粗 **text** → <strong>。 */
function inlineMd(html: string): string {
  return html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/** 把 OrchestrationSnapshot 序列化为独立 HTML 文档（含内联基础样式，可浏览器直接打开）。 */
export function snapshotToHtml(s: OrchestrationSnapshot): string {
  const md = snapshotToMarkdown(s);
  // 按行转 HTML，连续 <li> 合并为 <ul>
  const lines = md.split("\n");
  const bodyParts: string[] = [];
  let inList = false;
  for (const line of lines) {
    const isLi = /^\s*<li>/.test(line) || line.startsWith("- ") || /^\d+\.\s/.test(line);
    const htmlLine = markdownLineToHtml(line);
    if (isLi) {
      if (!inList) {
        bodyParts.push("<ul>");
        inList = true;
      }
      bodyParts.push(htmlLine);
    } else {
      if (inList) {
        bodyParts.push("</ul>");
        inList = false;
      }
      if (htmlLine) bodyParts.push(htmlLine);
    }
  }
  if (inList) bodyParts.push("</ul>");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(s.requirement || "计划讨论")} · 导出</title>
<style>
  body { font-family: -apple-system, "PingFang SC", system-ui, sans-serif; max-width: 820px; margin: 40px auto; padding: 0 20px; color: #1f2329; line-height: 1.7; }
  h1 { font-size: 22px; border-bottom: 2px solid #10b981; padding-bottom: 8px; }
  h2 { font-size: 17px; margin-top: 28px; border-left: 4px solid #10b981; padding-left: 10px; }
  h3 { font-size: 15px; margin-top: 20px; }
  h4 { font-size: 13px; color: #6b7280; margin-top: 14px; margin-bottom: 4px; }
  blockquote { color: #6b7280; border-left: 3px solid #e5e7eb; margin: 8px 0; padding: 2px 12px; font-size: 13px; }
  ul { padding-left: 22px; }
  li { margin: 3px 0; font-size: 14px; }
  p { font-size: 14px; margin: 8px 0; }
  pre { background: #f6f8fa; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 13px; }
</style>
</head>
<body>
${bodyParts.join("\n")}
</body>
</html>`;
}
