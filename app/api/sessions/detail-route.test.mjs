import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// Use real JSONL parsing and route handlers, but never construct an AgentSession.
const directory = mkdtempSync(join(tmpdir(), "pi-web-detail-route-"));
const rpcStub = join(directory, "rpc.mjs");
writeFileSync(rpcStub, "export const getRpcSession = (id) => globalThis.__piDetailRouteRpcs?.get(id);\n");
const jiti = createJiti(import.meta.url, {
  alias: { "@/lib/rpc-manager": rpcStub, "@": process.cwd() },
  moduleCache: false,
});
const { GET: detail } = await jiti.import("./[id]/route.ts");
const { GET: context } = await jiti.import("./[id]/context/route.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("../../../lib/session-reader.ts");
const { invalidateParsedSession } = await jiti.import("../../../lib/session-detail-cache.ts");
const id = "history-fixture";
const filePath = join(directory, "history.jsonl");
const timestamp = "2026-01-01T00:00:00.000Z";
const usage = (input, output, cost) => ({ input, output, cacheRead: 0, cacheWrite: 0, cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } });
const entries = [
  { type: "session", version: 3, id, timestamp, cwd: directory },
  { type: "custom", id: "tools", parentId: null, timestamp, customType: "pi-web:tool-selection", data: { version: 1, tools: [] } },
];
for (let i = 0; i < 300; i++) {
  entries.push({ type: "message", id: `e${i}`, parentId: i ? `e${i - 1}` : "tools", timestamp,
    message: i % 2
      ? { role: "assistant", provider: "fixture", model: "fixture", content: [{ type: "text", text: `m${i}` }], ...(i === 1 ? { usage: usage(100, 10, 0.25) } : {}) }
      : { role: "user", content: `m${i}` },
  });
}
entries.push({ type: "compaction", id: "cmp", parentId: "e299", timestamp, summary: "压缩摘要", firstKeptEntryId: "e250", tokensBefore: 110, usage: usage(5, 1, 0.05) });
entries.push({ type: "message", id: "after", parentId: "cmp", timestamp, message: { role: "user", content: "after compaction" } });
writeFileSync(filePath, entries.map(x => JSON.stringify(x)).join("\n") + "\n");
cacheSessionPath(id, filePath);
after(() => {
  delete globalThis.__piDetailRouteRpcs;
  invalidateSessionPathCache(id);
  invalidateParsedSession(filePath);
  rmSync(directory, { recursive: true, force: true });
});
const params = (sessionId = id) => ({ params: Promise.resolve({ id: sessionId }) });

async function json(handler, query = "", sessionId = id, status = 200) {
  const response = await handler(new Request(`http://localhost/api/sessions/${sessionId}${query}`), params(sessionId));
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  assert.match(response.headers.get("Server-Timing"), /total;dur=/);
  return body;
}

test("详情首屏保持 60 条，累计用量与压缩前输入历史不随窗口缩小", async () => {
  const body = await json(detail, "?tail=60");
  assert.equal(body.context.messages.length, 60);
  assert.deepEqual(body.contextPage, { startIndex: 242, endIndex: 302, totalMessages: 302, hasEarlier: true });
  assert.deepEqual(body.context.entryIds, [...Array.from({ length: 58 }, (_, i) => `e${242 + i}`), "cmp", "after"]);
  assert.equal(body.context.oldestEntryId, "e242");
  assert.equal(body.context.hasMore, true);
  assert.equal(body.contextStats.totalMessages, 302);
  assert.equal(body.stats.totalMessages, 301);
  assert.equal(body.stats.tokens.total, 116);
  assert.equal(body.stats.cost, 0.3);
  assert.equal(body.inputHistory.length, 50);
  assert.equal(body.inputHistory.at(-1), "after compaction");
  assert.equal(body.info.firstMessage, "m0");
  assert.equal(body.info.messageCount, 301);
  assert.deepEqual(body.toolNames, []);
});

