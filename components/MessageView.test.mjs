import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import ts from "typescript";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const {
  CompactionSummaryDetails,
  MessageView,
  PatchDiffFiles,
  ThinkingBlock,
  formatToolDuration,
  getModelDisplayName,
  getTokenEstimateText,
  getToolCallInputText,
  replaceUserMessageText,
} = await jiti.import("./MessageView.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { splitFinalAssistantBlocks } = await jiti.import("@/lib/message-display");
const { clearExpandedToolCalls, setToolCallExpanded } = await jiti.import("@/lib/tool-call-expansion");
const { parseUnifiedPatch } = await jiti.import("@/lib/patch");

function renderMessage(message, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MessageView, { message, ...props }),
    ),
  );
}

test("updates a reused message when its written files change", () => {
  const props = { message: { role: "assistant", content: [] } };
  assert.equal(MessageView.compare(props, props), true);
  assert.equal(MessageView.compare(props, { ...props, writtenFiles: [{ path: "/tmp/result.txt" }] }), false);
});

test("matches response model aliases and otherwise includes the provider", () => {
  const names = {
    "gateway:claude-sonnet-5": "Sonnet 5",
    "custom-api:GLM-5.3": "GLM 5.3",
  };

  assert.equal(getModelDisplayName("gateway", "anthropic/claude-sonnet-5", names), "Sonnet 5");
  assert.equal(getModelDisplayName("CUSTOM-API", "glm-5.3", names), "GLM 5.3");
  assert.equal(getModelDisplayName("gateway", "unknown-model", names), "gateway/unknown-model");
});

test("previews the first thinking line and reveals the full text with the saved default", () => {
  const previousWindow = globalThis.window;
  try {
    for (const expanded of [false, true]) {
      globalThis.window = { localStorage: { getItem: () => String(expanded) } };
      const html = renderToStaticMarkup(React.createElement(
        I18nProvider,
        null,
        React.createElement(ThinkingBlock, {
          block: { type: "thinking", thinking: "**Independent reasoning**\n\nDetailed second line." },
          blockIndex: 2,
          duration: 3,
        }),
      ));
      assert.match(html, new RegExp(`aria-expanded="${expanded}"`));
      assert.equal((html.match(/>[^<]*Independent reasoning[^<]*</g) ?? []).length, 1);
      assert.equal(html.includes("Detailed second line."), expanded);
      assert.match(html, /aria-label="Thinking: /);
      assert.match(html, /3s/);
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("renders long expanded thinking in pieces and short thinking as one text node (#1196)", () => {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => "true" } };
  const contentOf = (thinking) => {
    const html = renderToStaticMarkup(React.createElement(
      I18nProvider,
      null,
      React.createElement(ThinkingBlock, { block: { type: "thinking", thinking }, blockIndex: 0 }),
    ));
    return html.match(/overflow-wrap:anywhere">([\s\S]*)<\/div><\/div>$/)[1];
  };
  const piecesOf = (thinking) => {
    const content = contentOf(thinking);
    const pieces = [...content.matchAll(/<div>([^<]*)<\/div>/g)].map((match) => match[1]);
    assert.equal(pieces.map((piece) => `<div>${piece}</div>`).join(""), content);
    assert.ok(pieces.length > 1);
    return pieces;
  };
  try {
    assert.equal(contentOf("First <b>line</b>\n\nSecond line."), "First &lt;b&gt;line&lt;/b&gt;\n\nSecond line.");

    // The block boundary stands in for the line break at a cut; a line with
    // no break is cut with nothing left out.
    const thinking = "Wait, let me check settings.json again.\n".repeat(2_000);
    assert.equal(piecesOf(thinking).join("\n"), thinking);
    const oneLine = "Wait, let me check settings.json again. ".repeat(2_000);
    assert.equal(piecesOf(oneLine).join(""), oneLine);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("shows deferred thinking previews without loading the full content", () => {
  const html = renderMessage({
    role: "assistant",
    content: [{ type: "thinking", thinking: "Historical first line", deferred: true }],
  });
  assert.match(html, />Historical first line<\/span>/);
  assert.match(html, /aria-expanded="false"/);
});

test("keys an assistant message's blocks by their place, not the entry id (#1184)", () => {
  // A message of the running turn gets its entry id when the file is read again.
  // A block keyed by it remounted then: open thinking closed, a tool output's
  // scroll went back to the top. ThinkingBlock drops what it loaded for another id.
  const source = ts.createSourceFile("MessageView.tsx", readFileSync(new URL("./MessageView.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const keys = [];
  (function visit(node) {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === "BlockView") {
      const key = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "key");
      keys.push(key?.initializer?.expression?.getText(source));
    }
    ts.forEachChild(node, visit);
  })(source);
  assert.deepEqual(keys, ["originalIndex"]);
});

test("marks only the matched text block after splitting thinking and the final answer", () => {
  const message = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "" },
      { type: "thinking", thinking: "Thinking about the result" },
      { type: "text", text: "Process text" },
      { type: "toolCall", toolCallId: "read-1", toolName: "read", input: {} },
      { type: "text", text: "First answer" },
      { type: "text", text: "Matched pi-cwd-spark answer" },
    ],
  };
  const { processBlocks, answerBlocks } = splitFinalAssistantBlocks(message);
  for (const index of [2, 4, 5]) {
    const searchBlock = message.content[index];
    for (const content of [processBlocks, answerBlocks]) {
      const html = renderMessage({ ...message, content }, { searchBlock });
      assert.equal((html.match(/data-search-target="true"/g) ?? []).length, content.includes(searchBlock) ? 1 : 0);
      if (content.includes(searchBlock)) {
        assert.match(html, new RegExp(`data-search-target="true">(?:(?!data-message-text)[\\s\\S])*${searchBlock.text}`));
      }
    }
  }
});

test("keeps streamed tool input out of collapsed markup while counting it", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-write-1",
    toolName: "write",
    input: {},
    rawInput: '{"path":"/tmp/file","content":"secret-stream-fragment',
  };
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, { isStreaming: true });

  assert.match(html, /write/);
  assert.match(html, /Generating parameters/);
  assert.doesNotMatch(html, /secret-stream-fragment/);
  assert.equal(getToolCallInputText(block), block.rawInput);
  assert.equal(getTokenEstimateText(block), block.rawInput);
});

test("renders write tool content as readable file text", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-write-file",
    toolName: "write",
    input: { path: "src/example.ts", content: "first line\nsecond line\n" },
  };
  clearExpandedToolCalls();
  setToolCallExpanded(block.toolCallId, true);
  try {
    const html = renderMessage({
      role: "assistant",
      provider: "anthropic",
      model: "claude-test",
      content: [block],
    });

    assert.ok(html.includes("src/example.ts"));
    assert.match(html, /first line\nsecond line\n/);
    assert.ok(!html.includes("<table"));
    assert.doesNotMatch(textOf(html), /"content":/);
  } finally {
    clearExpandedToolCalls();
  }
});

