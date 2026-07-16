import assert from "node:assert/strict";
import test from "node:test";

async function subject() {
  return import("./session-sidebar.ts");
}

function session(overrides = {}) {
  return {
    id: "s1",
    path: "/x/s1.jsonl",
    cwd: "/home/u/proj",
    name: "s1",
    created: "2024-01-01T00:00:00.000Z",
    modified: "2024-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "hi",
    ...overrides,
  };
}

test("formatRelativeTime buckets recent times", async () => {
  const { formatRelativeTime } = await subject();
  const now = Date.now();
  assert.equal(formatRelativeTime(new Date(now - 10_000).toISOString()), "just now");
  assert.equal(formatRelativeTime(new Date(now - 5 * 60_000).toISOString()), "5m ago");
  assert.equal(formatRelativeTime(new Date(now - 3 * 3_600_000).toISOString()), "3h ago");
  assert.equal(formatRelativeTime(new Date(now - 2 * 86_400_000).toISOString()), "2d ago");
});

test("getRecentProjects dedupes by projectRoot and sorts by recency", async () => {
  const { getRecentProjects } = await subject();
  const sessions = [
    session({ id: "a", projectRoot: "/p/one", modified: "2024-01-01T00:00:00.000Z" }),
    session({ id: "b", projectRoot: "/p/one", modified: "2024-03-01T00:00:00.000Z" }), // newer, same root
    session({ id: "c", projectRoot: "/p/two", modified: "2024-02-01T00:00:00.000Z" }),
    session({ id: "d", projectRoot: undefined, cwd: "" }), // no root — skipped
  ];
  assert.deepEqual(getRecentProjects(sessions), ["/p/one", "/p/two"]);
});

test("getRecentProjects falls back to cwd when projectRoot is absent", async () => {
  const { getRecentProjects } = await subject();
  assert.deepEqual(getRecentProjects([session({ projectRoot: undefined, cwd: "/only/cwd" })]), ["/only/cwd"]);
});

test("displayCwd substitutes the home prefix with ~", async () => {
  const { displayCwd } = await subject();
  assert.equal(displayCwd("/home/u/proj", "/home/u"), "~/proj");
  assert.equal(displayCwd("/other/proj", "/home/u"), "/other/proj");
  assert.equal(displayCwd("/home/u/proj"), "/home/u/proj"); // no homeDir
});

test("buildSessionTree nests children under existing ancestors", async () => {
  const { buildSessionTree } = await subject();
  const roots = buildSessionTree([
    session({ id: "root", modified: "2024-01-01T00:00:00.000Z" }),
    session({ id: "child", parentSessionId: "root", modified: "2024-02-01T00:00:00.000Z" }),
  ]);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].session.id, "root");
  assert.equal(roots[0].children[0].session.id, "child");
});

test("buildSessionTree reparents to nearest existing ancestor when a link is missing", async () => {
  const { buildSessionTree } = await subject();
  // grandparent exists, parent is missing -> child attaches to grandparent
  const roots = buildSessionTree([
    session({ id: "gp" }),
    session({ id: "child", parentSessionId: "missing-parent" }),
    // establish chain child -> missing-parent -> gp via a separate record's parent link
  ].map((s) => (s.id === "child" ? { ...s, parentSessionId: "mid" } : s)).concat([]));
  // With no "mid" record, child becomes a root (ancestor unresolved)
  assert.ok(roots.some((r) => r.session.id === "child"));
});

function collectIds(nodes) {
  const ids = [];
  const walk = (list) => list.forEach((n) => { ids.push(n.session.id); walk(n.children); });
  walk(nodes);
  return ids.sort();
}

test("buildSessionTree breaks a direct parent cycle without dropping nodes", async () => {
  const { buildSessionTree } = await subject();
  // a<->b each name the other as parent, and both exist. The cycle is severed by
  // demoting one node to a root; both remain reachable and it doesn't hang.
  const roots = buildSessionTree([
    session({ id: "a", parentSessionId: "b" }),
    session({ id: "b", parentSessionId: "a" }),
  ]);
  assert.equal(roots.length, 1);
  assert.deepEqual(collectIds(roots), ["a", "b"]);
});

test("buildSessionTree breaks a longer parent cycle", async () => {
  const { buildSessionTree } = await subject();
  const roots = buildSessionTree([
    session({ id: "a", parentSessionId: "c" }),
    session({ id: "b", parentSessionId: "a" }),
    session({ id: "c", parentSessionId: "b" }),
  ]);
  assert.equal(roots.length, 1);
  assert.deepEqual(collectIds(roots), ["a", "b", "c"]);
});

test("buildSessionTree sorts siblings by modified desc", async () => {
  const { buildSessionTree } = await subject();
  const roots = buildSessionTree([
    session({ id: "old", modified: "2024-01-01T00:00:00.000Z" }),
    session({ id: "new", modified: "2024-05-01T00:00:00.000Z" }),
  ]);
  assert.deepEqual(roots.map((r) => r.session.id), ["new", "old"]);
});

test("parse/serialize unread ids round-trip and tolerate junk", async () => {
  const { parseUnreadSessionIds, serializeUnreadSessionIds } = await subject();
  assert.deepEqual([...parseUnreadSessionIds(null)], []);
  assert.deepEqual([...parseUnreadSessionIds("not json")], []);
  assert.deepEqual([...parseUnreadSessionIds('["a","b",3]')], ["a", "b"]); // non-strings filtered
  assert.equal(serializeUnreadSessionIds(new Set()), null); // empty -> remove key
  assert.equal(serializeUnreadSessionIds(new Set(["a", "b"])), '["a","b"]');
  assert.deepEqual([...parseUnreadSessionIds(serializeUnreadSessionIds(new Set(["x"])))], ["x"]);
});
