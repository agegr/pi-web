import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  withoutContentSignatures,
  withoutMessageSignatures,
} = await jiti.import("./message-signatures.ts");

// All provider identifiers and payloads in these fixtures are synthetic.
function assistant(content) {
  return {
    role: "assistant",
    provider: "openai",
    model: "synthetic-model",
    content,
  };
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test("removes a GPT reasoning item's signature JSON while retaining visible thinking", () => {
  const signature = JSON.stringify({
    type: "reasoning",
    id: "rs_synthetic",
    summary: [{ type: "summary_text", text: "Synthetic reasoning summary" }],
    encrypted_content: "synthetic-encrypted-content",
  });
  const message = deepFreeze(assistant([{
    type: "thinking",
    thinking: "Synthetic reasoning summary",
    thinkingSignature: signature,
    redacted: false,
    deferred: true,
  }]));

  assert.deepEqual(withoutMessageSignatures(message), assistant([{
    type: "thinking",
    thinking: "Synthetic reasoning summary",
    redacted: false,
    deferred: true,
  }]));
  assert.equal(message.content[0].thinkingSignature, signature);
});

test("removes an empty thinking signature and preserves the redacted marker", () => {
  const block = deepFreeze({
    type: "thinking",
    thinking: "",
    thinkingSignature: "",
    redacted: true,
  });
  const expected = { type: "thinking", thinking: "", redacted: true };

  assert.deepEqual(withoutContentSignatures(block), expected);
  assert.deepEqual(
    withoutMessageSignatures(deepFreeze(assistant([block]))).content,
    [expected],
  );
  assert.equal(block.thinkingSignature, "");
});

test("removes GPT text message ids and versioned text signatures without changing text", () => {
  const message = deepFreeze(assistant([
    { type: "text", text: "Synthetic commentary", textSignature: "msg_synthetic_legacy" },
    {
      type: "text",
      text: "Synthetic answer",
      textSignature: JSON.stringify({ v: 1, id: "msg_synthetic_v1", phase: "final_answer" }),
    },
  ]));

  assert.deepEqual(withoutMessageSignatures(message), assistant([
    { type: "text", text: "Synthetic commentary" },
    { type: "text", text: "Synthetic answer" },
  ]));
});

test("projects a standalone Gemini SDK tool call for toolcall_end without filtering arguments", () => {
  const args = {
    thinkingSignature: "user-supplied-thinking",
    textSignature: "user-supplied-text",
    thoughtSignature: "user-supplied-thought",
    nested: [{ thoughtSignature: "nested-user-data" }],
  };
  const block = deepFreeze({
    type: "toolCall",
    id: "call_synthetic_gemini",
    name: "synthetic_tool",
    arguments: args,
    thoughtSignature: "synthetic-gemini-thought-signature",
    namespace: "synthetic_namespace",
  });
  const projected = withoutContentSignatures(block);

  assert.deepEqual(projected, {
    type: "toolCall",
    id: "call_synthetic_gemini",
    name: "synthetic_tool",
    arguments: args,
    namespace: "synthetic_namespace",
  });
  assert.deepEqual(projected.arguments, {
    thinkingSignature: "user-supplied-thinking",
    textSignature: "user-supplied-text",
    thoughtSignature: "user-supplied-thought",
    nested: [{ thoughtSignature: "nested-user-data" }],
  });
  assert.notStrictEqual(projected, block);
  assert.equal(block.thoughtSignature, "synthetic-gemini-thought-signature");
});

test("copies a frozen mixed assistant transcript and retains message and block metadata", () => {
  const message = deepFreeze({
    ...assistant([
      { type: "thinking", thinking: "Synthetic plan", thinkingSignature: "synthetic-thinking" },
      { type: "text", text: "Visible text" },
      {
        type: "toolCall",
        id: "call_synthetic_mixed",
        name: "synthetic_tool",
        arguments: { count: 2 },
        thoughtSignature: "synthetic-tool-thought",
        metadata: { textSignature: "nested-user-metadata" },
      },
    ]),
    stopReason: "toolUse",
    timestamp: 123,
    durationMs: 456,
    thinkingSignature: "message-level-user-metadata",
    textSignature: "message-level-text-metadata",
    thoughtSignature: "message-level-thought-metadata",
  });
  const before = structuredClone(message);
  const projected = withoutMessageSignatures(message);

  assert.deepEqual(projected, {
    ...message,
    content: [
      { type: "thinking", thinking: "Synthetic plan" },
      { type: "text", text: "Visible text" },
      {
        type: "toolCall",
        id: "call_synthetic_mixed",
        name: "synthetic_tool",
        arguments: { count: 2 },
        metadata: { textSignature: "nested-user-metadata" },
      },
    ],
  });
  assert.notStrictEqual(projected, message);
  assert.notStrictEqual(projected.content, message.content);
  assert.notStrictEqual(projected.content[0], message.content[0]);
  assert.notStrictEqual(projected.content[2], message.content[2]);
  assert.deepEqual(message, before);
});

test("filters all three top-level signature keys even when their values are empty or undefined", () => {
  const block = deepFreeze({
    type: "text",
    text: "Visible text",
    thinkingSignature: "synthetic-thinking",
    textSignature: undefined,
    thoughtSignature: "",
    encrypted_content: "synthetic-unrelated-property",
    metadata: { thinkingSignature: "nested-user-data" },
  });

  assert.deepEqual(withoutContentSignatures(block), {
    type: "text",
    text: "Visible text",
    encrypted_content: "synthetic-unrelated-property",
    metadata: { thinkingSignature: "nested-user-data" },
  });
  assert.equal(Object.hasOwn(block, "textSignature"), true);
});

test("keeps unsigned display content including images and normalized tool input unchanged", () => {
  const content = deepFreeze([
    { type: "thinking", thinking: "Display preview", deferred: true, redacted: true },
    { type: "text", text: "thinkingSignature textSignature thoughtSignature are literal text" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "c3ludGhldGlj" } },
    {
      type: "toolCall",
      toolCallId: "call_synthetic_display",
      toolName: "synthetic_tool",
      input: {
        thinkingSignature: "user-thinking",
        textSignature: "user-text",
        thoughtSignature: "user-thought",
      },
      rawInput: '{"thoughtSignature":"user-thought"}',
    },
  ]);

  for (const block of content) {
    assert.deepEqual(withoutContentSignatures(block), block);
  }
  for (const blocks of [content, []]) {
    const message = deepFreeze(assistant(blocks));
    assert.deepEqual(withoutMessageSignatures(message), message);
  }
});

test("returns non-assistant messages and assistant messages without array content by identity", () => {
  const content = [{ type: "text", text: "Synthetic content", textSignature: "msg_synthetic_passthrough" }];
  const messages = [
    { role: "user", content },
    { role: "system", content },
    { role: "toolResult", toolCallId: "call_synthetic_result", content },
    { role: "custom", customType: "synthetic", display: true, content },
    ...["Synthetic plain text", "", null, undefined, { content }].map((value) => assistant(value)),
    { role: "assistant" },
  ];

  for (const message of messages) {
    deepFreeze(message);
    assert.strictEqual(withoutMessageSignatures(message), message);
  }
});
