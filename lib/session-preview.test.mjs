import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { sessionMessagePreview, SESSION_PREVIEW_MAX_LENGTH } = await createJiti(import.meta.url).import("./session-preview.ts");

test("previews only user and assistant text, not thinking or tool results", () => {
  assert.equal(sessionMessagePreview({ role: "assistant", content: [
    { type: "thinking", thinking: "private thought" },
    { type: "text", text: "first\nline" },
    { type: "toolCall", name: "bash" },
    { type: "text", text: "second" },
  ] }), "first line second");
  assert.equal(sessionMessagePreview({ role: "toolResult", content: "tool output" }), undefined);
  assert.equal(sessionMessagePreview({ role: "assistant", content: [{ type: "thinking", thinking: "only thought" }] }), undefined);
  assert.equal(sessionMessagePreview({ role: "user", content: [{ type: "image", data: "not text" }] }), undefined);
});

test("collapses skill expansions and limits the preview without splitting a surrogate pair", () => {
  const expanded = '<skill name="example" location="/skills/example/SKILL.md">\nReferences are relative to /skills/example.\n\nbody\n</skill>\n\narguments';
  assert.equal(sessionMessagePreview({ role: "user", content: expanded }), "/skill:example arguments");
  const preview = sessionMessagePreview({ role: "assistant", content: "x".repeat(SESSION_PREVIEW_MAX_LENGTH - 1) + "😀tail" });
  assert.equal(preview, "x".repeat(SESSION_PREVIEW_MAX_LENGTH - 1));
});