test("a write with another argument or an empty file shows every argument as a row", () => {
  const cases = [
    { id: "call-write-mode", input: { path: "notes.md", content: "text", mode: "append" }, expect: "append" },
    { id: "call-write-empty", input: { path: "empty.txt", content: "" }, expect: "(empty)" },
  ];
  for (const { id, input, expect } of cases) {
    const block = { type: "toolCall", toolCallId: id, toolName: "write", input };
    clearExpandedToolCalls();
    setToolCallExpanded(id, true);
    try {
      const html = renderMessage({ role: "assistant", provider: "anthropic", model: "claude-test", content: [block] });
      assert.ok(textOf(html).includes(expect), id);
      assert.doesNotMatch(textOf(html), /"path":/, id);
    } finally {
      clearExpandedToolCalls();
    }
  }
});

test("input that is still streaming keeps its raw text", () => {
  const rawInput = "{\"path\":\"a.ts\",\"content\":\"one\\ntwo";
  const block = { type: "toolCall", toolCallId: "call-write-streaming", toolName: "write", input: {}, rawInput };
  clearExpandedToolCalls();
  setToolCallExpanded(block.toolCallId, true);
  try {
    const html = renderMessage({ role: "assistant", provider: "anthropic", model: "claude-test", content: [block] });
    assert.equal(textOf(html).includes(getToolCallInputText(block)), true);
    assert.ok(!html.includes("<table"));
  } finally {
    clearExpandedToolCalls();
  }
});

test("a nested argument keeps the JSON body: a row cannot hold a subtree", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-mcp-nested",
    toolName: "mcp__issues__search",
    input: { query: "open bugs", filter: { labels: ["bug"], assignee: "me" }, limit: 10 },
  };
  clearExpandedToolCalls();
  setToolCallExpanded(block.toolCallId, true);
  try {
    const html = renderMessage({ role: "assistant", provider: "anthropic", model: "claude-test", content: [block] });
    assert.ok(!html.includes("<table"));
    assert.ok(textOf(html).includes('"filter"'));
    assert.ok(textOf(html).includes('"labels"'));
  } finally {
    clearExpandedToolCalls();
  }
});

