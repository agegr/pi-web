/**
 * Research Lens (研究透镜) — recursive term explanation.
 *
 * The reader selects any term inside chat messages or inside a previous
 * explanation card; the selection is sent to /api/research/define which
 * streams an AI explanation back. Every explanation becomes a node in a
 * concept chain, so nested lookups form an explicit research path that is
 * fed back into each subsequent prompt (the "why am I asking this" context).
 *
 * Pure helpers live here so they are unit-testable without the DOM.
 */

export type ResearchDepth = "brief" | "standard" | "deep";

export interface ResearchAncestor {
  term: string;
  summary: string;
}

/** A reader question asked about one term's explanation, answered in-card. */
export interface ResearchFollowup {
  id: string;
  question: string;
  answer: string;
  status: "loading" | "done" | "error";
  error?: string;
}

export interface ResearchNode {
  id: string;
  parentId: string | null;
  term: string;
  /** Reading context window captured at request time (trimmed). */
  context?: string;
  depth: ResearchDepth;
  lang: string;
  provider?: string;
  modelId?: string;
  /** Session cwd at request time; lets the server resolve package providers. */
  cwd?: string;
  /** Whether the explanation should be grounded in web search results. */
  web?: boolean;
  /** Outcome of the requested web lookup, reported via SSE. */
  webStatus?: "ok" | "failed";
  status: "loading" | "done" | "error";
  explanation: string;
  /** Live model reasoning while status is "loading"; never persisted. */
  thinking?: string;
  /** In-card follow-up questions asked about this term's explanation. */
  followups?: ResearchFollowup[];
  error?: string;
  createdAt: number;
}

export const RESEARCH_DEPTH_ORDER: ResearchDepth[] = ["brief", "standard", "deep"];

export const MAX_TERM_LENGTH = 120;
export const MAX_CONTEXT_LENGTH = 1600;
const CONTEXT_RADIUS = 700;
const SUMMARY_MAX_LENGTH = 90;

const DEPTH_HINTS: Record<ResearchDepth, string> = {
  brief: "Answer with one crisp definition sentence. No headings, no lists, no filler.",
  standard: "Start with a one-line definition that bolds the term (**term**: definition). Then 2-4 short bullet points. No headings.",
  deep: "Start with a one-line definition that bolds the term (**term**: definition). Then at most 2-3 tight sections introduced by a **bold lead-in** (never a markdown heading) or bullets, and one concrete example. No filler.",
};

/** Map a UI locale to a human language name used inside prompts. */
export function resolveResearchLanguage(locale: string): string {
  if (locale === "zh-CN") return "Simplified Chinese (简体中文)";
  if (locale === "zh-TW") return "Traditional Chinese (繁體中文)";
  return "English";
}

/**
 * Trim the reading context to a window around the selected term so prompts
 * stay small while keeping the local meaning. Falls back to the head of the
 * text when the term cannot be located (whitespace normalization mismatches).
 */
export function trimContextAround(text: string, term: string, radius = CONTEXT_RADIUS): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const needle = term.replace(/\s+/g, " ").trim();
  const at = normalized.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) return normalized.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  const end = Math.min(normalized.length, at + needle.length + radius);
  const slice = normalized.slice(start, end);
  return `${start > 0 ? "…" : ""}${slice}${end < normalized.length ? "…" : ""}`;
}

