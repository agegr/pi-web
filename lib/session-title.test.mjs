import assert from "node:assert/strict";
import test from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  buildTitleRequest,
  buildTitleTranscript,
  generateSessionTitle,
  parseGeneratedSessionTitle,
  resolveTitleThinkingLevel,
} = await jiti.import("./session-title.ts");

function assistantMessage(text) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "test",
    provider: "test",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function replyWith(title, capture) {
  return (model, context, options) => {
    capture?.({ model, ...context, options, messages: [...context.messages] });
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      stream.push({ type: "done", reason: "stop", message: assistantMessage(title) });
    });
    return stream;
  };
}

test("cleans common session title response wrappers", () => {
  assert.equal(parseGeneratedSessionTitle("标题：修复 SSE 重连。"), "修复 SSE 重连");
  assert.equal(parseGeneratedSessionTitle('```json\n{"title":"整理 Session 文件夹"}\n```'), "整理 Session 文件夹");
  assert.equal(parseGeneratedSessionTitle('"Improve worktree session grouping"'), "Improve worktree session grouping");
});

test("rejects responses without a usable title", () => {
  assert.throws(() => parseGeneratedSessionTitle("```\n---\n```"), /usable session title/);
});

test("names a running session from what it holds right now, without waiting for idle", async () => {
  let seen;
  let waited = false;
  const sourceAgent = {
    state: {
      systemPrompt: "system",
      model: { provider: "test", id: "test-model" },
      thinkingLevel: "off",
      tools: [],
      messages: [{ role: "user", content: "Implement auto name", timestamp: 1 }],
      isStreaming: true,
    },
    waitForIdle: async () => {
      waited = true;
      await new Promise(() => {});
    },
    convertToLlm: (messages) => messages,
    streamFunction: replyWith("Name Mid Turn", (value) => { seen = value; }),
    sessionId: "source-session-id",
  };

  const result = await generateSessionTitle({ agent: sourceAgent });

  assert.equal(result.title, "Name Mid Turn");
  assert.equal(waited, false);
  // Providers read the prompt from the transcript's leading system message.
  assert.deepEqual(seen.messages.map((message) => message.role), ["system", "user"]);
  assert.match(JSON.stringify(seen.messages[0].content), /name chat sessions/);
  assert.match(JSON.stringify(seen.messages[1].content), /Implement auto name/);
});

test("generates a title when compaction removed all literal user messages", async () => {
  let seen;
  const sourceAgent = {
    state: {
      systemPrompt: "system",
      model: { provider: "test", id: "test-model" },
      thinkingLevel: "off",
      tools: [],
      messages: [
        {
          role: "compactionSummary",
          summary: "The user asked to fix title generation after compaction.",
          tokensBefore: 100_000,
          timestamp: 1,
        },
        assistantMessage("The implementation is complete"),
      ],
    },
    waitForIdle: async () => {},
    convertToLlm,
    streamFunction: replyWith("Title Generation After Compaction", (value) => { seen = value; }),
    sessionId: "source-session-id",
  };

  const result = await generateSessionTitle({ agent: sourceAgent });

  assert.equal(result.title, "Title Generation After Compaction");
  assert.deepEqual(seen.messages.map((message) => message.role), ["system", "user"]);
  assert.match(seen.messages[1].content[0].text, /fix title generation after compaction/);
});

test("title request is a standalone stream and does not reuse the session prefix", () => {
  const model = { provider: "test", id: "session-model", reasoning: false };
  const transformContext = async (value) => value;
  const source = {
    state: {
      systemPrompt: "cached system prompt",
      model,
      thinkingLevel: "high",
      tools: [{ name: "read", label: "read", description: "Read a file", parameters: {}, execute: async () => ({}) }],
      messages: [{ role: "user", content: "Fix it" }],
    },
    convertToLlm: (value) => value,
    transformContext,
    streamFunction: () => { throw new Error("not called"); },
    sessionId: "source-session-id",
    transport: "sse",
  };

  const request = buildTitleRequest(source, "User: Fix it");

  assert.equal(request.model, model);
  assert.equal(request.context.systemPrompt, "You name chat sessions from a transcript. Reply with the title only.");
  assert.notEqual(request.context.systemPrompt, source.state.systemPrompt);
  assert.equal(request.context.tools, undefined);
  assert.deepEqual(request.context.messages.map((message) => message.role), ["user"]);
  assert.equal(request.options.cacheRetention, "none");
  assert.notEqual(request.options.sessionId, source.sessionId);
  assert.equal(request.options.transport, "sse");
  assert.equal(request.options.reasoning, undefined);
});

