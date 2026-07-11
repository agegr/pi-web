import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  buildSessionContext,
  buildFullHistory,
  cacheSessionPath,
  resolveSessionIdByPath,
} = await jiti.import("./session-reader.ts");

function userEntry(id, parentId, content, timestamp = "2026-01-01T00:00:01.000Z") {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "user",
      content: typeof content === "string" ? [{ type: "text", text: content }] : content,
    },
  };
}

function assistantEntry(id, parentId, textContent, timestamp = "2026-01-01T00:00:01.000Z") {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "assistant",
      provider: "test",
      model: "test-model",
      content: [{ type: "text", text: textContent }],
    },
  };
}

function compactionEntry(id, parentId, summary, firstKeptEntryId, timestamp = "2026-01-01T00:00:01.000Z") {
  return {
    type: "compaction",
    id,
    parentId,
    timestamp,
    summary,
    firstKeptEntryId,
  };
}

// ─────────────────────────────────────────────
// Compaction-aware tests (lockstep, ordering, edge cases)
// ─────────────────────────────────────────────

test("compaction: summary leads, entryIds[0] is compaction id, pre-compaction trimmed, summary keeps upstream custom role", () => {
  const entries = [
    userEntry("u1", null, "old user request"),
    assistantEntry("a1", "u1", "old assistant answer"),
    userEntry("u2", "a1", "kept user request"),
    compactionEntry("cmp", "u2", "old exchange summary", "u2"),
    userEntry("u3", "cmp", "after compaction"),
    assistantEntry("a3", "u3", "after compaction answer"),
  ];

  const context = buildSessionContext(entries);

  assert.equal(context.messages.length, 4, "should have 4 messages");
  assert.equal(context.entryIds.length, 4, "should have 4 entryIds");

  // 1st: compaction summary (compaction entry id)
  assert.equal(context.entryIds[0], "cmp");
  assert.equal(context.messages[0].role, "custom");
  assert.equal(context.messages[0].customType, "compaction");
  assert.ok(
    context.messages[0].content.includes("old exchange summary"),
    "summary text should be preserved",
  );

  // 2nd: kept (firstKeptEntryId)
  assert.equal(context.entryIds[1], "u2");
  assert.equal(context.messages[1].role, "user");

  // 3rd: after compaction
  assert.equal(context.entryIds[2], "u3");
  assert.equal(context.messages[2].role, "user");

  // 4th: after compaction assistant
  assert.equal(context.entryIds[3], "a3");
  assert.equal(context.messages[3].role, "assistant");
});

test("compaction: entryIds and messages length are always equal (lockstep)", () => {
  const entries = [
    userEntry("u1", null, "old user request"),
    assistantEntry("a1", "u1", "old assistant answer"),
    userEntry("u2", "a1", "kept user request"),
    compactionEntry("cmp", "u2", "old exchange summary", "u2"),
    userEntry("u3", "cmp", "after compaction"),
    assistantEntry("a3", "u3", "after compaction answer"),
  ];

  const context = buildSessionContext(entries);

  assert.equal(context.messages.length, context.entryIds.length, "lockstep length mismatch");
  assert.deepEqual(context.entryIds, ["cmp", "u2", "u3", "a3"]);
});

test("no compaction: emits every message-producing entry in path order", () => {
  const entries = [
    userEntry("u1", null, "first"),
    assistantEntry("a1", "u1", "reply 1"),
    userEntry("u2", "a1", "second"),
    assistantEntry("a2", "u2", "reply 2"),
  ];

  const context = buildSessionContext(entries);

  assert.deepEqual(context.entryIds, ["u1", "a1", "u2", "a2"]);
  assert.deepEqual(
    context.messages.map((m) => m.role),
    ["user", "assistant", "user", "assistant"],
  );
});

test("compaction: branch_summary with empty summary is skipped", () => {
  const entries = [
    userEntry("u1", null, "first"),
    {
      type: "branch_summary",
      id: "bs_empty",
      parentId: "u1",
      timestamp: "2026-01-01T00:00:01.000Z",
      fromId: "u1",
      summary: "",
    },
    assistantEntry("a1", "bs_empty", "reply"),
  ];

  const context = buildSessionContext(entries);

  assert.equal(context.entryIds.length, 2, "empty branch_summary must be excluded");
  assert.deepEqual(context.entryIds, ["u1", "a1"]);
});

test("compaction: thinking_level_change and model_change update settings without emitting messages", () => {
  const entries = [
    userEntry("u1", null, "first"),
    {
      type: "thinking_level_change",
      id: "tc1",
      parentId: "u1",
      timestamp: "2026-01-01T00:00:01.000Z",
      thinkingLevel: 2,
    },
    {
      type: "model_change",
      id: "mc1",
      parentId: "tc1",
      timestamp: "2026-01-01T00:00:01.000Z",
      provider: "anthropic",
      modelId: "claude-sonnet-4",
    },
    assistantEntry("a1", "mc1", "final answer"),
  ];

  const context = buildSessionContext(entries);

  assert.equal(context.thinkingLevel, 2);
  assert.deepEqual(context.model, { provider: "test", modelId: "test-model" });
  assert.deepEqual(context.entryIds, ["u1", "a1"]);
});

