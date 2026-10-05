import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { readFileSync } from "node:fs";

const {
  hasOneShotBlock,
  stripOneShotBlock,
  stripOneShotInstructions,
} = await createJiti(import.meta.url).import("./one-shot-commands.ts");

const { expandChainedCommands } = await createJiti(import.meta.url).import("./chained-commands.ts");

const stripFrontmatter = (p) =>
  readFileSync(p, "utf8").replace(/^---[\s\S]*?---\n/, "");

const userMessage = (text) => ({ role: "user", content: text, timestamp: 0 });
const assistantMessage = (text) => ({ role: "assistant", content: text, timestamp: 0 });

test("an expanded /fuse message is detected and cleaned", () => {
  const templates = [
    { name: "fuse", content: stripFrontmatter("/Users/yingjunwang/.pi/agent/prompts/fuse.md") },
  ];
  const expanded = expandChainedCommands("/fuse 分析家有谱的最大挑战", templates);
  const message = userMessage(expanded);

  assert.equal(hasOneShotBlock(message), true);

  const cleaned = stripOneShotBlock(message);
  assert.equal(hasOneShotBlock(cleaned), false);
  // The template body survives so the conversation still makes sense.
  assert.match(cleaned.content, /双模型独立作答/);
  assert.match(cleaned.content, /分析家有谱的最大挑战/);
  // The instruction that caused the re-run is gone.
  assert.doesNotMatch(cleaned.content, /一次性指令/);
  assert.doesNotMatch(cleaned.content, /不要自动重跑本命令的流程/);
});

test("the user's own follow-up text is never touched", () => {
  const followUp = userMessage("补充：\n1.创始人具有中国的注册一级结构工程师资格");
  assert.equal(hasOneShotBlock(followUp), false);
  assert.equal(stripOneShotBlock(followUp), followUp);
});

test("assistant answers are never touched", () => {
  const answer = assistantMessage("执行标记已确认：[PI-DUAL-REAL-RUN a7d10fa3]");
  assert.equal(stripOneShotBlock(answer), answer);
});

test("a transcript with one inline /fuse message is rewritten", () => {
  const templates = [
    { name: "fuse", content: stripFrontmatter("/Users/yingjunwang/.pi/agent/prompts/fuse.md") },
  ];
  const messages = [
    userMessage(expandChainedCommands("/fuse 分析家有谱", templates)),
    assistantMessage("已给出双模型分析。"),
    userMessage("补充：创始人有一级结构工程师资格"),
  ];

  const next = stripOneShotInstructions(messages);
  assert.notEqual(next, messages, "should return a new array when stripping");
  assert.equal(hasOneShotBlock(next[0]), false);
  assert.equal(next[1], messages[1], "untouched messages keep identity");
  assert.equal(next[2], messages[2], "untouched messages keep identity");
});

test("a transcript with nothing to strip is returned by identity", () => {
  const messages = [userMessage("普通问题"), assistantMessage("普通回答")];
  assert.equal(stripOneShotInstructions(messages), messages);
});

test("block content is preserved for content-block messages", () => {
  const expanded = "正文\n\n---\n**【一次性指令，仅对本次回复生效】**\n只对这一次生效。";
  const message = {
    role: "user",
    content: [
      { type: "text", text: expanded },
      { type: "image", data: "x", mimeType: "image/png" },
    ],
    timestamp: 0,
  };

  assert.equal(hasOneShotBlock(message), true);
  const cleaned = stripOneShotBlock(message);
  assert.equal(cleaned.content[0].text, "正文");
  assert.deepEqual(cleaned.content[1], { type: "image", data: "x", mimeType: "image/png" });
});

test("stripping is idempotent", () => {
  const expanded = "正文\n\n---\n**【一次性指令，仅对本次回复生效】**\n只对这一次生效。";
  const once = stripOneShotBlock(userMessage(expanded));
  const twice = stripOneShotBlock(once);
  assert.equal(hasOneShotBlock(twice), false);
  assert.equal(twice.content, once.content);
});