/** First meaningful line of a markdown explanation, for chain node summaries. */
export function summarizeExplanation(markdown: string): string {
  const line = markdown
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !/^(#|[-*+]\s*$|>\s*$|\|)/.test(l));
  if (!line) return "";
  const plain = line
    .replace(/^#+\s*/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1");
  return plain.length > SUMMARY_MAX_LENGTH ? `${plain.slice(0, SUMMARY_MAX_LENGTH)}…` : plain;
}

function buildAncestorBlock(ancestors: ResearchAncestor[]): string {
  if (ancestors.length === 0) return "";
  const lines = ancestors.map((a, i) => `${i + 1}. ${a.term}${a.summary ? ` — ${a.summary}` : ""}`);
  return `<research-path>\nThe reader arrived here through these earlier explanations:\n${lines.join("\n")}\n</research-path>\n`;
}

function buildContextBlock(context: string): string {
  if (!context) return "";
  return `<reading-context>\n${context}\n</reading-context>\n`;
}

export function buildExplainSystemPrompt(depth: ResearchDepth, langName: string, hasWebContext = false): string {
  return [
    "You are a research companion helping a reader dissect unfamiliar terms while they read.",
    `Write the explanation in ${langName}.`,
    "Keep it scannable: short paragraphs, blank lines between blocks, generous use of bullet points. Never use markdown headings (#).",
    "Bold the key terms you introduce as **term** so the reader can select them to dig deeper.",
    "Output Markdown only — no code fences, no preamble, no closing remarks.",
    hasWebContext
      ? "Web search results are supplied: ground factual, version-specific or time-sensitive claims in them, cite source domains inline like (example.com), and say so if the results disagree with your prior knowledge."
      : "",
    "If a reading context is supplied and the term has a domain-specific meaning there, explain that meaning.",
    "If a research path is supplied, build on those earlier explanations instead of repeating them.",
    DEPTH_HINTS[depth],
  ].filter(Boolean).join("\n");
}

export function buildExplainUserPrompt(input: {
  term: string;
  context?: string;
  ancestors?: ResearchAncestor[];
}): string {
  const parts = [
    buildContextBlock(input.context ?? ""),
    buildAncestorBlock(input.ancestors ?? []),
  ];
  parts.push(`Explain the term: ${input.term}`);
  return parts.filter(Boolean).join("\n");
}

export interface ExplainMessages {
  system: string;
  user: string;
}

/** Formatted web search results, ready to embed in a prompt. */
export function buildWebContextBlock(query: string, results: Array<{ title: string; url: string; snippet: string }>): string {
  if (results.length === 0) return "";
  const lines = results.map((r, i) => {
    const snippet = r.snippet ? ` — ${r.snippet}` : "";
    return `${i + 1}. ${r.title}${snippet}\n   ${r.url}`;
  });
  return `<web-search-results query="${query}">\n${lines.join("\n")}\n</web-search-results>`;
}

export function buildExplainMessages(input: {
  term: string;
  context?: string;
  ancestors?: ResearchAncestor[];
  depth: ResearchDepth;
  langName: string;
  webContext?: string;
}): ExplainMessages {
  return {
    system: buildExplainSystemPrompt(input.depth, input.langName, Boolean(input.webContext)),
    user: [
      input.webContext ?? "",
      buildExplainUserPrompt({
        term: input.term,
        context: input.context,
        ancestors: input.ancestors,
      }),
    ].filter(Boolean).join("\n"),
  };
}

const MAX_PARENT_EXPLANATION = 4000;

export function buildFollowupMessages(input: {
  term: string;
  explanation: string;
  question: string;
  ancestors?: ResearchAncestor[];
  depth: ResearchDepth;
  langName: string;
  webContext?: string;
}): ExplainMessages {
  const clipped = input.explanation.slice(0, MAX_PARENT_EXPLANATION);
  return {
    system: [
      "You are a research companion. The reader is digging into one term and asks a follow-up question about your earlier explanation of it.",
      `Write the answer in ${input.langName}.`,
      "Output Markdown only — no code fences, no preamble.",
      "Answer the question directly first; add supporting detail only when it earns its place.",
      "Bold key terms as **term** so the reader can select them to dig deeper.",
      "If a research path is supplied, build on those earlier explanations instead of repeating them.",
      input.webContext
        ? "Web search results are supplied: ground factual claims in them where relevant, and cite source domains inline like (example.com)."
        : "",
      DEPTH_HINTS[input.depth],
    ].filter(Boolean).join("\n"),
    user: [
      input.webContext ?? "",
      buildAncestorBlock(input.ancestors ?? []),
      `<term-explanation term="${input.term}">\n${clipped}\n</term-explanation>`,
      `Reader's follow-up question: ${input.question}`,
    ].filter(Boolean).join("\n"),
  };
}

/** Walk from a node to its root, producing the ancestor chain (root first). */
export function buildAncestorsForNode(
  nodes: ResearchNode[],
  parentId: string | null,
): ResearchAncestor[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: ResearchAncestor[] = [];
  let current = parentId ? byId.get(parentId) : undefined;
  let guard = 0;
  while (current && guard++ < 64) {
    chain.unshift({ term: current.term, summary: summarizeExplanation(current.explanation) });
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/** Prefer reusing an already-answered identical lookup over a new request. */
export function findExistingNode(
  nodes: ResearchNode[],
  term: string,
  parentId: string | null,
  depth: ResearchDepth,
): ResearchNode | undefined {
  const needle = term.trim().toLowerCase();
  return nodes.find(
    (n) =>
      n.parentId === parentId
      && n.depth === depth
      && n.term.trim().toLowerCase() === needle
      && n.status !== "loading",
  );
}

interface MarkdownAccumulator {
  lines: string[];
  push(line: string): void;
  toString(): string;
}

function createAccumulator(): MarkdownAccumulator {
  const lines: string[] = [];
  return {
    lines,
    push(line: string) { lines.push(line); },
    toString() { return lines.join("\n"); },
  };
}

function renderChainNode(
  node: ResearchNode,
  childrenOf: Map<string | null, ResearchNode[]>,
  level: number,
  acc: MarkdownAccumulator,
): void {
  const heading = `${"#".repeat(Math.min(level + 1, 6))} ${node.term}`;
  acc.push(heading);
  acc.push("");
  if (node.explanation.trim()) {
    acc.push(node.explanation.trim());
    acc.push("");
  }
  for (const f of node.followups ?? []) {
    acc.push(`**Q: ${f.question}**`);
    acc.push("");
    if (f.answer.trim()) {
      acc.push(f.answer.trim());
      acc.push("");
    }
  }
  const children = childrenOf.get(node.id) ?? [];
  for (const child of children) renderChainNode(child, childrenOf, level + 1, acc);
}

/**
 * Export the whole forest of chains as a Markdown note, e.g. for Obsidian.
 * Depth is expressed through heading levels, capped at h6.
 */
export function buildChainMarkdown(nodes: ResearchNode[], generatedAt = new Date()): string {
  const childrenOf = new Map<string | null, ResearchNode[]>();
  for (const node of nodes) {
    const key = node.parentId && nodes.some((n) => n.id === node.parentId) ? node.parentId : null;
    const list = childrenOf.get(key) ?? [];
    list.push(node);
    childrenOf.set(key, list);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt);
  }

  const acc = createAccumulator();
  acc.push("# Concept chain");
  acc.push("");
  acc.push(`_Generated ${generatedAt.toISOString()} · Pi Web research lens_`);
  acc.push("");
  for (const root of childrenOf.get(null) ?? []) {
    renderChainNode(root, childrenOf, 2, acc);
  }
  return acc.toString();
}

export function newResearchNodeId(): string {
  return `res-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ── Mind map export (FreeMind .mm) ─────────────────────────────────── */

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mindMapNodeXml(
  text: string,
  children: string[],
  indent: string,
): string {
  if (children.length === 0) return `${indent}<node TEXT="${escapeXml(text)}"/>`;
  return [
    `${indent}<node TEXT="${escapeXml(text)}">`,
    ...children,
    `${indent}</node>`,
  ].join("\n");
}

function mindMapChainNode(
  node: ResearchNode,
  childrenOf: Map<string | null, ResearchNode[]>,
  indent: string,
): string {
  const summary = summarizeExplanation(node.explanation) || node.term;
  const children: string[] = [mindMapNodeXml(summary, [], `${indent}  `)];
  for (const f of node.followups ?? []) {
    children.push(mindMapNodeXml(`Q: ${f.question}`, [], `${indent}  `));
  }
  for (const child of childrenOf.get(node.id) ?? []) {
    children.push(mindMapChainNode(child, childrenOf, `${indent}  `));
  }
  return mindMapNodeXml(node.term, children, indent);
}

/** FreeMind .mm mind map: term → summary + follow-up questions + children. */
export function buildChainFreeMind(nodes: ResearchNode[], generatedAt = new Date()): string {
  const childrenOf = new Map<string | null, ResearchNode[]>();
  for (const node of nodes) {
    const key = node.parentId && nodes.some((n) => n.id === node.parentId) ? node.parentId : null;
    const list = childrenOf.get(key) ?? [];
    list.push(node);
    childrenOf.set(key, list);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.createdAt - b.createdAt);

  const roots = (childrenOf.get(null) ?? []).map((root) =>
    mindMapChainNode(root, childrenOf, "  "),
  );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<map version="1.0.1">`,
    `  <node TEXT="Concept Chain (${escapeXml(generatedAt.toISOString().slice(0, 10))})">`,
    ...roots,
    `  </node>`,
    `</map>`,
    ``,
  ].join("\n");
}

/* ── Self-contained HTML mind map ───────────────────────────────────── */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlMindMapNode(
  node: ResearchNode,
  childrenOf: Map<string | null, ResearchNode[]>,
  indent: string,
): string {
  const child = (cls: string, text: string): string =>
    `${indent}  <li><span class="node ${cls}">${escapeHtml(text)}</span></li>`;
  const lines: string[] = [
    `${indent}<li><span class="node term">${escapeHtml(node.term)}</span>`,
    `${indent}  <ul>`,
    child("summary", summarizeExplanation(node.explanation) || node.term),
  ];
  for (const f of node.followups ?? []) {
    lines.push(child("q", `Q: ${f.question}`));
  }
  for (const c of childrenOf.get(node.id) ?? []) {
    lines.push(htmlMindMapNode(c, childrenOf, `${indent}  `));
  }
  lines.push(`${indent}  </ul>`, `${indent}</li>`);
  return lines.join("\n");
}

/**
 * A double-click-to-open, dependency-free mind map: a self-contained HTML
 * document with a collapsible tree and an embedded .mm download link for
 * XMind/FreeMind users.
 */
export function buildChainHtmlMindmap(nodes: ResearchNode[], generatedAt = new Date()): string {
  const childrenOf = new Map<string | null, ResearchNode[]>();
  for (const node of nodes) {
    const key = node.parentId && nodes.some((n) => n.id === node.parentId) ? node.parentId : null;
    const list = childrenOf.get(key) ?? [];
    list.push(node);
    childrenOf.set(key, list);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.createdAt - b.createdAt);

  const roots = (childrenOf.get(null) ?? [])
    .map((root) => htmlMindMapNode(root, childrenOf, "      "))
    .join("\n");
  const freeMind = buildChainFreeMind(nodes, generatedAt).replace(/<\/script/gi, "<\\/script");
  const dateLabel = escapeHtml(generatedAt.toISOString().slice(0, 10));

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>概念链思维导图 · ${dateLabel}</title>
<style>
  :root { --line: #d5dbe1; --accent: #2563eb; --bg: #ffffff; --text: #1a1a1a; --muted: #6b7280; --node: #f6f8fa; }
  @media (prefers-color-scheme: dark) {
    :root { --line: #30363d; --bg: #0d1117; --text: #e6edf3; --muted: #8b949e; --node: #161b22; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px; background: var(--bg); color: var(--text); font: 14px/1.65 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .meta { color: var(--muted); font-size: 12px; margin-bottom: 18px; }
  .meta a { color: var(--accent); }
  .toolbar { margin-bottom: 14px; display: flex; gap: 8px; }
  .toolbar button { font: inherit; font-size: 12px; padding: 4px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--node); color: var(--text); cursor: pointer; }
  .toolbar button:hover { border-color: var(--accent); color: var(--accent); }
  ul.tree { list-style: none; margin: 0; padding: 0; }
  ul.tree ul { list-style: none; margin: 0 0 0 10px; padding-left: 22px; border-left: 1px solid var(--line); }
  ul.tree li { position: relative; padding: 2px 0 2px 14px; }
  ul.tree li::before { content: ""; position: absolute; left: -12px; top: 15px; width: 12px; height: 1px; background: var(--line); }
  .node { display: inline-block; border: 1px solid var(--line); border-radius: 8px; background: var(--node); padding: 4px 10px; margin: 2px 0; max-width: 640px; }
  .node.term { font-weight: 600; border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); cursor: pointer; user-select: none; }
  .node.term::after { content: " ▸"; color: var(--muted); font-size: 11px; }
  .node.summary { color: var(--muted); font-size: 12.5px; border-style: dashed; max-width: 560px; }
  .node.q { color: var(--accent); font-size: 12.5px; }
  li.collapsed > ul { display: none; }
  li.collapsed > .node.term::after { content: " …"; }
</style>
</head>
<body>
<h1>概念链思维导图</h1>
<div class="meta">生成于 ${dateLabel} · Pi Web 研究模式 · <a id="download-mm" href="#">下载 .mm（XMind / FreeMind）</a> · 点击术语节点可折叠/展开</div>
<div class="toolbar">
  <button type="button" id="expand-all">全部展开</button>
  <button type="button" id="collapse-all">全部收起</button>
</div>
<ul class="tree">
${roots}
</ul>
<script type="text/plain" id="mm-data">${freeMind}</script>
<script>
  document.querySelectorAll(".node.term").forEach(function (el) {
    el.addEventListener("click", function () {
      el.closest("li").classList.toggle("collapsed");
    });
  });
  document.getElementById("expand-all").addEventListener("click", function () {
    document.querySelectorAll("li.collapsed").forEach(function (li) { li.classList.remove("collapsed"); });
  });
  document.getElementById("collapse-all").addEventListener("click", function () {
    document.querySelectorAll("ul.tree li").forEach(function (li) {
      if (li.querySelector(":scope > ul")) li.classList.add("collapsed");
    });
  });
  var mm = document.getElementById("mm-data").textContent;
  var link = document.getElementById("download-mm");
  link.href = "data:text/xml;charset=utf-8," + encodeURIComponent(mm);
  link.download = "concept-chain.mm";
</script>
</body>
</html>
`;
}

/* ── Anki export (CSV, HTML back side) ──────────────────────────────── */

/**
 * Minimal markdown → Anki-friendly HTML. Covers the shapes the explain
 * prompts produce (definition line, bullets, bold, inline code); anything
 * else passes through as plain text lines.
 */
export function markdownToBasicHtml(markdown: string): string {
  const inline = (text: string): string => text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[(.+?)\]\((.+?)\)/g, "<em>$1</em>");

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) { out.push("</ul>"); listOpen = false; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      if (!listOpen) { out.push("<ul>"); listOpen = true; }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    closeList();
    if (line.trim().length === 0) continue;
    out.push(`<p>${inline(line.trim())}</p>`);
  }
  closeList();
  return out.join("");
}

function csvField(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function ankiTagsFor(node: ResearchNode, nodes: ResearchNode[]): string {
  const root = (() => {
    let current: ResearchNode | undefined = node;
    let guard = 0;
    while (current?.parentId && guard++ < 64) {
      current = nodes.find((n) => n.id === current!.parentId);
    }
    return current?.term ?? node.term;
  })();
  return `research-lens ${root.trim().replace(/\s+/g, "_")}`.slice(0, 80);
}

/**
 * Anki-importable CSV (semicolon-free fields, HTML answer side, follow-up
 * Q/A appended under a rule). Starts with Anki's directive headers plus a
 * UTF-8 BOM so Excel and Anki both detect the encoding.
 */
export function buildAnkiCsv(nodes: ResearchNode[]): string {
  const rows: string[] = ["#separator:Comma", "#html:true", "#tags column:3"];
  for (const node of nodes) {
    if (node.status !== "done") continue;
    const answerParts: string[] = [];
    const explanationHtml = markdownToBasicHtml(node.explanation);
    if (explanationHtml) answerParts.push(`<div>${explanationHtml}</div>`);
    for (const f of node.followups ?? []) {
      if (f.status !== "done" || !f.answer.trim()) continue;
      answerParts.push(`<hr><div><strong>Q: ${inlineEscape(f.question)}</strong></div><div>${markdownToBasicHtml(f.answer)}</div>`);
    }
    rows.push([csvField(node.term), csvField(answerParts.join("")), csvField(ankiTagsFor(node, nodes))].join(","));
  }
  return `\uFEFF${rows.join("\n")}\n`;
}

function inlineEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
