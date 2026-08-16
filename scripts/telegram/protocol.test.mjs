import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chunkMessage,
  errorMessage,
  formatReply,
  isAllowed,
  parseAllowlist,
  parseUpdates,
  resolveLocale,
} from "./protocol.ts";

const update = (id, fields = {}) => ({
  update_id: id,
  message: { chat: { id: 42 }, from: { username: "bruce" }, text: "hello", ...fields },
});

test("parseUpdates extracts messages and the next offset", () => {
  const { messages, nextOffset } = parseUpdates({ ok: true, result: [update(7), update(8)] });
  assert.deepEqual(messages.map((m) => [m.updateId, m.chatId, m.text]), [[7, 42, "hello"], [8, 42, "hello"]]);
  assert.equal(nextOffset, 9);
});

test("unsupported updates are still acknowledged", () => {
  // A sticker has no text. If its update_id did not advance the offset, the
  // loop would refetch it forever and never see anything after it.
  const sticker = { update_id: 11, message: { chat: { id: 42 }, sticker: {} } };
  const { messages, nextOffset } = parseUpdates({ ok: true, result: [sticker] });
  assert.deepEqual(messages, []);
  assert.equal(nextOffset, 12, "the offset must move past updates we cannot handle");
});

test("blank and whitespace-only messages are ignored but acknowledged", () => {
  const { messages, nextOffset } = parseUpdates({ ok: true, result: [update(3, { text: "   " })] });
  assert.deepEqual(messages, []);
  assert.equal(nextOffset, 4);
});

test("trimming preserves multibyte text and captures the sender", () => {
  // Non-ASCII on purpose: a byte-wise trim would corrupt these characters.
  const { messages } = parseUpdates({ ok: true, result: [update(1, { text: "  买牛奶  " })] });
  assert.equal(messages[0].text, "买牛奶");
  assert.equal(messages[0].from, "bruce");
});

test("the sender's Telegram language is captured when present", () => {
  const withLang = parseUpdates({
    ok: true,
    result: [update(1, { from: { username: "bruce", language_code: "zh-hans" } })],
  });
  assert.equal(withLang.messages[0].languageCode, "zh-hans");

  const without = parseUpdates({ ok: true, result: [update(2)] });
  assert.equal(without.messages[0].languageCode, undefined);
});

test("resolveLocale maps every Chinese tag to zh and everything else to en", () => {
  for (const tag of ["zh", "zh-hans", "zh-CN", "ZH-TW"]) {
    assert.equal(resolveLocale(tag), "zh", tag);
  }
  for (const tag of ["en", "en-GB", "fr", undefined, ""]) {
    assert.equal(resolveLocale(tag), "en", String(tag));
  }
});

test("replies follow the sender's language", () => {
  assert.equal(formatReply("好的", ["todo_add"], "zh"), "好的\n\n— 记了待办");
  assert.equal(formatReply("好的", ["todo_list", "todo_add"], "zh"), "好的\n\n— 查了待办、记了待办");
  assert.equal(formatReply("   ", ["todo_add"], "zh"), "（没有回复内容）\n\n— 记了待办");
  assert.match(errorMessage("boom", "zh"), /出错了：boom/);
  assert.match(errorMessage("boom", "en"), /Something went wrong: boom/);
});

test("a failed or malformed response yields nothing", () => {
  assert.deepEqual(parseUpdates({ ok: false }), { messages: [], nextOffset: null });
  assert.deepEqual(parseUpdates(null), { messages: [], nextOffset: null });
  assert.deepEqual(parseUpdates({ ok: true, result: "nope" }), { messages: [], nextOffset: null });
});

test("parseAllowlist reads a comma list and rejects junk", () => {
  assert.deepEqual(parseAllowlist("123, 456"), [123, 456]);
  assert.deepEqual(parseAllowlist("-1001234567890"), [-1001234567890], "group chat ids are negative");
  assert.deepEqual(parseAllowlist(undefined), []);
  assert.deepEqual(parseAllowlist("  "), []);
  assert.throws(() => parseAllowlist("123,abc"), /Not a numeric chat id/);
});

test("isAllowed is exact membership, never a prefix or truthiness check", () => {
  assert.ok(isAllowed(42, [42]));
  assert.ok(!isAllowed(42, []), "an empty allow-list authorizes nobody");
  assert.ok(!isAllowed(4, [42]));
  assert.ok(!isAllowed(0, [42]));
});

test("chunkMessage leaves short text alone", () => {
  assert.deepEqual(chunkMessage("short"), ["short"]);
});

test("chunkMessage splits on line breaks when it can", () => {
  const text = `${"a".repeat(60)}\n${"b".repeat(60)}`;
  const chunks = chunkMessage(text, 100);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], "a".repeat(60));
  assert.equal(chunks[1], "b".repeat(60));
});

test("chunkMessage hard-splits when there is no usable break", () => {
  const chunks = chunkMessage("x".repeat(250), 100);
  assert.deepEqual(chunks.map((c) => c.length), [100, 100, 50]);
});

test("formatReply appends the tools that actually ran", () => {
  assert.equal(formatReply("Added.", ["todo_add"]), "Added.\n\n— added a todo");
  assert.equal(
    formatReply("Done", ["todo_list", "todo_add", "todo_list"]),
    "Done\n\n— read your todos, added a todo",
  );
  assert.equal(formatReply("Just chatting", []), "Just chatting");
});

test("formatReply survives an empty model reply", () => {
  assert.equal(formatReply("   ", ["todo_add"]), "(no reply text)\n\n— added a todo");
});
