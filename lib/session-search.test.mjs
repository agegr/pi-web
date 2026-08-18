import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionSearchDocuments,
  createSessionSearchSnippet,
  searchSessionMessages,
} from "./session-search.ts";

const messages = [
  { role: "user", content: "Find the deployment notes" },
  {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "private deployment reasoning" },
      { type: "text", text: "The release is deployed from GitHub Actions." },
      { type: "toolCall", toolCallId: "x", toolName: "read", input: { path: "deployment-secret" } },
    ],
    provider: "test",
    model: "test",
  },
  { role: "toolResult", toolCallId: "x", content: [{ type: "text", text: "deployment tool output" }] },
];

test("indexes user and assistant text with aligned entry ids", () => {
  assert.deepEqual(createSessionSearchDocuments(messages, ["u1", "a1", "t1"]), [
    { entryId: "u1", messageIndex: 0, role: "user", text: "Find the deployment notes" },
    { entryId: "a1", messageIndex: 1, role: "assistant", text: "The release is deployed from GitHub Actions." },
  ]);
});

test("searches case-insensitively while excluding reasoning and tool payloads", () => {
  assert.deepEqual(
    searchSessionMessages(messages, ["u1", "a1", "t1"], "DEPLOYED").map(({ entryId }) => entryId),
    ["a1"],
  );
  assert.deepEqual(searchSessionMessages(messages, ["u1", "a1", "t1"], "private"), []);
  assert.deepEqual(searchSessionMessages(messages, ["u1", "a1", "t1"], "tool output"), []);
});

test("creates a bounded snippet around the match", () => {
  const text = `${"before ".repeat(40)}needle ${"after ".repeat(40)}`;
  const snippet = createSessionSearchSnippet(text, "needle", 80);
  assert.ok(snippet.length <= 82);
  assert.match(snippet, /needle/);
  assert.ok(snippet.startsWith("…"));
  assert.ok(snippet.endsWith("…"));
});
