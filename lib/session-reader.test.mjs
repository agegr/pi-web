import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildSessionContext, buildFullHistory } = await jiti.import("./session-reader.ts");

function userEntry(id, parentId, content, timestamp = "2026-01-01T00:00:00.000Z") {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "user",
      content,
    },
  };
}

function assistantEntry(id, parentId, text, timestamp = "2026-01-01T00:00:00.000Z") {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role: "assistant",
      provider: "test",
      model: "test-model",
      content: [{ type: "text", text }],
    },
  };
}

function compactionEntry(id, parentId, summary, firstKeptEntryId, timestamp = "2026-01-01T00:00:03.000Z") {
  return {
    type: "compaction",
    id,
    parentId,
    timestamp,
    summary,
    firstKeptEntryId,
    tokensBefore: 123,
  };
}

// ---------------------------------------------------------------------------
// buildSessionContext — compaction-aware ordering, lockstep alignment.
//
// SDK ordering when a compaction is on the active path:
//   [summary, kept..., post-compaction...]
// We mirror that order while keeping `messages[i]` paired with `entryIds[i]`.
// Fork / navigate_tree rely on the pairing, so any drift would silently break
// them. The summary message maps to the compaction entry id; kept messages map
// to their own ids (same as a full-history walk would emit them); post-tail
// messages follow.
// ---------------------------------------------------------------------------

test("compaction: summary leads, entryIds[0] is compaction id, pre-compaction trimmed, summary keeps upstream custom role", () => {
  const entries = [
    userEntry("u1", null, "old user request"),
    assistantEntry("a1", "u1", "old assistant answer"),
    userEntry("u2", "a1", "kept user request"),
    assistantEntry("a2", "u2", "kept assistant answer"),
    compactionEntry("cmp", "a2", "old exchange summary", "u2"),
    userEntry("u3", "cmp", "after compaction"),
  ];

  const context = buildSessionContext(entries);

  // SDK ordering: summary first, then kept (u2, a2), then post (u3).
  assert.deepEqual(context.entryIds, ["cmp", "u2", "a2", "u3"]);
  // The summary message keeps the upstream `custom|compaction` role so
  // CompactionMessageView in MessageView.tsx can render the card UI + file
  // metadata list. The kept and post messages preserve their original roles.
  assert.deepEqual(
    context.messages.map((m) => [m.role, m.customType, m.content]),
    [
      ["custom", "compaction", "old exchange summary"],
      ["user", undefined, "kept user request"],
      ["assistant", undefined, [{ type: "text", text: "kept assistant answer" }]],
      ["user", undefined, "after compaction"],
    ],
  );
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

  // Empty branch_summary does not produce a message.
  assert.deepEqual(context.entryIds, ["u1", "a1"]);
});

test("compaction: thinking_level_change and model_change update settings without emitting messages", () => {
  const entries = [
    userEntry("u1", null, "hi"),
    { type: "thinking_level_change", id: "tlc1", parentId: "u1", timestamp: "2026-01-01T00:00:01.000Z", thinkingLevel: "high" },
    { type: "model_change", id: "mc1", parentId: "tlc1", timestamp: "2026-01-01T00:00:02.000Z", provider: "p", modelId: "m" },
    assistantEntry("a1", "mc1", "hello"),
  ];

  const context = buildSessionContext(entries);

  assert.deepEqual(context.entryIds, ["u1", "a1"], "settings entries are skipped, not rendered");
  assert.equal(context.thinkingLevel, "high");
  // SDK buildSessionContext walks the path in order; a later assistant message
  // overrides the model_change's {provider, modelId}. Our implementation
  // matches that, so the final model is the assistant's.
  assert.deepEqual(context.model, { provider: "test", modelId: "test-model" });
});

test("model_change without a subsequent assistant keeps the change as the active model", () => {
  // When no assistant message follows the model_change on the path, the
  // model_change entry's {provider, modelId} remains the active model —
  // matching the SDK's leaf-walk order where the last writer wins.
  const entries = [
    userEntry("u1", null, "hello"),
    { type: "model_change", id: "mc1", parentId: "u1", timestamp: "2026-01-01T00:00:02.000Z", provider: "p", modelId: "m" },
  ];

  const context = buildSessionContext(entries);

  assert.deepEqual(context.model, { provider: "p", modelId: "m" });
});

