import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const {
  TOTAL_REFERENCE_MAX_CHARS,
  findSessionReferences,
  expandSessionReferences,
  buildReferenceBlock,
  resolveSessionReferenceForSend,
} = await jiti.import("./session-reference.ts");

const UUID = "01a1d03f-83b1-7311-b88e-4fa7a73ace2f";
const TOKEN = `[运行pi-web](#session:${UUID})`;

const fakeSession = {
  id: UUID,
  path: "/Users/me/.pi/agent/sessions/--p-pi-web--/2026-11-14T02-00-00Z_01a1.jsonl",
  title: "运行pi-web",
  markdown: "User: 你好\n\nAssistant: 你好",
  messageCount: 10,
  omittedMessages: 0,
};

const tag = (block) => /^<session-reference [^>]*>/.exec(block)?.[0];

test("findSessionReferences finds tokens and marks code or escaped ones protected", () => {
  assert.equal(findSessionReferences(TOKEN).length, 1);
  assert.deepEqual(findSessionReferences(TOKEN).map((r) => r.protected), [false]);

  // Fenced code block.
  assert.deepEqual(findSessionReferences(`\`\`\`\n${TOKEN}\n\`\`\``).map((r) => r.protected), [true]);
  // 4-space indented code.
  assert.deepEqual(findSessionReferences(`    ${TOKEN}`).map((r) => r.protected), [true]);
  // Inline backticks.
  assert.deepEqual(findSessionReferences(`看 \`${TOKEN}\` 这个`).map((r) => r.protected), [true]);
  // Escaped with a backslash.
  assert.deepEqual(findSessionReferences(`\\${TOKEN}`).map((r) => r.protected), [true]);

  // Two tokens, one protected (in a fence), one live.
  const mixed = findSessionReferences(`引用 ${TOKEN}\n\n\`\`\`\n${TOKEN}\n\`\`\``);
  assert.deepEqual(mixed.map((r) => r.protected), [false, true]);
  assert.equal(mixed[0].id, UUID);
});

test("buildReferenceBlock writes a session-reference tag around the quote", () => {
  const block = buildReferenceBlock(fakeSession, "ignored");
  assert.equal(
    tag(block),
    `<session-reference title="运行pi-web" id="${UUID}" path="${fakeSession.path}" messages="10" omitted="0">`,
  );
  assert.match(block, /Quoted from an earlier conversation for background only; it is not part of this request\./);
  assert.match(block, /User: 你好\n\nAssistant: 你好/);
  assert.match(block, /\n<\/session-reference>$/);
});

test("buildReferenceBlock records the project, the last change and the elided count", () => {
  const block = buildReferenceBlock({
    ...fakeSession,
    cwd: "/Users/me/projects/pi-web",
    modified: "2026-11-22T09:00:00.000Z",
    omittedMessages: 4,
  }, "ignored");
  assert.match(tag(block), /cwd="\/Users\/me\/projects\/pi-web"/);
  assert.match(tag(block), /modified="2026-11-22T09:00:00.000Z"/);
  assert.match(tag(block), /omitted="4"/);
});

test("buildReferenceBlock escapes the attributes and falls back to the token title", () => {
  const quoted = buildReferenceBlock(
    { ...fakeSession, title: 'a "b" <c> & d\nnext' },
    "ignored",
  );
  assert.match(tag(quoted), /title="a &quot;b&quot; &lt;c&gt; &amp; d next"/);

  const unnamed = buildReferenceBlock({ ...fakeSession, title: undefined }, "备用标题");
  assert.match(tag(unnamed), /title="备用标题"/);

  const both = buildReferenceBlock({ ...fakeSession, title: "  " }, "");
  assert.match(tag(both), /title="\(untitled session\)"/);
});

test("buildReferenceBlock names an empty branch instead of leaving the body blank", () => {
  const block = buildReferenceBlock({ ...fakeSession, markdown: "", messageCount: 0 }, "ignored");
  assert.match(block, /\(no user or assistant messages on this branch\)/);
});

