/**
 * The Session Info panel's context breakdown: what the next request would carry, split into
 * estimated categories. Ported from pi-context-view's Usage view (MIT, src/usage.ts and
 * src/measure.ts), without its request capture: the inputs are the wrapper's live state, so a
 * change an extension makes only to the request sent is not seen. Server-only (pi SDK helpers).
 */
import { convertToLlm, estimateTokens, type ContextEvent } from "@earendil-works/pi-coding-agent";
import type { ContextBreakdown, ContextCategory, ContextInvisibleReasoning, ContextPreviewEntry } from "./context-usage-types";

/** Preview text kept per entry; the rest is only counted (`truncatedChars`). */
export const CONTEXT_PREVIEW_MAX_CHARS = 4_000;

const MCP_EXTENSION_PATH = "builtin:mcp";
const MCP_TOOL_PREFIX = "mcp__";
const PI_WEB_INLINE_PATH_PREFIX = "<inline:pi-web-";

type ContextMessage = ContextEvent["messages"][number];
type AssistantMessage = Extract<ContextMessage, { role: "assistant" }>;
type ToolResultMessage = Extract<ContextMessage, { role: "toolResult" }>;
type CustomMessage = Extract<ContextMessage, { role: "custom" }>;

/** One tool declaration the next request sends. */
export interface ContextToolDeclaration {
  name: string;
  description: string;
  parameters?: unknown;
  sourceInfo?: unknown;
}

export interface ContextUsageInputs {
  systemPrompt: string;
  tools: readonly ContextToolDeclaration[];
  /** The agent's messages, as the next request's transform receives them. */
  messages: readonly ContextMessage[];
  reported?: ContextBreakdown["reported"];
  /** The next request's model; another model's thinking is left out, as pi drops it. */
  model?: { provider: string; api?: string; id: string };
  reserveTokens?: number;
  now?: number;
}

export function computeContextUsage(inputs: ContextUsageInputs): ContextBreakdown {
  const categories = withoutEmpty([
    ...classifyPrompt(inputs.systemPrompt),
    ...classifyTools(inputs.tools),
    ...classifyMessages(inputs.messages, inputs.model),
  ]).map(capEntries);
  return {
    categories,
    estimatedTokens: categories.reduce((sum, category) => sum + category.tokens, 0),
    reported: inputs.reported ?? null,
    ...(inputs.reserveTokens !== undefined && inputs.reserveTokens > 0 ? { reserveTokens: inputs.reserveTokens } : {}),
    computedAt: inputs.now ?? Date.now(),
  };
}

// --- System prompt ---------------------------------------------------------------------------

/** Labels of the sections pi renders; any other tag keeps its own name. */
const SECTION_LABELS: Record<string, string> = {
  tools: "Tools",
  rules: "Rules",
  docs: "Docs",
  addendum: "Addendum",
  cwd: "Current Dir",
};

/** One complete top-level XML section of the prompt; `body` excludes the tag lines. */
export interface PromptSection {
  name: string;
  start: number;
  end: number;
  body: string;
}

/**
 * pi's top-level sections (`<name>\n…\n</name>`) in prompt order. Whole sections and fenced
 * examples are skipped, so tags inside instruction files, skills or addenda are not sections.
 */