test("compaction: assistant message updates model to its provider/modelId", () => {
  const entries = [
    userEntry("u1", null, "hello"),
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
      customType: "extension_debug",
      content: "hidden extension payload",
      display: false,
      details: { source: "test" },
    },
    assistantEntry("a1", "c1", "done"),
  ];

  const context = buildSessionContext(entries);

  assert.deepEqual(context.entryIds, ["u1", "c1", "a1"]);
  assert.equal(context.messages[1].role, "custom");
  assert.equal(context.messages[1].customType, "extension_debug");
  assert.equal(context.messages[1].display, false);
  assert.equal(context.messages[1].content, "hidden extension payload");
});

test("leafId === null returns empty context (matches SDK buildSessionContext null-leaf behaviour)", () => {
  const entries = [
    userEntry("u1", null, "first"),
    assistantEntry("a1", "u1", "reply"),
  ];

  const context = buildSessionContext(entries, null);
  assert.deepEqual(context.entryIds, []);
  assert.deepEqual(context.messages, []);
  assert.equal(context.thinkingLevel, "off");
  assert.equal(context.model, null);
});

// ---------------------------------------------------------------------------
// buildFullHistory — two-phase (cheap index → convert page).
// Emits FULL path order, including any compaction summaries on the path,
// without the compaction-aware trimming that buildSessionContext applies.
// ---------------------------------------------------------------------------

test("buildFullHistory: emits every message-producing entry in path order without trimming", () => {
  const entries = [
    userEntry("u1", null, "old user request"),
    assistantEntry("a1", "u1", "old assistant answer"),
    userEntry("u2", "a1", "kept user request"),
    compactionEntry("cmp", "u2", "old exchange summary", "u2"),
    userEntry("u3", "cmp", "after compaction"),
  ];

  const result = buildFullHistory(entries);

  // Full history shows ALL of u1, a1, u2, summary(cmp), u3 — NOT trimmed.
  // Compaction keeps the upstream custom-role shape in full history too,
  // so CompactionMessageView can render it in the paginated view as well.
  assert.equal(result.total, 5);
  assert.deepEqual(result.entryIds, ["u1", "a1", "u2", "cmp", "u3"]);
  assert.equal(result.messages[3].role, "custom");
  assert.equal(result.messages[3].customType, "compaction");
  assert.equal(result.messages[3].content, "old exchange summary");
});

test("buildFullHistory: two-phase pagination returns only the requested slice", () => {
  const entries = [];
  let prev = null;
  for (let i = 0; i < 10; i++) {
    const id = `u${i}`;
    entries.push(userEntry(id, prev, `msg ${i}`));
    prev = id;
  }

  // Page 2: skip 4, take 3.
  const result = buildFullHistory(entries, undefined, 4, 3);

  assert.equal(result.total, 10);
  assert.deepEqual(result.entryIds, ["u4", "u5", "u6"]);
  assert.deepEqual(
    result.messages.map((m) => m.content),
    ["msg 4", "msg 5", "msg 6"],
  );
});

test("buildFullHistory: offset beyond total returns empty slice but correct total", () => {
  const entries = [
    userEntry("u1", null, "only one"),
  ];

  const result = buildFullHistory(entries, undefined, 99, 5);

  assert.equal(result.total, 1);
  assert.deepEqual(result.messages, []);
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

  const result = buildFullHistory(entries);

  // Empty branch_summary does not count in total and is not emitted.
  assert.equal(result.total, 2);
  assert.deepEqual(result.entryIds, ["u1", "a1"]);
});

test("buildFullHistory: lockstep length invariant holds in all pages", () => {
  const entries = [];
  let prev = null;
  for (let i = 0; i < 100; i++) {
    const id = `e${i}`;
    if (i % 2 === 0) entries.push(userEntry(id, prev, `user ${i}`));
    else entries.push(assistantEntry(id, prev, `assistant ${i}`));
    prev = id;
  }

  for (let offset = 0; offset < entries.length; offset += 7) {
    const r = buildFullHistory(entries, undefined, offset, 7);
    assert.equal(
      r.messages.length,
      r.entryIds.length,
      `lockstep length mismatch at offset=${offset}: messages=${r.messages.length} entryIds=${r.entryIds.length}`,
    );
  }
});