test("model_change without a subsequent assistant keeps the change as the active model", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      type: "model_change",
      id: "mc1",
      parentId: "u1",
      timestamp: "2026-01-01T00:00:01.000Z",
      provider: "anthropic",
      modelId: "claude-3-5-sonnet",
    },
  ];

  const context = buildSessionContext(entries);

  assert.deepEqual(context.model, { provider: "anthropic", modelId: "claude-3-5-sonnet" });
});

test("compaction: assistant message updates model to its provider/modelId", () => {
  const entries = [
    userEntry("u1", null, "hi"),
    {
      type: "message",
      id: "a1",
      parentId: "u1",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        role: "assistant",
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        content: [{ type: "text", text: "hi" }],
      },
    },
  ];

  const context = buildSessionContext(entries);

  assert.deepEqual(context.model, { provider: "anthropic", modelId: "claude-3-5-sonnet" });
});

test("compaction: preserves valid epoch timestamps on the synthesized summary message", () => {
  const entries = [
    userEntry("u1", null, "start"),
    compactionEntry("cmp", "u1", "epoch summary", "u1", "1970-01-01T00:00:00.000Z"),
  ];

  const context = buildSessionContext(entries);

  // Summary is first (cmp.id), timestamp matches compaction entry timestamp.
  assert.equal(context.entryIds[0], "cmp");
  assert.equal(context.messages[0].role, "custom");
  assert.equal(context.messages[0].customType, "compaction");
  assert.equal(context.messages[0].timestamp, 0);
});

test("preserves hidden custom_message so the UI can render it collapsed", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      type: "custom_message",
      id: "c1",
      parentId: "u1",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        role: "custom",
        content: [],
      },
    },
    assistantEntry("a1", "c1", "reply"),
  ];

  const context = buildSessionContext(entries);

  assert.equal(context.entryIds.length, 3, "custom_message must be included");
  // custom_message entries are routed as `custom|custom_message` so the hidden message renders collapsed
  assert.equal(context.entryIds[1], "c1");
  assert.equal(context.messages[1].role, "custom");
  assert.equal(context.messages[1].customType, "custom_message");
});

test("leafId === null returns empty context (matches SDK buildSessionContext null-leaf behaviour)", () => {
  const context = buildSessionContext([], null);
  assert.deepEqual(context.messages, []);
  assert.deepEqual(context.entryIds, []);
});

// ─────────────────────────────────────────────
// Upstream tests (port forward for new upstream features)
// ─────────────────────────────────────────────

test("defers historical thinking without changing live-session content", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      ...assistantEntry("a1", "u1", "answer"),
      message: {
        role: "assistant",
        provider: "test",
        model: "test-model",
        content: [
          { type: "thinking", thinking: "large reasoning" },
          { type: "text", text: "answer" },
        ],
      },
    },
  ];

  const deferred = buildSessionContext(entries, undefined, { deferThinking: true });
  assert.deepEqual(deferred.messages[1].content[0], {
    type: "thinking",
    thinking: "",
    deferred: true,
  });

  const full = buildSessionContext(entries);
  assert.equal(full.messages[1].content[0].thinking, "large reasoning");
});

test("does not defer empty historical thinking blocks", () => {
  const entries = [
    userEntry("u1", null, "start"),
    {
      ...assistantEntry("a1", "u1", "answer"),
      message: {
        role: "assistant",
        provider: "test",
        model: "test-model",
        content: [
          { type: "thinking", thinking: "" },
          { type: "text", text: "answer" },
        ],
      },
    },
  ];

  const context = buildSessionContext(entries, undefined, { deferThinking: true });
  assert.deepEqual(context.messages[1].content[0], { type: "thinking", thinking: "" });
});

test("defers only base64 images from historical tool results", () => {
  const userImage = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "QUJDRA==" },
  };
  const toolImage = {
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: "QUJDRA==" },
  };
  const toolUrlImage = {
    type: "image",
    source: { type: "url", url: "https://example.com/result.png" },
  };
  const flatToolImage = {
    type: "image",
    data: "QUJDRA==",
    mimeType: "image/png",
  };
  const entries = [
    userEntry("u1", null, [{ type: "text", text: "inspect this" }, userImage]),
    assistantEntry("a1", "u1", "reading"),
    {
      type: "message",
      id: "tr1",
      parentId: "a1",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call1",
        content: [
          { type: "text", text: "Read image file" },
          toolImage,
          flatToolImage,
          toolUrlImage,
        ],
      },
    },
  ];

  const deferred = buildSessionContext(entries, undefined, { deferToolResultImages: true });
  assert.deepEqual(deferred.messages[0].content[1], userImage);
  assert.deepEqual(deferred.messages[2].content[0], { type: "text", text: "Read image file" });
  assert.deepEqual(deferred.messages[2].content[1], toolUrlImage);
  assert.match(deferred.messages[2].content[2].text, /2 tool result images omitted.*image\/jpeg, image\/png.*~8 bytes/);

  const full = buildSessionContext(entries);
  assert.deepEqual(full.messages[2].content[1], toolImage);
  assert.deepEqual(full.messages[2].content[2], flatToolImage);
  assert.deepEqual(full.messages[2].content[3], toolUrlImage);
});

