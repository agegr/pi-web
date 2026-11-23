import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { sessionToMarkdown } = await jiti.import("./session-markdown.ts");

const entries = [
  { type: "session", id: "hdr", timestamp: "2026-11-14T00:00:00Z", version: 3 },
  { type: "model_change", id: "m1", parentId: "hdr", timestamp: "t", provider: "deepseek", modelId: "deepseek-v4" },
  { type: "message", id: "u1", parentId: "m1", timestamp: "t", message: { role: "user", content: [{ type: "text", text: "帮我看下 provider 插件" }] } },
  {
    type: "message", id: "a1", parentId: "u1", timestamp: "t",
    message: {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "thinking", thinking: "一段很长的思考，不应该出现在引用里" },
        { type: "text", text: "我来处理" },
        { type: "toolCall", id: "c1", name: "read", arguments: { path: "/p/pi-web/AGENTS.md" } },
      ],
    },
  },
  { type: "message", id: "tr1", parentId: "a1", timestamp: "t", message: { role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "文件内容摘要" }] } },
  { type: "compaction", id: "comp1", parentId: "tr1", timestamp: "t", summary: "前面讨论了 provider 的 sync 方案", firstKeptEntryId: "u1", tokensBefore: 100 },
  { type: "message", id: "u2", parentId: "comp1", timestamp: "t", message: { role: "user", content: [{ type: "text", text: "继续" }, { type: "image", source: { type: "base64", data: "x", media_type: "image/png" } }] } },
  {
    type: "message", id: "a2", parentId: "u2", timestamp: "t",
    message: { role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "又说了一大段" }, { type: "text", text: "改好了" }] },
  },
];

test("sessionToMarkdown quotes user messages and assistant final replies only", () => {
  const result = sessionToMarkdown(entries, "a2", {});
  assert.equal(result.markdown, "User: 帮我看下 provider 插件\n\nUser: 继续\n[image]\n\nAssistant: 改好了");
  assert.equal(result.messageCount, 3);
  assert.equal(result.omittedMessages, 0);
});

test("sessionToMarkdown drops the work log around those messages", () => {
  const { markdown } = sessionToMarkdown(entries, "a2", {});
  assert.doesNotMatch(markdown, /一段很长的思考|又说了一大段/);
  assert.doesNotMatch(markdown, /我来处理/); // an intermediate turn's narration
  assert.doesNotMatch(markdown, /工具调用|工具结果|文件内容摘要/);
  assert.doesNotMatch(markdown, /摘要: 前面讨论了/);
  assert.doesNotMatch(markdown, /模型: deepseek/);
});

test("sessionToMarkdown walks from the leaf, not the file end", () => {
  // A sibling entry after the leaf on disk must not leak into the branch.
  const withSibling = [...entries, { type: "message", id: "other", parentId: "hdr", timestamp: "t", message: { role: "user", content: [{ type: "text", text: "旁支内容" }] } }];
  const result = sessionToMarkdown(withSibling, "a2", {});
  assert.doesNotMatch(result.markdown, /旁支内容/);
});

test("sessionToMarkdown keeps the newest turns and gives up the oldest first", () => {
  const many = [
    { type: "session", id: "hdr", timestamp: "2026-11-14T00:00:00Z", version: 3 },
    ...Array.from({ length: 10 }, (_, index) => ({
      type: "message",
      id: `u${index}`,
      parentId: index === 0 ? "hdr" : `u${index - 1}`,
      timestamp: "t",
      message: { role: "user", content: [{ type: "text", text: `第 ${index} 条` }] },
    })),
  ];
  const result = sessionToMarkdown(many, "u9", { maxMessages: 4 });
  assert.equal(result.messageCount, 10);
  // Ten turns of one message: the newest three are the focus, and only one
  // condensed line fits under the four-message cap.
  assert.equal(result.omittedMessages, 6);
  assert.equal(
    result.markdown,
    "User: 第 6 条\n\n… earlier turns condensed to their first question (6 messages omitted) …\n\nUser: 第 7 条\n\nUser: 第 8 条\n\nUser: 第 9 条",
  );
});

test("sessionToMarkdown elides to fit the char cap too", () => {
  const one = { type: "message", id: "u0", parentId: "hdr", timestamp: "t", message: { role: "user", content: [{ type: "text", text: "x".repeat(200) }] } };
  const result = sessionToMarkdown([
    { type: "session", id: "hdr", timestamp: "2026-11-14T00:00:00Z", version: 3 },
    one,
    { ...one, id: "u1", parentId: "u0" },
    { ...one, id: "u2", parentId: "u1" },
  ], "u2", { maxChars: 300 });
  assert.ok(result.omittedMessages > 0);
  assert.ok(result.markdown.length <= 300);
});

test("sessionToMarkdown never lets one message outgrow the cap", () => {
  const result = sessionToMarkdown([
    { type: "session", id: "hdr", timestamp: "2026-11-14T00:00:00Z", version: 3 },
    { type: "message", id: "u0", parentId: "hdr", timestamp: "t", message: { role: "user", content: [{ type: "text", text: "y".repeat(500) }] } },
  ], "u0", { maxChars: 100 });
  assert.ok(result.markdown.length <= 100);
  assert.match(result.markdown, /…$/);
});