test("names with the cheapest thinking level the session model accepts", () => {
  const source = {
    state: { systemPrompt: "", model: { provider: "test", id: "session-model", reasoning: true, thinkingLevelMap: { off: null } }, thinkingLevel: "high", tools: [], messages: [] },
    streamFunction: () => {},
    sessionId: "source-session-id",
  };

  assert.equal(buildTitleRequest(source, "User: Fix it").options.reasoning, "minimal");
  assert.equal(resolveTitleThinkingLevel({ reasoning: false, id: "any-model" }), "off");
  // The cheapest supported level wins, in the SDK's cost order, not a fixed preference list.
  assert.equal(resolveTitleThinkingLevel({ reasoning: true, id: "r", thinkingLevelMap: { off: null } }), "minimal");
  assert.equal(resolveTitleThinkingLevel({ reasoning: true, id: "r", thinkingLevelMap: { off: null, minimal: null, low: null } }), "medium");
  // Gemini rejects "minimal" and reports it whenever thinking is disabled.
  assert.equal(resolveTitleThinkingLevel({ reasoning: true, id: "gemini-2.5-flash", api: "google-generative-ai" }), "low");
});

test("sends one flat transcript without tool traffic on the session's own model", async () => {
  let seen;
  const sessionModel = { provider: "big", id: "expensive", reasoning: false };
  const sourceAgent = {
    state: {
      systemPrompt: "a very long cached system prompt",
      model: sessionModel,
      thinkingLevel: "high",
      tools: [{ name: "read", label: "read", description: "Read a file", parameters: {}, execute: async () => ({}) }],
      messages: [
        { role: "user", content: "why is naming so expensive", timestamp: 1 },
        {
          ...assistantMessage("Reading the file"),
          content: [
            { type: "text", text: "Reading the file" },
            { type: "toolCall", id: "call-read", name: "read", arguments: { path: "a.txt" } },
          ],
          stopReason: "toolUse",
        },
        { role: "toolResult", toolCallId: "call-read", toolName: "read", content: [{ type: "text", text: "ENORMOUS TOOL OUTPUT" }], isError: false, timestamp: 2 },
        { role: "user", content: "actually, only count user turns", timestamp: 3 },
        assistantMessage("The cache only helps the session model"),
      ],
    },
    waitForIdle: async () => {},
    convertToLlm,
    streamFunction: replyWith("Session Title Cost", (value) => { seen = value; }),
    sessionId: "source-session-id",
  };
  const result = await generateSessionTitle({ agent: sourceAgent });

  assert.equal(result.title, "Session Title Cost");
  assert.equal(seen.model, sessionModel);
  assert.deepEqual(seen.messages.map((message) => message.role), ["system", "user"]);
  assert.deepEqual(seen.messages[0].toolsAdded ?? [], []);
  assert.equal(seen.options.cacheRetention, "none");
  assert.notEqual(seen.options.sessionId, "source-session-id");
  const sent = JSON.stringify(seen.messages[1].content);
  assert.match(sent, /why is naming so expensive/);
  assert.match(sent, /only count user turns/);
  assert.match(sent, /The cache only helps the session model/);
  assert.doesNotMatch(sent, /ENORMOUS TOOL OUTPUT/);
  assert.match(sent, /Create a concise title/);
});