test("keeps forward and reverse session path caches in sync", async () => {
  const sessionDir = mkdtempSync(join(tmpdir(), "session-test-"));
  try {
    // Write a minimal session file
    const sessionPath = join(sessionDir, "session.jsonl");
    writeFileSync(sessionPath, ``);

    const arr = Array.from("abcde");
    for (const char of arr) {
      // cache the stub paths
      const sid = `session-${char}`;
      cacheSessionPath(sid, sessionPath);
      const resolved = await resolveSessionIdByPath(sessionPath);
      assert.ok(resolved, `should resolve path back to session-${char}`);
    }
  } finally {
    rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────
// buildFullHistory tests
// ─────────────────────────────────────────────

test("buildFullHistory: emits every message-producing entry in path order without trimming", () => {
  const entries = [
    userEntry("u1", null, "old user request"),
    assistantEntry("a1", "u1", "old assistant answer"),
    userEntry("u2", "a1", "kept user request"),
    compactionEntry("cmp", "u2", "old exchange summary", "u2"),
    userEntry("u3", "cmp", "after compaction"),
    assistantEntry("a3", "u3", "after compaction answer"),
  ];

  const result = buildFullHistory(entries, undefined, 0, 200);

  // Full history includes ALL producing entries (root → leaf)
  assert.equal(result.total, 6);
  assert.equal(result.messages.length, 6);
  assert.deepEqual(result.entryIds, ["u1", "a1", "u2", "cmp", "u3", "a3"]);
});

test("buildFullHistory: two-phase pagination returns only the requested slice", () => {
  const entries = [
    userEntry("u1", null, "first"),
    assistantEntry("a1", "u1", "reply 1"),
    userEntry("u2", "a1", "second"),
    assistantEntry("a2", "u2", "reply 2"),
    userEntry("u3", "a2", "third"),
    assistantEntry("a3", "u3", "reply 3"),
  ];

  const page2 = buildFullHistory(entries, undefined, 2, 2);

  assert.equal(page2.total, 6);
  assert.equal(page2.messages.length, 2);
  assert.deepEqual(page2.entryIds, ["u2", "a2"]);
  assert.equal(page2.messages[0].role, "user");
  assert.equal(page2.messages[0].content[0].text, "second");
});

test("buildFullHistory: offset beyond total returns empty slice but correct total", () => {
  const entries = [
    userEntry("u1", null, "first"),
    assistantEntry("a1", "u1", "reply"),
  ];

  const result = buildFullHistory(entries, undefined, 10, 10);

  assert.equal(result.total, 2);
  assert.equal(result.messages.length, 0);
  assert.deepEqual(result.entryIds, []);
});

test("buildFullHistory: branch_summary with empty summary is excluded from total/page", () => {
  const entries = [
    userEntry("u1", null, "first"),
    {
      type: "branch_summary",
      id: "bs_empty",
      parentId: "u1",
      timestamp: "2026-01-01T00:00:01.000Z",
      fromId: "u1",
      summary: "",
    },
    assistantEntry("a1", "bs_empty", "reply"),
  ];

  const result = buildFullHistory(entries, undefined, 0, 200);

  assert.equal(result.total, 2, "empty branch_summary must be excluded");
  assert.deepEqual(result.entryIds, ["u1", "a1"]);
});

test("buildFullHistory: lockstep length invariant holds in all pages", () => {
  const entries = Array.from({ length: 10 }, (_, i) => {
    const isUser = i % 2 === 0;
    const id = isUser ? `u${Math.floor(i / 2)}` : `a${Math.floor(i / 2)}`;
    if (isUser) {
      return userEntry(id, i > 0 ? `a${Math.floor((i - 1) / 2)}` : null, `msg ${i}`);
    }
    return assistantEntry(id, `u${Math.floor(i / 2)}`, `reply ${i}`);
  });

  const limit = 3;
  for (let offset = 0; offset < entries.length; offset += limit) {
    const page = buildFullHistory(entries, undefined, offset, limit);
    assert.equal(
      page.messages.length,
      page.entryIds.length,
      `offset=${offset}: lockstep length mismatch`,
    );
    if (page.messages.length > 0) {
      assert.equal(page.entryIds[0].charAt(0), offset % 2 === 0 ? "u" : "a");
    }
  }
});
