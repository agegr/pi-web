import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { sessionReferencesAsMentions, splitSessionReferences } = await jiti.import("./session-reference-block.ts");

const UUID = "01a1d03f-83b1-7311-b88e-4fa7a73ace2f";
const UUID2 = "01a1d03f-83b1-7311-b88e-4fa7a73ace30";

const block = (id, title, count, body) => [
  `<session-reference title="${title}" id="${id}" path="/tmp/${id}.jsonl" messages="${count}">`,
  "Quoted from an earlier conversation for background only; it is not part of this request.",
  "",
  body,
  "</session-reference>",
].join("\n");

test("splitSessionReferences returns the typed text and one block segment", () => {
  const segments = splitSessionReferences(`帮我看下这段\n\n${block(UUID, "修复登录", 13, "User: 你好\nAssistant: 好")}`);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0], { kind: "text", text: "帮我看下这段" });
  assert.equal(segments[1].kind, "reference");
  assert.equal(segments[1].title, "修复登录");
  assert.equal(segments[1].id, UUID);
  assert.equal(segments[1].path, `/tmp/${UUID}.jsonl`);
  assert.equal(segments[1].messages, 13);
  assert.match(segments[1].body, /^Quoted from an earlier conversation/);
  assert.match(segments[1].body, /User: 你好\nAssistant: 好$/);
  assert.equal(segments[1].raw.startsWith(`<session-reference title="修复登录"`), true);
  assert.equal(segments[1].raw.endsWith("</session-reference>"), true);
});

test("splitSessionReferences reads escaped attributes back", () => {  const segments = splitSessionReferences(block(UUID, "a &quot;b&quot; &lt;c&gt; &amp; d", 2, "User: hi"));
  assert.equal(segments.length, 1);
  assert.equal(segments[0].title, 'a "b" <c> & d');
});

test("splitSessionReferences pairs the outermost tag, so a nested block stays body text", () => {
  const inner = block(UUID2, "内层会话", 4, "User: inner");
  const segments = splitSessionReferences(block(UUID, "外层会话", 9, `User: 我之前引用了\n\n${inner}`));
  assert.equal(segments.length, 1);
  assert.equal(segments[0].title, "外层会话");
  assert.match(segments[0].body, /<session-reference title="内层会话"/);
  assert.equal(segments[0].raw.endsWith("</session-reference>"), true);
  // The outer raw holds the inner block in full, and nothing after it.
  assert.equal(segments[0].raw.match(/<\/session-reference>/g).length, 2);
});

test("splitSessionReferences ignores a bare tag name in prose, but reads a block with attributes", () => {
  // Real data: these conversations write `<session-reference>` while discussing
  // this very feature, inside the quoted text.
  const body = "User: 我们说的是 `<session-reference>` 标签落盘\nAssistant: 好";
  const segments = splitSessionReferences(`${block(UUID, "外层", 5, body)}\n\n后面这句`);
  assert.deepEqual(segments.map((segment) => segment.kind), ["reference", "text"]);
  assert.equal(segments[0].title, "外层");
  assert.match(segments[0].body, /`<session-reference>` 标签落盘/);
  assert.deepEqual(segments[1], { kind: "text", text: "后面这句" });
});

test("splitSessionReferences reads two sibling blocks whose body mentions the tag", () => {
  const first = block(UUID, "一", 1, "User: 还有 <session-reference 这个写法没用完");
  const second = block(UUID2, "二", 2, "User: b");
  const segments = splitSessionReferences(`${first}\n\n${second}`);
  assert.deepEqual(segments.map((segment) => segment.kind), ["reference", "reference"]);
  assert.deepEqual(segments.map((segment) => segment.title), ["一", "二"]);
  assert.match(segments[0].body, /<session-reference 这个写法没用完/);
});

test("splitSessionReferences keeps the text between and after blocks", () => {
  const segments = splitSessionReferences(`${block(UUID, "一", 1, "User: a")}\n\n中间这句话\n\n${block(UUID2, "二", 2, "User: b")}\n\n最后一句`);
  assert.deepEqual(segments.map((segment) => segment.kind), ["reference", "text", "reference", "text"]);
  assert.deepEqual(segments[1], { kind: "text", text: "中间这句话" });
  assert.deepEqual(segments[3], { kind: "text", text: "最后一句" });
});

test("splitSessionReferences leaves an unclosed block as text", () => {
  const text = '看这个 <session-reference title="x" id="y" messages="1">\nUser: hi';
  assert.deepEqual(splitSessionReferences(text), [{ kind: "text", text }]);
});

test("splitSessionReferences keeps a message that only mentions the syntax", () => {
  assert.deepEqual(splitSessionReferences("普通消息，没有引用"), [{ kind: "text", text: "普通消息，没有引用" }]);
  assert.deepEqual(splitSessionReferences("   "), []);
});

test("splitSessionReferences tolerates a block without a message count", () => {
  const segments = splitSessionReferences(`<session-reference title="x" id="${UUID}" path="/p">\nUser: hi\n</session-reference>`);
  assert.equal(segments[0].messages, null);
  assert.deepEqual(segments[0].body, "User: hi");
});
test("splitSessionReferences reads the project, the last change and the elided count", () => {
  const source = `<session-reference title="会话" id="${UUID}" path="/tmp/${UUID}.jsonl" cwd="/Users/me/projects/pi-web" modified="2026-11-22T09:00:00.000Z" messages="20" omitted="7">\nUser: hi\n</session-reference>`;
  const [segment] = splitSessionReferences(source);
  assert.equal(segment.cwd, "/Users/me/projects/pi-web");
  assert.equal(segment.modified, "2026-11-22T09:00:00.000Z");
  assert.equal(segment.omitted, 7);
});

test("splitSessionReferences reads a block written before those attributes as unknown", () => {
  // Blocks written before cwd / modified / omitted existed still render: the
  // tooltip falls back to the path and the line shows no elided count.
  const [segment] = splitSessionReferences(block(UUID, "旧块", 3, "User: hi"));
  assert.equal(segment.cwd, "");
  assert.equal(segment.modified, "");
  assert.equal(segment.omitted, 0);
});

test("sessionReferencesAsMentions names each quoted session instead of its transcript", () => {
  const text = `看得到我引用的session吗\n\n${block(UUID, "你好啊", 2, "User: 你好啊\n\nAssistant: 你好！")}`;
  assert.equal(sessionReferencesAsMentions(text), "看得到我引用的session吗\n\n#你好啊");
  assert.equal(sessionReferencesAsMentions(block(UUID, "", 1, "User: hi")), `#${UUID.slice(0, 8)}`);
  // Text without a block, or with only a bare or unclosed tag, is left as it is.
  for (const plain of ["just a question", "about <session-reference> tags", '<session-reference title="x" id="y">\nno end']) {
    assert.equal(sessionReferencesAsMentions(plain), plain);
  }
});