test("keeps every user turn whole and clips replies to their opening", () => {
  const transcript = buildTitleTranscript([
    { role: "user", content: "GOAL", timestamp: 1 },
    assistantMessage(`${"a".repeat(300)}TAIL-OF-FIRST-REPLY`),
    { role: "user", content: `PIVOT ${"u".repeat(800)}`, timestamp: 2 },
    assistantMessage(`${"b".repeat(600)}TAIL-OF-LAST-REPLY`),
  ]);

  assert.match(transcript, /User: GOAL/);
  assert.match(transcript, /User: PIVOT/);
  // The first reply keeps 300 characters, the last keeps 600; anything past that is gone.
  assert.match(transcript, /Assistant: a{300}…/);
  assert.match(transcript, /Assistant: b{600}…/);
  assert.doesNotMatch(transcript, /TAIL-OF-FIRST-REPLY/);
  assert.doesNotMatch(transcript, /TAIL-OF-LAST-REPLY/);
  // Long user turns are clipped, never dropped.
  assert.match(transcript, /PIVOT u+…/);
});

test("bounds the transcript so a long session costs no more than a short one", () => {
  const build = (turns) => buildTitleTranscript(Array.from({ length: turns }, (_, i) => [
    { role: "user", content: i === 0 ? "ORIGINAL GOAL" : `step ${i} ${"u".repeat(700)}`, timestamp: i },
    assistantMessage(i === turns - 1 ? "FINAL OUTCOME" : `reply ${i} ${"a".repeat(280)}`),
  ]).flat());

  const long = build(40);
  const longer = build(400);
  // Ten times the session, same size transcript: only which turns fit varies.
  assert.ok(Math.abs(long.length - longer.length) < 100,
    `transcript size must stop tracking session length, got ${long.length} vs ${longer.length}`);
  for (const length of [long.length, longer.length]) {
    assert.ok(length <= 6000, `expected a bounded transcript, got ${length}`);
  }

  // The goal and the outcome are what a title is made of, so both survive the cut.
  for (const transcript of [long, longer]) {
    assert.match(transcript, /User: ORIGINAL GOAL/);
    assert.match(transcript, /Assistant: FINAL OUTCOME/);
    assert.match(transcript, /\[…\]/);
  }

  // Spending the whole budget on the newest turns would title a session after
  // its last chore, so the opening turns keep a reserved share of it.
  const buried = buildTitleTranscript([
    { role: "user", content: "anything else worth tidying up?", timestamp: 0 },
    { role: "user", content: `KAFKA CONSUMER LAG ${"k".repeat(600)}`, timestamp: 1 },
    assistantMessage(`the poll loop exceeded max.poll.interval.ms ${"a".repeat(200)}`),
    ...Array.from({ length: 60 }, (_, i) => [
      { role: "user", content: `chore ${i} reformat the touched files ${"c".repeat(700)}`, timestamp: i + 2 },
      assistantMessage(`reformatted ${i} ${"r".repeat(280)}`),
    ]).flat(),
  ]);
  assert.match(buried, /KAFKA CONSUMER LAG/, "the opening work must survive a long, dull tail");
  // A short session is untouched: no budget pressure, no elision.
  assert.doesNotMatch(build(2), /\[…\]/);
});

test("keeps an image placeholder when a user turn has no text", () => {
  const transcript = buildTitleTranscript([
    {
      role: "user",
      content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } }],
      timestamp: 1,
    },
  ]);
  assert.match(transcript, /User: \[image\]/);
});

test("refuses to name a session with no usable text", async () => {
  let called = false;
  await assert.rejects(
    () => generateSessionTitle({
      agent: {
        state: {
          systemPrompt: "system",
          model: { provider: "test", id: "test-model" },
          thinkingLevel: "off",
          tools: [],
          messages: [{
            ...assistantMessage(""),
            content: [{ type: "toolCall", id: "call", name: "read", arguments: { path: "a.txt" } }],
            stopReason: "toolUse",
          }],
        },
        streamFunction: () => {
          called = true;
          throw new Error("should not call the title model");
        },
      },
    }),
    /usable text/,
  );
  assert.equal(called, false);
});