test("an edit call shows no table: its arguments are a list of patches", () => {
  const input = {
    path: "src/app/page.tsx",
    edits: [{ oldText: "const a = 1", newText: "const a = 2" }],
  };
  const block = { type: "toolCall", toolCallId: "call-edit-nested", toolName: "edit", input };
  clearExpandedToolCalls();
  setToolCallExpanded(block.toolCallId, true);
  try {
    const html = renderMessage({ role: "assistant", provider: "anthropic", model: "claude-test", content: [block] });
    assert.ok(!html.includes("<table"));
  } finally {
    clearExpandedToolCalls();
  }
});

test("a read, a subagent and a flat MCP call show one row per argument", (t) => {
  const cases = [
    { id: "call-read-rows", toolName: "read", input: { path: "lib/tool-fields.ts", offset: 120, limit: 80 }, expect: [">path</td>", "lib/tool-fields.ts", ">120</td>"] },
    { id: "call-agent-rows", toolName: "Agent", input: { subagent_type: "Explore", prompt: "Find the parser" }, expect: [">subagent_type</td>", "Find the parser"] },
    { id: "call-mcp-flat-rows", toolName: "mcp__issues__search", input: { query: "open bugs", limit: 10 }, expect: [">query</td>", "open bugs", ">10</td>"] },
  ];
  for (const { id, toolName, input, expect } of cases) {
    const block = { type: "toolCall", toolCallId: id, toolName, input };
    setToolCallExpanded(id, true);
    t.after(() => setToolCallExpanded(id, false));
    const html = renderMessage({ role: "assistant", provider: "anthropic", model: "claude-test", content: [block] });
    assert.ok(html.includes("<table"), id);
    for (const needle of expect) assert.ok(html.includes(needle), `${id}: ${needle}`);
  }
});

test("a long or multi-line value stays inside the card", (t) => {
  const content = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");
  const block = {
    type: "toolCall",
    toolCallId: "call-agent-long",
    toolName: "Agent",
    input: { subagent_type: "a".repeat(200), prompt: content },
  };
  setToolCallExpanded(block.toolCallId, true);
  t.after(() => setToolCallExpanded(block.toolCallId, false));
  const html = renderMessage({ role: "assistant", provider: "anthropic", model: "claude-test", content: [block] });
  // A single-line value wraps in its cell; a value with lines of its own scrolls in a block.
  assert.ok(html.includes("<table"));
  assert.match(html, /overflow-wrap:anywhere/);
  assert.match(html, /calc\(12px \+ var\(--chat-font-size-offset, 0px\)\)/);
  assert.match(html, /max-height:260px/);
  assert.match(html, /overflow:auto/);
  assert.ok(textOf(html).includes("line 39"));
});

test("renders subagents as standard tool calls with only an extra side-panel button", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-agent-1",
    toolName: "Agent",
    input: {
      subagent_type: "Explore",
      prompt: "Find the parser",
      description: "Find parser",
    },
  };
  const result = {
    role: "toolResult",
    toolCallId: block.toolCallId,
    content: [{ type: "text", text: "Parser is in lib/parser.ts" }],
    details: {
      kind: "pi-web-subagent",
      sessionId: "child-session",
      profile: "Explore",
      description: "Find parser",
      status: "completed",
      runInBackground: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  };
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, {
    toolResults: new Map([[block.toolCallId, result]]),
    onOpenSubagent() {},
  });

  assert.match(html, /border:1px solid rgba\(34,197,94,0\.25\)/);
  assert.match(html, />Agent</);
  assert.match(html, />Explore</);
  assert.match(html, /aria-label="View sub-agent work in side panel"/);
  assert.doesNotMatch(html, />completed</);
  assert.doesNotMatch(html, />Find parser</);

  const ordinaryHtml = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [{ ...block, toolCallId: "call-extension-1", toolName: "extension_tool" }],
  }, {
    toolResults: new Map(),
    onOpenSubagent() {},
  });
  assert.doesNotMatch(ordinaryHtml, /View sub-agent work in side panel/);
});