test("sessionToMarkdown drops the oldest turns whole, so no reply loses its question", () => {
  const turnEntries = [
    { type: "session", id: "hdr", timestamp: "2026-11-14T00:00:00Z", version: 3 },
    ...["一", "二", "三"].flatMap((label, index) => [
      {
        type: "message", id: `u${index}`, parentId: index === 0 ? "hdr" : `a${index - 1}`, timestamp: "t",
        message: { role: "user", content: [{ type: "text", text: `问${label}` }] },
      },
      {
        type: "message", id: `a${index}`, parentId: `u${index}`, timestamp: "t",
        message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: `答${label}` }] },
      },
    ]),
  ];
  const result = sessionToMarkdown(turnEntries, "a2", { maxMessages: 4 });
  assert.equal(result.messageCount, 6);
  assert.equal(result.omittedMessages, 2);
  // The oldest turn goes whole, uncondensed: it does not fit, and a condensed
  // line would still spend one of the four message slots.
  assert.equal(
    result.markdown,
    "… 2 messages omitted …\n\nUser: 问二\n\nAssistant: 答二\n\nUser: 问三\n\nAssistant: 答三",
  );
});

test("sessionToMarkdown keeps one turn that is over the char cap on its own whole", () => {
  const entry = (id, role, parentId, text) => ({
    type: "message", id, parentId, timestamp: "t",
    message: { role, ...(role === "assistant" ? { stopReason: "stop" } : {}), content: [{ type: "text", text }] },
  });
  const result = sessionToMarkdown([
    { type: "session", id: "hdr", timestamp: "2026-11-14T00:00:00Z", version: 3 },
    entry("u0", "user", "hdr", "x".repeat(300)),
    entry("a0", "assistant", "u0", "y".repeat(300)),
  ], "a0", { maxChars: 100 });
  // Nothing to drop: splitting the turn would orphan one of its halves.
  assert.equal(result.omittedMessages, 0);
  assert.match(result.markdown, /^User: x+…\n\nAssistant: y+…$/);
  assert.ok(result.markdown.length <= 210);
});

test("sessionToMarkdown condenses turns older than the focus to one line each", () => {
  const turn = (index) => ([
    {
      type: "message", id: `u${index}`, parentId: index === 0 ? "hdr" : `a${index - 1}`, timestamp: "t",
      message: { role: "user", content: [{ type: "text", text: `问${index}` }] },
    },
    {
      type: "message", id: `a${index}`, parentId: `u${index}`, timestamp: "t",
      message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: `答${index}` }] },
    },
  ]);
  const result = sessionToMarkdown([
    { type: "session", id: "hdr", timestamp: "2026-11-14T00:00:00Z", version: 3 },
    ...turn(0), ...turn(1), ...turn(2), ...turn(3), ...turn(4),
  ], "a4", {});
  // Five turns, the newest three in full: the two earlier ones keep only their
  // question, and the two replies are what the count reports.
  assert.equal(result.messageCount, 10);
  assert.equal(result.omittedMessages, 2);
  assert.equal(
    result.markdown,
    "User: 问0\nUser: 问1\n\n… earlier turns condensed to their first question (2 messages omitted) …\n\n"
      + "User: 问2\n\nAssistant: 答2\n\nUser: 问3\n\nAssistant: 答3\n\nUser: 问4\n\nAssistant: 答4",
  );
});

test("sessionToMarkdown cuts a condensed question to its first line and eighty characters", () => {
  const long = `${"很长的开场白".repeat(30)}\n第二段不该出现`;
  const result = sessionToMarkdown([
    { type: "session", id: "hdr", timestamp: "2026-11-14T00:00:00Z", version: 3 },
    { type: "message", id: "u0", parentId: "hdr", timestamp: "t", message: { role: "user", content: [{ type: "text", text: long }] } },
    { type: "message", id: "a0", parentId: "u0", timestamp: "t", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "答" }] } },
    ...["一", "二", "三"].flatMap((label, index) => [
      {
        type: "message", id: `u${index + 1}`, parentId: index === 0 ? "a0" : `a${index}`, timestamp: "t",
        message: { role: "user", content: [{ type: "text", text: `问${label}` }] },
      },
      {
        type: "message", id: `a${index + 1}`, parentId: `u${index + 1}`, timestamp: "t",
        message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: `答${label}` }] },
      },
    ]),
  ], "a3", {});
  const condensed = result.markdown.split("\n")[0];
  assert.match(condensed, /^User: 很长的开场白/);
  assert.equal(condensed.length, "User: ".length + 80);
  assert.match(condensed, /…$/);
  assert.doesNotMatch(result.markdown, /第二段不该出现/);
});

test("sessionToMarkdown handles an empty file", () => {
  const result = sessionToMarkdown([], null, {});
  assert.deepEqual(result, { markdown: "", messageCount: 0, omittedMessages: 0 });
});