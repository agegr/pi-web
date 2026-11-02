import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

async function loadSubject() {
  return jiti.import("./favicon-badge.ts");
}

test("no badge when nothing awaits or is unread", async () => {
  const { getFaviconBadge, faviconBadgeKey } = await loadSubject();
  assert.equal(getFaviconBadge({ awaiting: 0, unread: 0 }), null);
  assert.equal(faviconBadgeKey(null), "none");
});

test("unread sessions badge blue with their count", async () => {
  const { getFaviconBadge, faviconBadgeKey } = await loadSubject();
  const badge = getFaviconBadge({ awaiting: 0, unread: 3 });
  assert.deepEqual(badge, { kind: "unread", count: 3 });
  assert.equal(faviconBadgeKey(badge), "unread:3");
});

test("awaiting input wins the color and joins the count", async () => {
  const { getFaviconBadge, faviconBadgeKey } = await loadSubject();
  const badge = getFaviconBadge({ awaiting: 1, unread: 2 });
  assert.deepEqual(badge, { kind: "awaiting", count: 3 });
  assert.equal(faviconBadgeKey(badge), "awaiting:3");
});

test("count caps at 99 and ignores junk input", async () => {
  const { getFaviconBadge } = await loadSubject();
  assert.deepEqual(getFaviconBadge({ awaiting: 0, unread: 500 }), { kind: "unread", count: 99 });
  assert.equal(getFaviconBadge({ awaiting: -2, unread: NaN }), null);
});

test("hidden finishes count once and never twice (#1484)", async () => {
  const { countFaviconUnread } = await loadSubject();
  assert.equal(countFaviconUnread(new Set(["a"])), 1);
  assert.equal(countFaviconUnread(new Set(["a"]), new Set()), 1);
  assert.equal(countFaviconUnread(new Set(["a"]), new Set(["b"])), 2);
  assert.equal(countFaviconUnread(new Set(["a"]), new Set(["a"])), 1);
  assert.equal(countFaviconUnread(new Set(), new Set(["a", "b"])), 2);
});