test("a tool card shows the run time pi recorded, else the timestamps' difference, never a tiny one", () => {
  const block = { type: "toolCall", toolCallId: "call-duration-1", toolName: "bash", arguments: { command: "make" } };
  const message = { role: "assistant", provider: "anthropic", model: "claude-test", content: [block], timestamp: 1_000_000, durationMs: 4_000 };
  const header = (result) => renderMessage(message, { toolResults: new Map([[block.toolCallId, result]]) });
  const result = { role: "toolResult", toolCallId: block.toolCallId, toolName: "bash", content: [], isError: false };
  // pi 1.1 records the execution itself; the timestamps would count the model's 4 s of generation too.
  assert.match(header({ ...result, timestamp: 1_006_400, durationMs: 2_400 }), />2\.4s</);
  // A result saved before pi recorded durations falls back to the timestamps.
  assert.match(header({ ...result, timestamp: 1_006_400 }), />6\.4s</);
  assert.doesNotMatch(header({ ...result, timestamp: 1_006_400, durationMs: 40 }), />\d+\.\ds</);

  assert.equal(formatToolDuration(400), "0.4s");
  assert.equal(formatToolDuration(59_940), "59.9s");
  assert.equal(formatToolDuration(185_000), "3m 5s");
  assert.equal(formatToolDuration(3_725_000), "1h 2m 5s");
});

const COMPLETE_SKILL_EXPANSION = `<skill name="review" location="/skills/review/SKILL.md">
References are relative to /skills/review.

Review the supplied files.
</skill>

src/main.ts`;

test("renders a provider error when the assistant message has no content", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [],
    stopReason: "error",
    errorMessage: "OpenAI API error (403): <html>request forbidden</html>",
  });

  assert.match(html, /role="alert"/);
  assert.match(html, /Error: OpenAI API error \(403\)/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
});

test("renders a truncation notice for stopReason length", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [{ type: "thinking", thinking: "Long reasoning chain" }],
    stopReason: "length",
  });

  assert.match(html, /role="alert"/);
  assert.match(html, /output limit was reached before an answer/i);
  assert.doesNotMatch(html, /follow-up/i);
});

test("keeps the follow-up hint when a truncated response already has text", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [{ type: "text", text: "Partial answer" }],
    stopReason: "length",
  });

  assert.match(html, /Partial answer/);
  assert.match(html, /follow-up/i);
  assert.doesNotMatch(html, /Compact context/);
});

test("offers compaction on an unanswered truncation and keeps its error with the reply", () => {
  let compacted = 0;
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [],
    stopReason: "length",
  }, {
    onCompact: () => { compacted += 1; },
    compactError: "Summarization failed: generation hit the token cap",
  });

  assert.match(html, /Compact context/);
  assert.match(html, /generation hit the token cap/);
  assert.equal(compacted, 0);
});

test("renders partial assistant content before the provider error", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Partial response" }],
    stopReason: "error",
    errorMessage: "Connection closed",
  });

  assert.match(html, /Partial response/);
  assert.match(html, /Error: Connection closed/);
});

test("marks persisted assistant messages with their source entry", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Select this response" }],
  }, { entryId: "assistant-entry" });

  assert.match(html, /data-message-role="assistant"/);
  assert.match(html, /data-entry-id="assistant-entry"/);
});

test("renders a complete SDK skill expansion as a compact command", () => {
  const html = renderMessage({
    role: "user",
    content: COMPLETE_SKILL_EXPANSION,
  });

  assert.match(html, /\/skill:review/);
  assert.match(html, /src\/main\.ts/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Review the supplied files/);
});

test("does not collapse incomplete skill-looking user text", () => {
  const html = renderMessage({
    role: "user",
    content: '<skill name="review" location="/skills/review/SKILL.md">\nordinary user text',
  });

  assert.match(html, /ordinary user text/);
  assert.doesNotMatch(html, /aria-expanded/);
});

test("shows every line of pasted plain text in a user message (#680)", () => {
  const lines = [
    "第1题（看门狗）",
    "嵌入式系统中，看门狗（WatchDog）的基本工作原理是（ ）",
    "A. 监控系统温度，过热时自动降频",
    "B. 计数器自动计数，程序定期将其重置；若程序跑飞计数器溢出，则系统复位重启",
  ];
  const expected = `<p>${lines.join("<br/>")}</p>`;

  for (const lineEnding of ["\n", "\r\n", "\r"]) {
    const html = renderMessage({ role: "user", content: lines.join(lineEnding) });
    assert.ok(html.includes(expected), JSON.stringify(lineEnding));
    assert.doesNotMatch(html, /\r/);
  }

  const listHtml = renderMessage({
    role: "user",
    content: [{ type: "text", text: "1. 看门狗的原理是（ ）\nA. 监控温度\nB. 计数器" }],
  });
  assert.match(listHtml, /<li>看门狗的原理是（ ）<br\/>A\. 监控温度<br\/>B\. 计数器<\/li>/);
});

test("keeps assistant soft line breaks as Markdown paragraphs", () => {
  const html = renderMessage({ role: "assistant", content: [{ type: "text", text: "one\ntwo" }] });

  assert.match(html, /<p>one\ntwo<\/p>/);
  assert.doesNotMatch(html, /<br/);
});