test("context 使用数字 before 和 120 条窗口，上翻覆盖压缩前历史且不重复", async () => {
  const tail = await json(detail, "?tail=60");
  const earlier = await json(context, "?before=242&limit=120");
  assert.deepEqual(earlier.page, { startIndex: 122, endIndex: 242, totalMessages: 302, hasEarlier: true });
  assert.deepEqual(earlier.context.entryIds, Array.from({ length: 120 }, (_, i) => `e${122 + i}`));
  assert.equal(earlier.context.entryIds.some(id => tail.context.entryIds.includes(id)), false);
  assert.equal(earlier.context.messages.length, earlier.context.entryIds.length);
  assert.deepEqual(earlier.inputHistory, tail.inputHistory);
  const beginning = await json(context, "?before=2&limit=120");
  assert.deepEqual(beginning.context.entryIds, ["e0", "e1"]);
  assert.equal(beginning.page.hasEarlier, false);
  assert.equal(beginning.context.hasMore, false);
  const empty = await json(context, "?before=0&limit=120");
  assert.deepEqual(empty.context.entryIds, []);
  assert.equal(empty.context.oldestEntryId, null);
});

test("分页参数严格校验，窗口最大 240，未指定分页时保留完整分支接口", async () => {
  for (const handler of [detail, context]) {
    assert.equal((await json(handler, "?tail=10000")).context.messages.length, 240);
    assert.equal((await json(handler, "?tail=1")).context.messages.length, 1);
    assert.equal((await json(handler)).context.messages.length, 302);
    for (const query of ["?tail=NaN", "?tail=0", "?before=e242", "?before=-1", "?limit=10"]) {
      await json(handler, query, id, 400);
    }
  }
});

test("分支查询只返回所选祖先链，不能复用另一叶节点的缓存", async () => {
  const selected = await json(context, "?leafId=e10&tail=5");
  assert.deepEqual(selected.context.entryIds, ["e6", "e7", "e8", "e9", "e10"]);
  assert.equal(selected.contextStats.totalMessages, 11);
  const empty = await json(context, "?leafId=&tail=5");
  assert.deepEqual(empty.context.entryIds, []);
  const latest = await json(context, "?tail=5");
  assert.deepEqual(latest.context.entryIds, ["e297", "e298", "e299", "cmp", "after"]);
});

test("详情与 context 的惰性工具图片使用当前会话 URL，不污染完整媒体缓存", async (t) => {
  const mediaId = "media-fixture";
  const mediaPath = join(directory, "media.jsonl");
  const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJDRA==" } };
  writeFileSync(mediaPath, [
    { type: "session", version: 3, id: mediaId, timestamp, cwd: directory },
    { type: "message", id: "user", parentId: null, timestamp, message: { role: "user", content: "图片" } },
    { type: "message", id: "result", parentId: "user", timestamp, message: { role: "toolResult", toolCallId: "read1", toolName: "read", content: [image] } },
  ].map(x => JSON.stringify(x)).join("\n") + "\n");
  cacheSessionPath(mediaId, mediaPath);
  t.after(() => { invalidateSessionPathCache(mediaId); invalidateParsedSession(mediaPath); });
  for (const handler of [detail, context]) {
    const deferred = await json(handler, "?tail=1&deferMedia=1", mediaId);
    assert.equal(deferred.context.messages[0].content[0].source.url, "/api/sessions/media-fixture/entries/result/tool-result-image?blockIndex=0");
    const full = await json(handler, "?tail=1", mediaId);
    assert.deepEqual(full.context.messages[0].content[0], image);
  }
});

test("运行中空叶节点不回退到磁盘快照或旧消息", async () => {
  const liveId = "live-empty-fixture";
  globalThis.__piDetailRouteRpcs = new Map([[liveId, {
    isAlive: () => true, isRunning: () => false, sessionFile: "",
    inner: { sessionManager: {
      getEntries: () => [{ type: "message", id: "old", parentId: null, timestamp, message: { role: "user", content: "旧分支" } }],
      getLeafId: () => null, getTree: () => [], getSessionName: () => undefined,
      getHeader: () => ({ type: "session", version: 3, id: liveId, timestamp, cwd: directory }),
    } },
  }]]);
  try {
    for (const handler of [detail, context]) {
      const body = await json(handler, "?tail=60", liveId);
      assert.deepEqual(body.context.messages, []);
      assert.deepEqual(body.context.entryIds, []);
      assert.equal(body.context.oldestEntryId, null);
    }
  } finally {
    delete globalThis.__piDetailRouteRpcs;
  }
});
