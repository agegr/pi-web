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
];

test("sessionToMarkdown renders the branch, skipping thinking", () => {
  const result = sessionToMarkdown(entries, "u2", {});
  assert.equal(result.truncated, false);
  assert.match(result.markdown, /帮我看下 provider 插件/);
  assert.match(result.markdown, /我来处理/);
  assert.match(result.markdown, /\[工具调用: read\(/);
  assert.match(result.markdown, /\[工具结果: 文件内容摘要\]/);
  assert.match(result.markdown, /> 摘要: 前面讨论了 provider 的 sync 方案/);
  assert.match(result.markdown, /> 模型: deepseek\/deepseek-v4/);
  assert.match(result.markdown, /\[图片\]/);
  assert.doesNotMatch(result.markdown, /一段很长的思考/);
  assert.equal(result.includedEntries > 0, true);
});

test("sessionToMarkdown walks from the leaf, not the file end", () => {
  // A sibling entry after the leaf on disk must not leak into the branch.
  const withSibling = [...entries, { type: "message", id: "other", parentId: "hdr", timestamp: "t", message: { role: "user", content: [{ type: "text", text: "旁支内容" }] } }];
  const result = sessionToMarkdown(withSibling, "u2", {});
  assert.doesNotMatch(result.markdown, /旁支内容/);
});

test("sessionToMarkdown truncates at the char cap", () => {
  const result = sessionToMarkdown(entries, "u2", { maxChars: 10 });
  assert.equal(result.truncated, true);
  assert.ok(result.markdown.length <= 10);
});

test("sessionToMarkdown caps the branch at maxEntries", () => {
  const result = sessionToMarkdown(entries, "u2", { maxEntries: 2 });
  assert.equal(result.totalEntries, 2);
  assert.doesNotMatch(result.markdown, /帮我看下 provider 插件/); // oldest entry dropped
});

test("sessionToMarkdown handles an empty file", () => {
  const result = sessionToMarkdown([], null, {});
  assert.equal(result.markdown, "");
  assert.equal(result.truncated, false);
  assert.equal(result.totalEntries, 0);
});