test("renders lone carriage returns in compact command arguments as line breaks", () => {
  const html = renderMessage({
    role: "user",
    content: COMPLETE_SKILL_EXPANSION.replace("src/main.ts", "src/main.ts\rsrc/app.ts"),
  });

  assert.match(html, /\/skill:review/);
  assert.match(html, /src\/main\.ts\nsrc\/app\.ts/);
  assert.doesNotMatch(html, /\r/);
});

test("keeps attached images when restoring a compact command for editing", () => {
  const image = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "QUJDRA==" },
  };
  const restored = replaceUserMessageText({
    role: "user",
    content: [{ type: "text", text: COMPLETE_SKILL_EXPANSION }, image],
  }, "/skill:review src/main.ts");

  assert.deepEqual(restored.content, [
    { type: "text", text: "/skill:review src/main.ts" },
    image,
  ]);
});

test("renders user-message images as buttons that open a larger preview", () => {
  const html = renderMessage({
    role: "user",
    content: [
      { type: "text", text: "inspect this" },
      { type: "image", data: "YWJj", mimeType: "image/png" },
    ],
    timestamp: Date.now(),
  });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
});

test("marks apply_patch returned failures as errors even when isError is unset", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-patch-1",
    toolName: "apply_patch",
    input: {
      input: "*** Begin Patch\n*** Update File: src/a.ts\n-old\n+new\n*** End Patch",
    },
  };
  const failed = {
    role: "toolResult",
    toolCallId: block.toolCallId,
    content: [{ type: "text", text: "apply_patch failed.\nRecovery: MUST read src/a.ts before retrying." }],
    details: {
      result: { appliedFiles: [], failures: [{ filePath: "src/a.ts", message: "context mismatch" }] },
    },
  };
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [block],
  }, { toolResults: new Map([[block.toolCallId, failed]]) });

  assert.match(html, /border:1px solid rgba\(248,113,113,0\.45\)/);
  assert.match(html, />apply_patch</);
  assert.doesNotMatch(html, /border:1px solid rgba\(34,197,94,0\.25\)/);
});

test("collapses a displayed custom message from its header alone", () => {
  const custom = (props) => renderMessage({
    role: "custom",
    customType: "extension",
    display: true,
    timestamp: Date.now(),
    ...props,
  });
  // The header is the card's first button and the only one holding the title.
  const header = (html) => html.slice(0, html.indexOf("</button>"));

  // The header is the toggle, so a message with no `details` can collapse too.
  const shown = custom({ content: [{ type: "text", text: "a message with no details" }] });
  assert.match(header(shown), /aria-expanded="true"/);
  assert.match(header(shown), />extension</);
  // The footer is for details only; it is not a second way to collapse.
  assert.doesNotMatch(shown, /Show details|Hide details/);

  // It starts expanded, as pi's TUI draws a displayed custom message in full.
  assert.match(shown, /a message with no details/);
  // A message with no text (images only) can collapse too.
  assert.match(header(custom({ content: [] })), /aria-expanded="true"/);

  // A message that does carry details keeps that button, for its details.
  assert.match(
    custom({ content: [{ type: "text", text: "a message with details" }], details: { files: ["a.ts"] } }),
    /Show details/,
  );
});

test("renders custom-message images as buttons that open a larger preview", () => {
  const html = renderMessage({
    role: "custom",
    customType: "extension",
    content: [{ type: "image", data: "YWJj", mimeType: "image/png" }],
    timestamp: Date.now(),
  });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
});

test("shows tool-result images while the tool details stay collapsed", () => {
  const block = {
    type: "toolCall",
    toolCallId: "call-shot-1",
    toolName: "page_screenshot",
    input: { tabId: 7 },
  };
  const result = {
    role: "toolResult",
    toolCallId: block.toolCallId,
    content: [
      { type: "text", text: "captured-1280x720" },
      { type: "image", data: "YWJj", mimeType: "image/png" },
    ],
  };
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, { toolResults: new Map([[block.toolCallId, result]]) });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
  assert.doesNotMatch(html, /captured-1280x720/);
  assert.doesNotMatch(html, /"tabId"/);
});

test("uses the unanswered truncation notice for an empty length reply", () => {
  // A nearly full context can clamp the output so far that nothing, not even
  // thinking, comes back; the notice must not blame thinking alone.
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [],
    stopReason: "length",
  });

  assert.match(html, /output limit was reached before an answer/i);
  assert.match(html, /nearly full context/i);
  assert.doesNotMatch(html, /follow-up/i);
});

function textOf(html) {
  return html.replace(/<[^>]+>/g, "").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
}

