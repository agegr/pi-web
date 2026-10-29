import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { computeContextUsage, findPromptSections, CONTEXT_PREVIEW_MAX_CHARS } = await jiti.import("./context-usage.ts");
const { collectPreviewEntries } = await jiti.import("./context-usage-types.ts");

const PROMPT = [
  "You are an expert coding assistant.",
  "<tools>\n- read: Read files\n</tools>",
  "<rules>\n- Be concise\n</rules>",
  "<project_context>\nProject-specific instructions and guidelines:\n\n<project_instructions path=\"/repo/AGENTS.md\">\nUse tabs.\n</project_instructions>\n</project_context>",
  "<skills>\nThe following skills…\n<available_skills>\n  <skill>\n    <name>pdf</name>\n    <description>Read &amp; write PDFs</description>\n    <location>/s/pdf/SKILL.md</location>\n  </skill>\n</available_skills>\n</skills>",
  "<cwd>\n/repo\n</cwd>",
  "Extra text an extension appended.",
].join("\n\n");

const model = { provider: "anthropic", api: "anthropic-messages", id: "claude-x" };

function assistant(content, overrides = {}) {
  return {
    role: "assistant", content, timestamp: 2, provider: "anthropic", api: "anthropic-messages", model: "claude-x",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    ...overrides,
  };
}

function find(categories, id) {
  for (const category of categories) {
    if (category.id === id) return category;
    const child = category.children && find(category.children, id);
    if (child) return child;
  }
  return undefined;
}

function assertSums(category) {
  if (!category.children) return;
  assert.equal(category.tokens, category.children.reduce((sum, child) => sum + child.tokens, 0), category.id);
  category.children.forEach(assertSums);
}

test("finds pi's top-level sections and skips tags inside fences", () => {
  const names = findPromptSections(`${PROMPT}\n\n\`\`\`\n<docs>\nnot a section\n</docs>\n\`\`\``).map((section) => section.name);
  assert.deepEqual(names, ["tools", "rules", "project_context", "skills", "cwd"]);
});

test("splits the prompt into System Prompt, Instruction Files and Skills that add up to it", () => {
  const usage = computeContextUsage({ systemPrompt: PROMPT, tools: [], messages: [] });
  assert.deepEqual(usage.categories.map((category) => category.id), ["system-prompt", "context-files", "skills"]);
  assert.equal(usage.estimatedTokens, Math.ceil(PROMPT.length / 4));
  usage.categories.forEach(assertSums);

  const files = find(usage.categories, "context-files");
  assert.deepEqual(files.children.map((child) => child.label), ["/repo/AGENTS.md"]);
  assert.equal(files.children[0].entries[0].text, "Use tabs.");
  const skill = find(usage.categories, "skill:pdf");
  assert.match(skill.entries[0].text, /Read & write PDFs/);

  const parts = find(usage.categories, "system-prompt").children.map((child) => child.label);
  assert.deepEqual(parts.slice(0, 5), ["Preamble", "Tools", "Rules", "Current Dir", "Extension Additions"]);
});

test("puts tools in Built-in, Custom and MCP by their source", () => {
  const usage = computeContextUsage({
    systemPrompt: "",
    messages: [],
    tools: [
      { name: "read", description: "Read a file", parameters: { type: "object" }, sourceInfo: { source: "builtin", path: "builtin:read" } },
      { name: "bash", description: "Run", sourceInfo: { source: "inline", path: "<inline:pi-web-project-command-environment>" } },
      { name: "mcp__github__search", description: "Search", sourceInfo: { source: "builtin", path: "builtin:mcp" } },
      { name: "web_search", description: "Search the web", sourceInfo: { source: "npm:pi-web-tools", path: "/x/index.ts" } },
    ],
  });
  assert.deepEqual(usage.categories.map((category) => category.id), ["built-in-tools", "custom-tools", "mcp-tools"]);
  assert.deepEqual(find(usage.categories, "built-in-tools").children.map((child) => child.id).sort(), ["tool:bash", "tool:read"]);
  assert.equal(find(usage.categories, "tool:read").tokens, Math.ceil("read: Read a file\n{\"type\":\"object\"}".length / 4));
});

test("classifies messages, groups tool output per tool, and counts reported reasoning", () => {
  const usage = computeContextUsage({
    systemPrompt: "",
    tools: [],
    model,
    messages: [
      { role: "user", content: "Hello there", timestamp: 1 },
      assistant([
        { type: "thinking", thinking: "abcd", thinkingSignature: "SECRET-SIGNATURE" },
        { type: "text", text: "Answer" },
        { type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } },
      ], { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, reasoning: 50, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }),
      { role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: "file body" }], isError: false, timestamp: 3 },
      assistant([{ type: "thinking", thinking: "other model's" }, { type: "text", text: "x" }], { model: "other", timestamp: 4 }),
    ],
  });
  const ids = usage.categories.map((category) => category.id);
  assert.deepEqual(ids, ["user-messages", "assistant-messages", "assistant-thinking", "tool-calls", "tool-output"]);
  usage.categories.forEach(assertSums);

  const thinking = find(usage.categories, "assistant-thinking");
  assert.equal(thinking.tokens, 50, "reported reasoning replaces the visible estimate");
  assert.equal(thinking.entries.length, 1, "another model's thinking is left out");
  assert.deepEqual(thinking.entries[0].invisibleReasoning, { tokens: 49, basis: "provider-reported", encoded: true });
  assert.ok(find(usage.categories, "tool-result:read"));
  assert.doesNotMatch(JSON.stringify(usage), /SECRET-SIGNATURE/);
});

test("notes a signature-size proxy without counting it", () => {
  const usage = computeContextUsage({
    systemPrompt: "", tools: [], model,
    messages: [assistant([{ type: "thinking", thinking: "abcd", thinkingSignature: "x".repeat(400) }, { type: "text", text: "ok" }])],
  });
  const entry = find(usage.categories, "assistant-thinking").entries[0];
  assert.equal(entry.tokens, 1, "only the visible text counts");
  assert.deepEqual(entry.invisibleReasoning, { tokens: 100, basis: "signature-proxy", encoded: true });
});

test("caps preview text but keeps the whole estimate, and orders previews by time", () => {
  const long = "y".repeat(CONTEXT_PREVIEW_MAX_CHARS + 10);
  const usage = computeContextUsage({
    systemPrompt: "", tools: [],
    messages: [
      { role: "toolResult", toolCallId: "b", toolName: "bash", content: [{ type: "text", text: long }], isError: false, timestamp: 5 },
      { role: "toolResult", toolCallId: "a", toolName: "read", content: [{ type: "text", text: "early" }], isError: false, timestamp: 1 },
    ],
    reported: { tokens: 100, contextWindow: 200_000, percent: 0.05 },
    reserveTokens: 16_384,
  });
  const bash = find(usage.categories, "tool-result:bash");
  assert.equal(bash.entries[0].text.length, CONTEXT_PREVIEW_MAX_CHARS);
  assert.equal(bash.entries[0].truncatedChars, 10);
  assert.ok(bash.tokens >= Math.ceil(long.length / 4));
  assert.deepEqual(collectPreviewEntries(find(usage.categories, "tool-output")).map((entry) => entry.timestamp), [1, 5]);
  assert.equal(usage.reserveTokens, 16_384);
});