export function findPromptSections(prompt: string): PromptSection[] {
  const sections: PromptSection[] = [];
  let fence: string | undefined;
  const pattern = /^<([a-z][a-z0-9_-]*)>\n|^ {0,3}(`{3,}|~{3,})([^\n]*)/gm;
  for (let match = pattern.exec(prompt); match !== null; match = pattern.exec(prompt)) {
    const marker = match[2];
    if (marker !== undefined) {
      if (fence === undefined) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && match[3].trim() === "") fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const name = match[1];
    const closing = `\n</${name}>`;
    const end = prompt.indexOf(closing, pattern.lastIndex);
    if (end === -1) continue;
    const after = end + closing.length;
    if (after < prompt.length && prompt[after] !== "\n") continue;
    sections.push({ name, start: match.index, end: after, body: prompt.slice(pattern.lastIndex, end) });
    pattern.lastIndex = after;
  }
  return sections;
}

/**
 * System Prompt, Instruction Files and Skills. Instruction files count their content and
 * skills their name, description and location; System Prompt counts everything else,
 * including the tags and the wrappers around those records, so the three add up to the prompt.
 */
function classifyPrompt(prompt: string): ContextCategory[] {
  if (!prompt) return [];
  const sections = findPromptSections(prompt);
  const parts: ContextCategory[] = [];
  const contextFiles: ContextCategory[] = [];
  const skills: ContextCategory[] = [];
  let recordChars = 0;
  let partChars = 0;

  const addPart = (id: string, label: string, text: string) => {
    if (!text.trim()) return;
    partChars += text.length;
    parts.push(textLeaf(`prompt:${id}`, label, [label], text));
  };

  addPart("preamble", "Preamble", prompt.slice(0, sections[0]?.start ?? prompt.length));
  sections.forEach((section, index) => {
    if (section.name === "project_context") {
      const files = contextFileRecords(section.body);
      if (files.length > 0) {
        for (const file of files) {
          recordChars += file.content.length;
          contextFiles.push(textLeaf(`context-file:${file.path}`, file.path, [file.path], file.content));
        }
        return;
      }
    }
    if (section.name === "skills") {
      const records = skillRecords(section.body);
      if (records.length > 0) {
        for (const skill of records) {
          recordChars += skill.text.length;
          skills.push(textLeaf(`skill:${skill.name}`, skill.name, [skill.name], skill.text));
        }
        return;
      }
    }
    addPart(`section:${section.name}`, SECTION_LABELS[section.name] ?? section.name, section.body);
    // Text an extension added between or after sections
    const gapEnd = sections[index + 1]?.start ?? prompt.length;
    addPart(`gap:${index}`, "Extension Additions", prompt.slice(section.end, gapEnd));
  });

  // Tags, wrappers and blank lines between parts: sent, but no part's own text
  const framingChars = Math.max(0, prompt.length - recordChars - partChars);
  const totalTokens = textTokens(prompt.length);
  const counted = [...parts, ...contextFiles, ...skills].reduce((sum, part) => sum + part.tokens, 0);
  const framingTokens = Math.max(0, totalTokens - counted);
  if (framingChars > 0 && framingTokens > 0) {
    parts.push({ id: "prompt:framing", label: "Framing", tokens: framingTokens, entries: [{
      breadcrumb: ["Framing"],
      tokens: framingTokens,
      text: `XML tags, record wrappers and separators (${framingChars.toLocaleString("en-US")} chars)`,
    }] });
  }

  return withoutEmpty([
    aggregate("system-prompt", "System Prompt", parts, false),
    aggregate("context-files", "Instruction Files", contextFiles),
    aggregate("skills", "Skills", skills),
  ]);
}

/** pi's `<project_instructions path="…">` records, content without the wrapper's newlines. */
function contextFileRecords(body: string): Array<{ path: string; content: string }> {
  const records: Array<{ path: string; content: string }> = [];
  const open = /<project_instructions path="([^"]*)">\n?/g;
  const close = "</project_instructions>";
  for (let match = open.exec(body); match !== null; match = open.exec(body)) {
    const end = body.indexOf(close, open.lastIndex);
    if (end === -1) break;
    let content = body.slice(open.lastIndex, end);
    if (content.endsWith("\n")) content = content.slice(0, -1);
    records.push({ path: match[1], content });
    open.lastIndex = end + close.length;
  }
  return records;
}

/** pi's `<skill>` records in `<available_skills>`, XML entities decoded. */
function skillRecords(body: string): Array<{ name: string; text: string }> {
  if (!body.includes("<available_skills>")) return [];
  const record = /<skill>\s*<name>(.*?)<\/name>\s*<description>([\s\S]*?)<\/description>\s*<location>(.*?)<\/location>/g;
  return [...body.matchAll(record)].map((match) => ({
    name: decodeXml(match[1]),
    text: [match[1], match[2], match[3]].map(decodeXml).join("\n"),
  }));
}

function decodeXml(text: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_match, name: string) => entities[name]);
}

// --- Tools -----------------------------------------------------------------------------------

function sourceOf(tool: ContextToolDeclaration): { source?: string; path?: string } {
  const info = tool.sourceInfo;
  if (typeof info !== "object" || info === null) return {};
  const { source, path } = info as { source?: unknown; path?: unknown };
  return {
    source: typeof source === "string" ? source : undefined,
    path: typeof path === "string" ? path : undefined,
  };
}

export function toolCategoryId(tool: ContextToolDeclaration): "built-in-tools" | "mcp-tools" | "custom-tools" {
  const { source, path } = sourceOf(tool);
  if (path === MCP_EXTENSION_PATH || tool.name.startsWith(MCP_TOOL_PREFIX)) return "mcp-tools";
  // pi-web's own inline overrides (bash with the project's environment) stay built-in
  if (source === "builtin" || path?.startsWith("builtin:") || path?.startsWith(PI_WEB_INLINE_PATH_PREFIX)) return "built-in-tools";
  return "custom-tools";
}

/** A declaration counts its name, description and parameter schema, as the request sends them. */
function classifyTools(tools: readonly ContextToolDeclaration[]): ContextCategory[] {
  const groups: Record<ReturnType<typeof toolCategoryId>, ContextCategory[]> = {
    "built-in-tools": [],
    "custom-tools": [],
    "mcp-tools": [],
  };
  for (const tool of tools) {
    const schema = tool.parameters === undefined ? "" : JSON.stringify(tool.parameters) ?? "";
    const text = `${tool.name}: ${tool.description}\n${schema}`;
    groups[toolCategoryId(tool)].push(textLeaf(`tool:${tool.name}`, tool.name, [tool.name], text));
  }
  return withoutEmpty([
    aggregate("built-in-tools", "Built-in Tools", groups["built-in-tools"]),
    aggregate("custom-tools", "Custom Tools", groups["custom-tools"]),
    aggregate("mcp-tools", "MCP Tools", groups["mcp-tools"]),
  ]);
}

// --- Messages --------------------------------------------------------------------------------

function isSameModel(message: AssistantMessage, model: NonNullable<ContextUsageInputs["model"]>): boolean {
  return message.provider === model.provider
    && (model.api === undefined || message.api === model.api)
    && message.model === model.id;
}

function classifyMessages(
  messages: readonly ContextMessage[],
  model: ContextUsageInputs["model"],
): ContextCategory[] {
  const user: ContextPreviewEntry[] = [];
  const assistantText: ContextPreviewEntry[] = [];
  const assistantThinking: ContextPreviewEntry[] = [];
  const toolCalls: ContextPreviewEntry[] = [];
  const bashExecutions: ContextPreviewEntry[] = [];
  const compacted: ContextPreviewEntry[] = [];
  const toolResults: ToolResultMessage[] = [];
  const customMessages: CustomMessage[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "user":
        user.push({ timestamp: message.timestamp, breadcrumb: ["user"], tokens: estimateTokens(message), text: contentToText(message.content) });
        break;
      case "assistant": {
        const texts = message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
        assistantText.push(...blockEntries(message.timestamp, "text", texts));
        // pi drops another model's thinking and signatures from the request
        if (model === undefined || isSameModel(message, model)) assistantThinking.push(...thinkingEntries(message));
        for (const block of message.content) {
          if (block.type !== "toolCall") continue;
          const args = JSON.stringify(block.arguments) ?? "";
          toolCalls.push({
            timestamp: message.timestamp,
            breadcrumb: ["assistant", block.name],
            tokens: textTokens(block.name.length + args.length),
            text: `${block.name}(${args})`,
          });
        }
        break;
      }
      case "toolResult":
        toolResults.push(message);
        break;
      case "custom":
        customMessages.push(message);
        break;
      case "bashExecution": {
        // The transform drops `!!` executions: they never reach the provider
        const tokens = transformedTokens(message);
        if (tokens !== undefined) {
          bashExecutions.push({ timestamp: message.timestamp, breadcrumb: ["bash"], tokens, text: `$ ${message.command}\n${message.output}` });
        }
        break;
      }
      case "branchSummary":
        compacted.push({ timestamp: message.timestamp, breadcrumb: ["branch"], tokens: transformedTokens(message) ?? 0, text: message.summary });
        break;
      case "compactionSummary":
        compacted.push({ timestamp: message.timestamp, breadcrumb: ["compaction"], tokens: transformedTokens(message) ?? 0, text: message.summary });
        break;
      default:
        // System messages: their sections are the system prompt, counted above
        break;
    }
  }

  return withoutEmpty([
    leaf("user-messages", "User Messages", user),
    leaf("assistant-messages", "Assistant Messages", assistantText),
    leaf("assistant-thinking", "Assistant Thinking", assistantThinking),
    leaf("tool-calls", "Tool Calls", toolCalls),
    aggregate("tool-output", "Tool Output", withoutEmpty([
      ...leavesFromGroups("tool-result", groupBy(toolResults, (message) => message.toolName)),
      leaf("bash-executions", "Bash Executions", bashExecutions),
    ])),
    aggregate("extensions", "Extensions", leavesFromGroups("custom-message", groupBy(customMessages, (message) => message.customType))),
    leaf("compacted-data", "Compacted Data", compacted),
  ]);
}

/**
 * Tokens of a message as pi's transform sends it (summary tags, bash framing included);
 * undefined for a message the transform leaves out.
 */
function transformedTokens(message: ContextMessage): number | undefined {
  const converted = convertToLlm([message])[0];
  return converted === undefined ? undefined : estimateTokens(converted);
}

/**
 * Thinking entries, counted once per assistant message: a provider-reported reasoning count
 * replaces a smaller visible-text estimate; a signature-size proxy is only noted.
 */
function thinkingEntries(message: AssistantMessage): ContextPreviewEntry[] {
  const texts = message.content.flatMap((block) => (block.type === "thinking" ? [block.thinking] : []));
  const visibleTokens = textTokens(texts.reduce((sum, text) => sum + text.length, 0));
  const reportedTokens = reportedReasoningTokens(message);
  const countedTokens = Math.max(visibleTokens, reportedTokens ?? 0);
  const signatureChars = message.content.reduce((sum, block) => {
    if (block.type === "thinking") return sum + stringLength(block.thinkingSignature);
    if (block.type === "toolCall") return sum + stringLength((block as { thoughtSignature?: unknown }).thoughtSignature);
    return sum;
  }, 0);
  const invisibleReasoning = invisibleReasoningEstimate(signatureChars, visibleTokens, reportedTokens);

  if (texts.length === 0) {
    if (countedTokens === 0 && invisibleReasoning === undefined) return [];
    return [{
      timestamp: message.timestamp,
      breadcrumb: ["assistant"],
      tokens: countedTokens,
      ...(invisibleReasoning === undefined ? {} : { visibleTokens: 0, invisibleReasoning }),
      text: "",
    }];
  }

  const allocations = allocateTextTokens(texts);
  const entries = texts.map((text, index): ContextPreviewEntry => ({
    timestamp: message.timestamp,
    breadcrumb: texts.length > 1 ? ["assistant", `thinking ${index + 1}/${texts.length}`] : ["assistant"],
    tokens: allocations[index] ?? 0,
    text,
  }));
  const first = entries[0];
  entries[0] = {
    ...first,
    tokens: first.tokens + countedTokens - visibleTokens,
    ...(invisibleReasoning === undefined ? {} : { visibleTokens: first.tokens, invisibleReasoning }),
  };
  return entries;
}

function invisibleReasoningEstimate(
  signatureChars: number,
  visibleTokens: number,
  reportedTokens: number | undefined,
): ContextInvisibleReasoning | undefined {
  if (reportedTokens !== undefined) {
    const tokens = Math.max(0, reportedTokens - visibleTokens);
    return tokens === 0 ? undefined : { tokens, basis: "provider-reported", encoded: signatureChars > 0 };
  }
  if (signatureChars === 0) return undefined;
  // chars/4 over a signature is a rough proxy, not a bound (pi-context-view doc/THINKING.md)
  return { tokens: textTokens(signatureChars), basis: "signature-proxy", encoded: true };
}

/** A finite, non-negative provider reasoning count from possibly old session data. */
function reportedReasoningTokens(message: AssistantMessage): number | undefined {
  const usage: unknown = message.usage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const reasoning = (usage as { reasoning?: unknown }).reasoning;
  return typeof reasoning === "number" && Number.isFinite(reasoning) && reasoning >= 0 ? reasoning : undefined;
}

/** chars/4 rounding pooled across blocks, one entry per block. */
function allocateTextTokens(texts: readonly string[]): number[] {
  const allocations = texts.map((text) => Math.floor(text.length / 4));
  const target = textTokens(texts.reduce((sum, text) => sum + text.length, 0));
  let remainder = target - allocations.reduce((sum, tokens) => sum + tokens, 0);
  const ranked = texts
    .map((text, index) => ({ index, remainder: text.length % 4 }))
    .filter((candidate) => candidate.remainder > 0)
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const candidate of ranked) {
    if (remainder === 0) break;
    allocations[candidate.index] += 1;
    remainder--;
  }
  return allocations;
}

function stringLength(value: unknown): number {
  return typeof value === "string" ? value.length : 0;
}

function blockEntries(timestamp: number, kind: string, texts: readonly string[]): ContextPreviewEntry[] {
  return texts.map((text, index) => ({
    timestamp,
    breadcrumb: texts.length > 1 ? ["assistant", `${kind} ${index + 1}/${texts.length}`] : ["assistant"],
    tokens: textTokens(text.length),
    text,
  }));
}

/** Text of string-or-block content; other blocks (images) become placeholders. */
function contentToText(content: string | ReadonlyArray<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => (block.type === "text" && block.text !== undefined ? block.text : `[${block.type}]`))
    .join("\n");
}

function leavesFromGroups(
  idPrefix: string,
  groups: ReadonlyMap<string, ReadonlyArray<ToolResultMessage | CustomMessage>>,
): ContextCategory[] {
  return [...groups].map(([label, messages]) => leaf(`${idPrefix}:${label}`, label, messages.map((message) => ({
    timestamp: message.timestamp,
    breadcrumb: [label],
    tokens: estimateTokens(message),
    text: contentToText(message.content as string | Array<{ type: string; text?: string }>),
  }))));
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    const group = groups.get(name);
    if (group) group.push(item);
    else groups.set(name, [item]);
  }
  return groups;
}

// --- Shared ----------------------------------------------------------------------------------

/** pi's chars/4 heuristic for text. */
function textTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function textLeaf(id: string, label: string, breadcrumb: string[], text: string): ContextCategory {
  const tokens = textTokens(text.length);
  return { id, label, tokens, entries: [{ breadcrumb, tokens, text }] };
}

/** A leaf whose estimate is the exact sum of its entries. */
function leaf(id: string, label: string, entries: ContextPreviewEntry[]): ContextCategory {
  return { id, label, tokens: entries.reduce((sum, entry) => sum + entry.tokens, 0), entries };
}

/** A parent whose total is the exact sum of its children; undefined when it has none. */
function aggregate(id: string, label: string, children: ContextCategory[], sortChildren = true): ContextCategory | undefined {
  if (children.length === 0) return undefined;
  return {
    id,
    label,
    tokens: children.reduce((sum, child) => sum + child.tokens, 0),
    children: sortChildren ? [...children].sort((a, b) => b.tokens - a.tokens) : children,
  };
}

function withoutEmpty(categories: Array<ContextCategory | undefined>): ContextCategory[] {
  return categories.filter((category): category is ContextCategory => category !== undefined && category.tokens > 0);
}

/** Cut every preview text to the cap; the counts stay those of the whole text. */
function capEntries(category: ContextCategory): ContextCategory {
  return {
    ...category,
    ...(category.children ? { children: category.children.map(capEntries) } : {}),
    ...(category.entries ? { entries: category.entries.map((entry) => entry.text.length > CONTEXT_PREVIEW_MAX_CHARS
      ? { ...entry, text: entry.text.slice(0, CONTEXT_PREVIEW_MAX_CHARS), truncatedChars: entry.text.length - CONTEXT_PREVIEW_MAX_CHARS }
      : entry) } : {}),
  };
}