function codemodeCall(toolCallId, code) {
  return { type: "toolCall", toolCallId, toolName: "codemode", input: { code } };
}

function renderCodemode(block, result) {
  return renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, { toolResults: new Map(result ? [[block.toolCallId, result]] : []) });
}

const CODEMODE_SCRIPT = "// @options: {\"timeoutMs\": 5000}\nconst files = await tools.ls({ path: \".\" });\nreturn files.length;";

test("collapses a codemode call to its first script line and call count", (t) => {
  const block = codemodeCall("call-codemode-collapsed", CODEMODE_SCRIPT);
  t.after(() => setToolCallExpanded(block.toolCallId, false));
  const html = renderCodemode(block, {
    role: "toolResult",
    toolCallId: block.toolCallId,
    content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }, { type: "text", text: "3" }],
    details: {
      calls: [
        { id: "call-codemode-collapsed/1", name: "ls", args: "{\"path\":\".\"}", status: "ok", durationMs: 4 },
        { id: "call-codemode-collapsed/2", name: "read", args: "{\"path\":\"a\"}", status: "ok", durationMs: 2 },
      ],
    },
  });
  const text = textOf(html);
  assert.match(text, /codemode/);
  assert.match(text, /const files = await tools\.ls\(\{ path: "\." \}\);/);
  assert.match(text, /2 calls/);
  assert.doesNotMatch(text, /@options/);
  assert.doesNotMatch(text, /"code"/);
  assert.doesNotMatch(text, /Tool calls/);
});

test("expands a codemode call into its script, its calls, and the output without the header", (t) => {
  const block = codemodeCall("call-codemode-expanded", CODEMODE_SCRIPT);
  setToolCallExpanded(block.toolCallId, true);
  t.after(() => setToolCallExpanded(block.toolCallId, false));
  const calls = Array.from({ length: 23 }, (_, index) => ({
    id: `call-codemode-expanded/${index + 1}`,
    name: index === 22 ? "bash" : "read",
    args: `{"path":"file-${index + 1}"}`,
    status: index === 22 ? "error" : "ok",
    durationMs: 1500,
    ...(index === 22 ? { error: "exit code 2" } : {}),
  }));
  calls.push(
    { id: "call-codemode-expanded/24", name: "models.classify", args: "", status: "ok", cost: 0.004 },
    { id: "call-codemode-expanded/25", name: "models.classify", args: "", status: "ok", cost: 0.006 },
  );
  const html = renderCodemode(block, {
    role: "toolResult",
    toolCallId: block.toolCallId,
    isError: true,
    content: [
      { type: "text", text: "Script failed\nWall time 4.2 seconds\nOutput:\n" },
      { type: "text", text: "Script error:\nError: exit code 2" },
    ],
    details: { calls },
  });
  const text = textOf(html);

  // The script sits in the plain box any tool's input uses, not a highlighted code block.
  assert.doesNotMatch(html, /markdown-code-block/);
  assert.equal(textOf(html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)[1]), CODEMODE_SCRIPT);
  assert.match(text, /Tool calls/);
  assert.match(text, /Show 5 earlier calls/);
  // The newest 20 of 25 calls are listed; the 5 oldest are folded.
  assert.doesNotMatch(text, /"file-5"/);
  assert.match(text, /"file-6"/);
  assert.match(text, /bash\{"path":"file-23"\}1\.5s/);
  assert.match(text, /exit code 2/);
  assert.match(html, /aria-label="Failed"/);
  assert.match(text, /Model calls: \$0\.01/);
  assert.match(text, /Script error:\nError: exit code 2/);
  assert.doesNotMatch(text, /Wall time/);
  assert.doesNotMatch(text, /"code":/);
});

test("shows a running script's calls without an empty output", (t) => {
  const block = codemodeCall("call-codemode-running", "await tools.read({ path: \"a\" })");
  setToolCallExpanded(block.toolCallId, true);
  t.after(() => setToolCallExpanded(block.toolCallId, false));
  const html = renderCodemode(block, {
    role: "toolResult",
    toolCallId: block.toolCallId,
    content: [],
    details: {
      calls: [{ id: "call-codemode-running/201", name: "read", args: "{\"path\":\"a\"}", status: "running" }],
      omittedCalls: 200,
    },
  });
  const text = textOf(html);
  assert.match(text, /201 calls/);
  assert.match(text, /200 earlier calls not shown/);
  assert.match(html, /aria-label="Running"/);
  assert.doesNotMatch(text, /No output/i);
});