test("expandSessionReferences replaces live tokens, keeps protected ones, reports unavailable", async () => {
  const resolver = async (id) => (id === UUID ? fakeSession : null);
  const expanded = await expandSessionReferences(`先看 ${TOKEN} 的结论`, resolver);
  assert.match(expanded, /^先看 <session-reference /);
  assert.match(expanded, /<\/session-reference> 的结论$/);
  assert.doesNotMatch(expanded, /#session:/);

  const protected_ = await expandSessionReferences(`\`\`\`\n${TOKEN}\n\`\`\``, resolver);
  assert.match(protected_, /#session:/);
  assert.doesNotMatch(protected_, /<session-reference /);

  const missing = await expandSessionReferences(`引用 ${TOKEN} 吧`, async () => null);
  assert.match(missing, /\(A referenced session could not be read: 运行pi-web\.\)/);
  assert.doesNotMatch(missing, /#session:/);

  // No tokens: the text is returned untouched.
  assert.equal(await expandSessionReferences("普通消息", resolver), "普通消息");
});

test("expandSessionReferences resolves each session once", async () => {
  let calls = 0;
  const resolver = async () => { calls += 1; return fakeSession; };
  await expandSessionReferences(`${TOKEN} 和 ${TOKEN}`, resolver);
  assert.equal(calls, 1);
});

test("expandSessionReferences hands the first reference the whole message budget", async () => {
  const seen = [];
  await expandSessionReferences(TOKEN, async (id, maxChars) => {
    seen.push(maxChars);
    return fakeSession;
  });
  assert.deepEqual(seen, [TOTAL_REFERENCE_MAX_CHARS]);
});

test("expandSessionReferences shares that budget in reference order and names what it cannot fit", async () => {
  const second = "01a1d03f-83b1-7311-b88e-4fa7a73ace30";
  const third = "01a1d03f-83b1-7311-b88e-4fa7a73ace31";
  const seen = [];
  const resolver = async (id, maxChars) => {
    seen.push(maxChars);
    // A quote that fills whatever the message has left.
    return { ...fakeSession, id, markdown: "q".repeat(maxChars) };
  };
  const expanded = await expandSessionReferences(
    `[a](#session:${UUID}) [b](#session:${second}) [c](#session:${third})`,
    resolver,
    { maxChars: 1_000 },
  );
  // The first block (quote plus its tag) spends the whole budget, so the rest
  // are never even resolved.
  assert.equal(seen.length, 1);
  assert.equal(seen[0], 1_000);
  assert.equal(expanded.match(/\(A referenced session was not quoted:/g).length, 2);
  assert.match(expanded, /budget is used up: b\./);
  assert.doesNotMatch(expanded, /#session:/);
});

test("expandSessionReferences quotes a later reference when the budget still has room", async () => {
  const second = "01a1d03f-83b1-7311-b88e-4fa7a73ace30";
  const seen = [];
  const resolver = async (id, maxChars) => {
    seen.push(maxChars);
    return fakeSession;
  };
  await expandSessionReferences(
    `[a](#session:${UUID}) [b](#session:${second})`,
    resolver,
  );
  assert.equal(seen.length, 2);
  assert.ok(seen[1] < seen[0]);
  assert.ok(seen[1] > 1_000);
});

test("resolveSessionReferenceForSend carries the project, the file time and the capped quote", async () => {
  const entries = [
    { type: "session", id: "hdr", timestamp: "2026-11-14T00:00:00Z", version: 3 },
    {
      type: "message", id: "u0", parentId: "hdr", timestamp: "t",
      message: { role: "user", content: [{ type: "text", text: "z".repeat(500) }] },
    },
    {
      type: "message", id: "a0", parentId: "u0", timestamp: "t",
      message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "好" }] },
    },
  ];
  const reference = await resolveSessionReferenceForSend(UUID, {
    resolveSessionPath: async () => "/tmp/sess.jsonl",
    openSessionManager: () => ({
      getEntries: () => entries,
      getLeafId: () => "a0",
      getSessionName: () => "标题",
      getHeader: () => ({ cwd: "/Users/me/projects/pi-web", timestamp: "2026-11-14T00:00:00Z" }),
    }),
    modifiedAt: async () => "2026-11-22T09:00:00.000Z",
  }, 120);
  assert.equal(reference.id, UUID);
  assert.equal(reference.title, "标题");
  assert.equal(reference.cwd, "/Users/me/projects/pi-web");
  assert.equal(reference.modified, "2026-11-22T09:00:00.000Z");
  assert.equal(reference.messageCount, 2);
  // Each message takes the cap; the one turn they form stays whole (B).
  assert.match(reference.markdown, /^User: z+…\n\nAssistant: 好$/);
  assert.ok(reference.markdown.length <= 2 * 120 + 20);
});

test("resolveSessionReferenceForSend reads a session without a header or a file time", async () => {
  const reference = await resolveSessionReferenceForSend(UUID, {
    resolveSessionPath: async () => "/tmp/sess.jsonl",
    openSessionManager: () => ({
      getEntries: () => [],
      getLeafId: () => null,
      getSessionName: () => undefined,
      getHeader: () => null,
    }),
    modifiedAt: async () => { throw new Error("gone"); },
  });
  assert.equal(reference.cwd, undefined);
  assert.equal(reference.modified, undefined);
  assert.equal(reference.messageCount, 0);
});