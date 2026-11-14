import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { sideChatHit } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./session-search-hit.ts");

const main = { id: "main-a", name: "Deploy notes", firstMessage: "help me deploy" };
const otherMain = { id: "main-b", name: "", firstMessage: "another chat" };
const namedSide = { id: "side-a", name: "Cache sizing", firstMessage: "help me deploy", relation: { kind: "side", parentSessionId: "main-a" } };
const untitledSideOne = { id: "side-b", name: "Side chat", firstMessage: "help me deploy", created: "2026-01-01", relation: { kind: "side", parentSessionId: "main-a" } };
const untitledSideTwo = { id: "side-c", name: "Side chat", firstMessage: "help me deploy", created: "2026-01-02", relation: { kind: "side", parentSessionId: "main-a" } };
const otherParentSide = { id: "side-d", name: "Side chat", firstMessage: "another chat", created: "2026-01-01", relation: { kind: "side", parentSessionId: "main-b" } };
const subagent = { id: "child-a", relation: { kind: "subagent", parentSessionId: "main-a" } };
const sessions = [main, otherMain, namedSide, untitledSideOne, untitledSideTwo, otherParentSide, subagent];

test("an ordinary session's hit stays a main-chat selection", () => {
  assert.equal(sideChatHit(main, sessions, "Side chat"), null);
  assert.equal(sideChatHit(subagent, sessions, "Side chat"), null);
  assert.equal(sideChatHit({ id: "plain" }, sessions, "Side chat"), null);
});

test("a side chat hit names its parent and keeps its own title", () => {
  assert.deepEqual(sideChatHit(namedSide, sessions, "Side chat"), {
    parentSessionId: "main-a",
    parentTitle: "Deploy notes",
    label: "Cache sizing",
  });
});

test("an untitled side chat is numbered among its own parent's side chats", () => {
  assert.equal(sideChatHit(untitledSideTwo, sessions, "Side chat").label, "Side chat 2");
  assert.equal(sideChatHit(otherParentSide, sessions, "Side chat").label, "Side chat 1");
});

test("a parent without a name falls back to its first message", () => {
  assert.equal(sideChatHit(otherParentSide, sessions, "Side chat").parentTitle, "another chat");
});

test("a hit still opens its parent when the list no longer holds it", () => {
  // The search can read a newer catalogue than the page: the side chat must not
  // become the main chat just because its parent is missing from the list.
  assert.deepEqual(sideChatHit(namedSide, [namedSide], "Side chat"), {
    parentSessionId: "main-a",
    label: "Cache sizing",
  });
});