test("a codemode call with no script or streaming input falls back to a plain body", (t) => {
  const streaming = { ...codemodeCall("call-codemode-streaming", ""), input: {}, rawInput: "{\"code\":\"const secret" };
  setToolCallExpanded(streaming.toolCallId, true);
  t.after(() => setToolCallExpanded(streaming.toolCallId, false));
  const streamingText = textOf(renderCodemode(streaming));
  assert.match(streamingText, /Generating parameters/);
  assert.match(streamingText, /\{"code":"const secret/);
  assert.doesNotMatch(streamingText, /Tool calls/);

  const other = { type: "toolCall", toolCallId: "call-codemode-other", toolName: "codemode", input: { script: "x" } };
  setToolCallExpanded(other.toolCallId, true);
  t.after(() => setToolCallExpanded(other.toolCallId, false));
  // An argument this view does not understand is still an argument: no script box,
  // but the flat row shows it.
  const otherHtml = renderCodemode(other);
  assert.match(otherHtml, /<table/);
  assert.match(otherHtml, />x<\/td>/);
  assert.doesNotMatch(textOf(otherHtml), /"script": "x"/);
});

test("labels an MCP call server/tool and indents a JSON result", (t) => {
  const block = {
    type: "toolCall",
    toolCallId: "call-mcp-1",
    toolName: "mcp__docs_v2__search",
    input: { query: "codemode" },
  };
  setToolCallExpanded(block.toolCallId, true);
  t.after(() => setToolCallExpanded(block.toolCallId, false));
  const html = renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, {
    toolResults: new Map([[block.toolCallId, {
      role: "toolResult",
      toolCallId: block.toolCallId,
      content: [{ type: "text", text: "{\"hits\":[{\"title\":\"Code mode\"}]}" }],
      details: { server: "docs.v2", tool: "search" },
    }]]),
  });
  const text = textOf(html);
  assert.match(text, /docs\.v2\/search/);
  assert.match(html, /title="mcp__docs_v2__search"/);
  assert.match(text, /\{\n {2}"hits": \[\n {4}\{\n {6}"title": "Code mode"/);
});

test("keeps the registered name where no result names the server and tool", (t) => {
  // Sanitizing maps docs.v2/search.pages and docs_v2/search_pages to one name, so it is not split.
  const block = { type: "toolCall", toolCallId: "call-mcp-running", toolName: "mcp__docs_v2__search_pages", input: {} };
  const running = textOf(renderMessage({
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  }, { toolResults: new Map() }));
  assert.match(running, /mcp__docs_v2__search_pages/);
  assert.doesNotMatch(running, /docs_v2\//);

  // A codemode script's calls carry only that name, which is also what the script calls.
  const script = codemodeCall("call-codemode-mcp", "await tools.mcp__docs_v2__search_pages({})");
  setToolCallExpanded(script.toolCallId, true);
  t.after(() => setToolCallExpanded(script.toolCallId, false));
  const html = renderCodemode(script, {
    role: "toolResult",
    toolCallId: script.toolCallId,
    content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }],
    details: { calls: [{ id: "call-codemode-mcp/1", name: "mcp__docs_v2__search_pages", args: "{}", status: "ok" }] },
  });
  assert.match(textOf(html), /mcp__docs_v2__search_pages\{\}/);
});

test("collapses the compaction summary to its title and token count, as pi's TUI does (#1026)", () => {
  const summary = "## Goal\n\nShip the parser fix.\n\n<read-files>\nlib/read.ts\n</read-files>\n\n<modified-files>\nlib/changed.ts\n</modified-files>";
  const message = {
    role: "custom",
    customType: "compaction",
    content: summary,
    display: true,
    details: { tokensBefore: 123456, firstKeptEntryId: "kept0001" },
  };
  const html = renderMessage(message);

  assert.match(html, /<button type="button" aria-expanded="false" title="Expand"/);
  assert.match(html, /Conversation compacted/);
  assert.ok(html.includes(`Compacted from ${(123456).toLocaleString()} tokens`));
  assert.doesNotMatch(html, /Ship the parser fix|following summary|File context|lib\/read\.ts|lib\/changed\.ts/);
  assert.doesNotMatch(renderMessage({ ...message, details: undefined }), /Compacted from/);

  // What the toggle reveals.
  const details = renderToStaticMarkup(React.createElement(
    I18nProvider,
    null,
    React.createElement(CompactionSummaryDetails, { summary }),
  ));
  assert.match(details, /following summary/);
  assert.match(details, /Ship the parser fix/);
  assert.match(details, /File context: 1 read, 1 modified/);
  assert.match(details, /lib\/read\.ts/);
  assert.match(details, /lib\/changed\.ts/);
});

// ── A tool card's patch: two columns where there is room, one where there is not ──

const EDIT_PATCH = `--- a/src/demo.ts
+++ b/src/demo.ts
@@ -10,3 +10,3 @@
 const keep = true;
-const value = "old";
+const value = "new";
done();
`;

const TWO_COLUMN_GRID = "grid-template-columns:minmax(0, 1fr) minmax(0, 1fr)";

function renderPatchFiles(files, layout) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(PatchDiffFiles, { files, layout })),
  );
}

