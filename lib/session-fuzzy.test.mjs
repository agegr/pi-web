import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { extractHashQuery, filterSessionEntries } = await jiti.import("./session-fuzzy.ts");

test("extractHashQuery finds a # token at start or after whitespace", () => {
  assert.deepEqual(extractHashQuery(""), null);
  assert.deepEqual(extractHashQuery("abc"), null);
  // A # mid-word is not a token (same rule as @).
  assert.deepEqual(extractHashQuery("读一下#provider"), null);
  // Markdown heading: the second # is not preceded by whitespace, and a
  // heading with a space after # closes the token.
  assert.deepEqual(extractHashQuery("## heading"), null);
  // Token at line start, after whitespace, bare #, and a mid-word after space.
  assert.deepEqual(extractHashQuery("#provider"), { start: 0, query: "provider" });
  assert.deepEqual(extractHashQuery("帮我 #provider"), { start: 3, query: "provider" });
  assert.deepEqual(extractHashQuery("#"), { start: 0, query: "" });
  assert.deepEqual(extractHashQuery("a #"), { start: 2, query: "" });
  // A single # heading-like run without space reads as a token whose query
  // starts with #, mirroring how @@ behaves for files.
  assert.deepEqual(extractHashQuery("##heading"), { start: 0, query: "#heading" });
});

test("a # query may hold several words once it has begun", () => {
  // The picker's search narrows with every word, so the token cannot end at
  // the first space (#1716).
  assert.deepEqual(extractHashQuery("#agent harness"), { start: 0, query: "agent harness" });
  assert.deepEqual(extractHashQuery("帮我 #agent harness "), { start: 3, query: "agent harness " });
  // A space right after the hashes is still a Markdown heading.
  assert.deepEqual(extractHashQuery("# agent harness"), null);
  assert.deepEqual(extractHashQuery("## agent"), null);
  assert.deepEqual(extractHashQuery("### agent"), null);
  assert.deepEqual(extractHashQuery("notes\n#### Title"), null);
  // A token never spans a line break.
  assert.deepEqual(extractHashQuery("#agent\nharness"), null);
});

function session(id, { name = "", firstMessage = "", cwd = "/p/pi-web", projectRoot, modified = "2026-11-14T00:00:00Z" } = {}) {
  return { id, name, firstMessage, cwd, projectRoot: projectRoot ?? cwd, created: modified, modified };
}

test("filterSessionEntries narrows with every word of the query", () => {
  const sessions = [
    session("both", { name: "agent harness 收口", cwd: "/p/pi-web" }),
    session("only-agent", { name: "agent 会话整理", cwd: "/p/pi-web" }),
    session("only-harness", { firstMessage: "harness 检查项", cwd: "/p/pi-web" }),
  ];
  // Words may match different fields, in any order, and extra space is ignored.
  assert.deepEqual(filterSessionEntries(sessions, "harness agent").map((s) => s.id), ["both"]);
  assert.deepEqual(filterSessionEntries(sessions, "  agent   harness  ").map((s) => s.id), ["both"]);
  // One word on its own still widens to both of its sessions.
  assert.deepEqual(filterSessionEntries(sessions, "agent").map((s) => s.id).sort(), ["both", "only-agent"]);
});

test("filterSessionEntries ranks by name, first message, then cwd", () => {
  const sessions = [
    session("b", { name: "provider sync", firstMessage: "帮我看下 provider 插件", cwd: "/p/pi-web" }),
    session("a", { name: "web", firstMessage: "provider 配置问题", cwd: "/p/agent-autoloop" }),
    session("c", { name: "其它", firstMessage: "随便聊聊", cwd: "/p/pi-web" }),
  ];
  const byName = filterSessionEntries(sessions, "provider");
  assert.equal(byName.length, 2); // c matches nothing
  assert.equal(byName[0].id, "b"); // name exact
  assert.equal(byName[1].id, "a"); // first message
});

test("filterSessionEntries matches cwd basename and limits results", () => {
  const sessions = [
    session("d", { cwd: "/p/pi-web" }),
    session("e", { cwd: "/p/agent-autoloop" }),
  ];
  const byCwd = filterSessionEntries(sessions, "autoloop");
  assert.equal(byCwd.length, 1);
  assert.equal(byCwd[0].id, "e");
  assert.equal(filterSessionEntries(sessions, "nope").length, 0);
});

test("filterSessionEntries keeps catalogue order for an empty query, capped at the limit", () => {
  const sessions = [session("new", { modified: "2026-11-14T00:00:00Z" }), session("old", { modified: "2026-11-13T00:00:00Z" })];
  const all = filterSessionEntries(sessions, "", 5);
  assert.deepEqual(all.map((s) => s.id), ["new", "old"]);
  assert.equal(filterSessionEntries(sessions, "", 1).length, 1);
});

test("filterSessionEntries ranks the composer's project first", () => {
  const sessions = [
    session("other-new", { cwd: "/p/other", modified: "2026-11-14T01:00:00Z", projectRoot: "/p/other" }),
    session("mine-old", { cwd: "/p/pi-web/sub", modified: "2026-11-13T00:00:00Z", projectRoot: "/p/pi-web" }),
    session("mine-new", { cwd: "/p/pi-web", modified: "2026-11-14T02:00:00Z", projectRoot: "/p/pi-web" }),
  ];
  // Empty query: the current project's sessions (by recency), then the rest.
  assert.deepEqual(filterSessionEntries(sessions, "", 5, "/p/pi-web").map((s) => s.id), ["mine-new", "mine-old", "other-new"]);
  // With a query, project membership outranks the score ladder.
  const byQuery = filterSessionEntries([
    session("a", { name: "zzz provider", cwd: "/p/other", projectRoot: "/p/other" }),
    session("b", { name: "provider", cwd: "/p/pi-web", projectRoot: "/p/pi-web" }),
    session("c", { name: "provider 配置", cwd: "/p/other", projectRoot: "/p/other" }),
  ], "provider", 5, "/p/pi-web");
  assert.equal(byQuery[0].id, "b");
  // No current root: score order as before.
  const noRoot = filterSessionEntries([
    session("a", { name: "zzz provider", cwd: "/p/other", projectRoot: "/p/other" }),
    session("b", { name: "provider", cwd: "/p/pi-web", projectRoot: "/p/pi-web" }),
  ], "provider", 5);
  assert.equal(noRoot[0].id, "b");
});
