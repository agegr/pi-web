import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const routeSrc = readFileSync(new URL("./[id]/context/route.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { buildSessionContext } = await jiti.import("@/lib/session-reader");
const { paginateSessionContext, parseSessionContextPageRequest } = await jiti.import("@/lib/session-context-page");

test("context 路由复用完整分支缓存后分页，图片 URL 带会话身份", () => {
  assert.match(routeSrc, /parseSessionContextPageRequest\(url.searchParams\)/);
  assert.match(routeSrc, /getSessionContextFromSnapshot/);
  assert.match(routeSrc, /paginateSessionContext\(fullContext, pageRequest\)/);
  assert.match(routeSrc, /sessionId: id/);
  assert.doesNotMatch(routeSrc, /before \?\? leafId|excludeLeaf: Boolean\(before\)/);
});

test("数字 before 作为排他边界，上翻不重复已返回消息", () => {
  const entries = Array.from({ length: 100 }, (_, i) => ({
    id: `e${i}`, parentId: i ? `e${i - 1}` : null, type: "message",
    timestamp: new Date(1000 + i * 1000).toISOString(), message: { role: "user", content: `m${i}` },
  }));
  const full = buildSessionContext(entries, "e99");
  const first = paginateSessionContext(full, parseSessionContextPageRequest(new URLSearchParams("tail=5")));
  assert.deepEqual(first.context.entryIds, ["e95", "e96", "e97", "e98", "e99"]);
  const second = paginateSessionContext(full, parseSessionContextPageRequest(new URLSearchParams(`before=${first.page.startIndex}&limit=5`)));
  assert.deepEqual(second.context.entryIds, ["e90", "e91", "e92", "e93", "e94"]);
  assert.equal(first.context.entryIds.some(id => second.context.entryIds.includes(id)), false);
  assert.equal(second.context.oldestEntryId, "e90");
  assert.equal(second.context.hasMore, second.page.hasEarlier);
});

test("到达根节点后返回空窗口，不保留完整分支的旧游标", () => {
  const full = buildSessionContext([{ id: "e0", parentId: null, type: "message", timestamp: new Date(1000).toISOString(), message: { role: "user", content: "root" } }]);
  const page = paginateSessionContext(full, { before: 0, limit: 120 });
  assert.deepEqual(page.context.entryIds, []);
  assert.equal(page.context.oldestEntryId, null);
  assert.equal(page.context.hasMore, false);
  assert.equal(page.page.hasEarlier, false);
});