function countIn(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test("an edit card draws the applied patch in two columns while there is room", () => {
  const block = { type: "toolCall", toolCallId: "call-edit-columns", toolName: "edit", input: { path: "src/demo.ts" } };
  const result = {
    role: "toolResult",
    toolCallId: block.toolCallId,
    toolName: "edit",
    content: [{ type: "text", text: "ok" }],
    details: { patch: EDIT_PATCH },
  };
  setToolCallExpanded(block.toolCallId, true);
  try {
    const html = renderMessage(
      { role: "assistant", provider: "anthropic", model: "claude-test", content: [block] },
      { toolResults: new Map([[block.toolCallId, result]]) },
    );
    assert.ok(html.includes(TWO_COLUMN_GRID), "the card reaches the patch view");
    assert.ok(html.includes("const value = &quot;new&quot;;"));
  } finally {
    clearExpandedToolCalls();
  }
});

test("the same patch in one column: no line twice, the removed line above what replaces it", () => {
  const stacked = renderPatchFiles(parseUnifiedPatch(EDIT_PATCH), "stacked");

  assert.ok(!stacked.includes("grid-template-columns"), "nothing stands beside anything");
  assert.equal(countIn(stacked, "const keep = true;"), 1);
  assert.equal(countIn(stacked, "const value = &quot;old&quot;;"), 1);
  assert.equal(countIn(stacked, "const value = &quot;new&quot;;"), 1);
  assert.ok(stacked.indexOf("&quot;old&quot;;") < stacked.indexOf("&quot;new&quot;;"));

  // The two columns pay for themselves by printing every context line twice.
  const split = renderPatchFiles(parseUnifiedPatch(EDIT_PATCH), "split");
  assert.ok(split.includes(TWO_COLUMN_GRID));
  assert.equal(countIn(split, "const keep = true;"), 2);
});

test("one column names a file section by the file's own path, not by Before and After", () => {
  const files = parseUnifiedPatch(`--- a/one.ts
+++ b/one.ts
@@ -1 +1 @@
-a
+b
--- a/two.ts
+++ b/two.ts
@@ -1 +1 @@
-c
+d
`);
  const html = renderPatchFiles(files, "stacked");

  assert.ok(html.includes("b/one.ts"), "the first file names its section");
  assert.ok(html.includes("b/two.ts"), "the second file names its section");
  assert.ok(!html.includes(">Before<") && !html.includes(">After<"), "two labels over one column read as two columns");
});

test("the layout is the viewport's choice, taken once for both the patch input and the patch result", () => {
  const source = readFileSync(new URL("./MessageView.tsx", import.meta.url), "utf8");

  // Both the applied-patch card and a result's patch render through SplitFilesView,
  // so a phone never gets one of each.
  assert.match(source, /const layout: PatchDiffLayout = useIsMobile\(\) \? "stacked" : "split";/);
  assert.equal(countIn(source, "<SplitFilesView"), 2);
});

test("one column numbers a removed line by the old file and every other line by the new one", () => {
  const stacked = renderPatchFiles(parseUnifiedPatch(`--- a/src/demo.ts
+++ b/src/demo.ts
@@ -10,3 +10,4 @@
 const keep = true;
-const value = "old";
+const value = "new";
+const extra = 1;
 done();
@@ -30,1 +31,1 @@
-late
+LATE
`), "stacked");

  const gutter = [...stacked.matchAll(/width:42px[^>]*>(\d*)</g)].map((match) => match[1]);
  // done() is old line 12 but new line 13: the new file's number, as in the file viewer's gutter.
  assert.deepEqual(gutter, ["10", "11", "11", "12", "13", "30", "31"]);
  // The lines between the hunks stay marked, as in the two-column view.
  assert.equal(countIn(stacked, "⋯ 17 unchanged lines"), 1);
});

test("one column names a deleted file's section by its old path", () => {
  const html = renderPatchFiles(parseUnifiedPatch(`--- a/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-bye
--- a/kept.ts
+++ b/kept.ts
@@ -1 +1 @@
-a
+b
`), "stacked");

  assert.ok(html.includes(">a/gone.ts<"));
  assert.ok(!html.includes("/dev/null"));
});
