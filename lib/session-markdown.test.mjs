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

test("sessionToMarkdown keeps the beginning and the recent end, the middle omitted", () => {
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
  // Ten turns of one message: the beginning gets a quarter of the four slots,
  // the recent end the rest.
  assert.equal(result.omittedMessages, 6);
  assert.equal(
    result.markdown,
    "User: 第 0 条\n\n… 6 messages omitted …\n\nUser: 第 7 条\n\nUser: 第 8 条\n\nUser: 第 9 条",
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
  // The oldest turn goes whole: its two messages are more than the beginning's
  // quarter of the four message slots.
  assert.equal(
    result.markdown,
    "… 2 messages omitted …\n\nUser: 问二\n\nAssistant: 答二\n\nUser: 问三\n\nAssistant: 答三",
  );
});

test("sessionToMarkdown cuts the messages of a turn that is over the char cap on its own", () => {
  const entry = (id, role, parentId, text) => ({
    type: "message", id, parentId, timestamp: "t",
    message: { role, ...(role === "assistant" ? { stopReason: "stop" } : {}), content: [{ type: "text", text }] },
  });
  const result = sessionToMarkdown([
    { type: "session", id: "hdr", timestamp: "2026-11-14T00:00:00Z", version: 3 },
    entry("u0", "user", "hdr", "x".repeat(300)),
    entry("a0", "assistant", "u0", "y".repeat(300)),
  ], "a0", { maxChars: 100 });
  // Nothing to drop: splitting the turn would orphan one of its halves, so
  // both messages are cut to share the cap.
  assert.equal(result.omittedMessages, 0);
  assert.match(result.markdown, /^User: x+…\n\nAssistant: y+…$/);
  assert.ok(result.markdown.length <= 100);
});

test("sessionToMarkdown gives a short question all it needs when the reply is cut", () => {
  const entry = (id, role, parentId, text) => ({
    type: "message", id, parentId, timestamp: "t",
    message: { role, ...(role === "assistant" ? { stopReason: "stop" } : {}), content: [{ type: "text", text }] },
  });
  const result = sessionToMarkdown([
    { type: "session", id: "hdr", timestamp: "2026-11-14T00:00:00Z", version: 3 },
    entry("u0", "user", "hdr", "y".repeat(39_000)),
    entry("a0", "assistant", "u0", "y".repeat(39_000)),
    entry("u1", "user", "a0", "x".repeat(10)),
    entry("a1", "assistant", "u1", "w".repeat(80_000)),
  ], "a1", {});
  assert.ok(result.markdown.length <= 40_000);
  assert.equal(result.omittedMessages, 2);
  assert.match(result.markdown, /^… 2 messages omitted …\n\nUser: x{10}\n\nAssistant: w+…$/);
});

test("sessionToMarkdown quotes a session under both caps whole", () => {
  const turns = [{ type: "session", id: "hdr", timestamp: "2026-11-14T00:00:00Z", version: 3 }];
  for (let index = 0; index < 5; index += 1) {
    turns.push(
      { type: "message", id: `u${index}`, parentId: index === 0 ? "hdr" : `a${index - 1}`, timestamp: "t", message: { role: "user", content: `问${index}\n第二行` } },
      { type: "message", id: `a${index}`, parentId: `u${index}`, timestamp: "t", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: `答${index}` }] } },
    );
  }
  const result = sessionToMarkdown(turns, "a4", {});
  assert.equal(result.omittedMessages, 0);
  assert.equal(result.markdown, Array.from({ length: 5 }, (_, index) => `User: 问${index}\n第二行\n\nAssistant: 答${index}`).join("\n\n"));
});

const turnPair = (index, question, answer, parentId) => ([
  {
    type: "message", id: `u${index}`, parentId, timestamp: "t",
    message: { role: "user", content: [{ type: "text", text: question }] },
  },
  {
    type: "message", id: `a${index}`, parentId: `u${index}`, timestamp: "t",
    message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: answer }] },
  },
]);

test("sessionToMarkdown spends most of the char cap on the recent end and counts the note", () => {
  const long = [{ type: "session", id: "hdr", timestamp: "2026-11-14T00:00:00Z", version: 3 }];
  for (let index = 0; index < 40; index += 1) {
    long.push(...turnPair(index, `问${index} ${"q".repeat(1000)}`, `答${index} ${"a".repeat(1000)}`, index === 0 ? "hdr" : `a${index - 1}`));
  }
  const result = sessionToMarkdown(long, "a39", {});
  assert.ok(result.markdown.length <= 40_000);
  const kept = [...result.markdown.matchAll(/^User: 问(\d+)/gm)].map((match) => Number(match[1]));
  // Whole turns from both ends, more of them from the recent end, one note.
  assert.deepEqual(kept, [0, 1, 2, 3, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39]);
  assert.equal(result.omittedMessages, 80 - kept.length * 2);
  assert.equal(result.markdown.match(/… \d+ messages omitted …/g).length, 1);
  assert.match(result.markdown, /Assistant: 答3 a+\n\n… 42 messages omitted …\n\nUser: 问25 /);
});

test("sessionToMarkdown gives the beginning what the recent end cannot use", () => {
  const result = sessionToMarkdown([
    { type: "session", id: "hdr", timestamp: "2026-11-14T00:00:00Z", version: 3 },
    ...turnPair(0, "问0", "答0", "hdr"),
    ...turnPair(1, "问1", "答1", "a0"),
    ...turnPair(2, "问2", "y".repeat(500), "a1"),
    ...turnPair(3, "问3", "答3", "a2"),
  ], "a3", { maxChars: 200 });
  // Turn 2 does not fit beside the newest one, so turn 1 joins the beginning.
  assert.equal(result.omittedMessages, 2);
  assert.equal(
    result.markdown,
    "User: 问0\n\nAssistant: 答0\n\nUser: 问1\n\nAssistant: 答1\n\n… 2 messages omitted …\n\nUser: 问3\n\nAssistant: 答3",
  );
});

test("sessionToMarkdown gives up the beginning before cutting a newest turn that fits alone", () => {
  const result = sessionToMarkdown([
    { type: "session", id: "hdr", timestamp: "2026-11-14T00:00:00Z", version: 3 },
    ...turnPair(0, "问0", "答0", "hdr"),
    ...turnPair(1, "问1", "答1", "a0"),
    ...turnPair(2, "问2", "y".repeat(140), "a1"),
  ], "a2", { maxChars: 200 });
  assert.equal(result.omittedMessages, 4);
  assert.equal(result.markdown, `… 4 messages omitted …\n\nUser: 问2\n\nAssistant: ${"y".repeat(140)}`);
});

test("sessionToMarkdown names a single omitted message as one", () => {
  const result = sessionToMarkdown([
    { type: "session", id: "hdr", timestamp: "2026-11-14T00:00:00Z", version: 3 },
    ...["a", "b", "c"].map((text, index) => ({
      type: "message", id: `u${index}`, parentId: index === 0 ? "hdr" : `u${index - 1}`, timestamp: "t",
      message: { role: "user", content: [{ type: "text", text }] },
    })),
  ], "u2", { maxMessages: 2 });
  assert.equal(result.markdown, "… 1 message omitted …\n\nUser: b\n\nUser: c");
});

test("sessionToMarkdown handles an empty file", () => {
  const result = sessionToMarkdown([], null, {});
  assert.deepEqual(result, { markdown: "", messageCount: 0, omittedMessages: 0 });
});