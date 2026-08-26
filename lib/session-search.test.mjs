import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  buildSessionMatcher,
  buildSnippet,
  parseSessionSearchQuery,
  searchableSegments,
  searchSessionContents,
  DEFAULT_SESSION_SEARCH_ROLES,
  MAX_RESULT_SESSIONS,
} = await createJiti(import.meta.url).import("./session-search.ts");

function messageEntry(id, message, timestamp = "2026-01-01T00:00:00.000Z") {
  return { type: "message", id, parentId: null, timestamp, message };
}

async function writeSessionFile(dir, name, entries) {
  const path = join(dir, name);
  const lines = entries.map((entry) => JSON.stringify(entry));
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

function sessionInfo(path, id, overrides = {}) {
  return {
    path,
    id,
    cwd: "/repo/app",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-02T00:00:00.000Z",
    messageCount: 2,
    firstMessage: "first",
    projectKey: "/repo/app",
    ...overrides,
  };
}

test("substring matching is case-insensitive by default and returns every occurrence", () => {
  const matcher = buildSessionMatcher("Freshness", "substring", false);
  assert.deepEqual(matcher.find("freshness and FRESHNESS", 10), [
    { start: 0, end: 9 },
    { start: 14, end: 23 },
  ]);
  assert.deepEqual(buildSessionMatcher("Freshness", "substring", true).find("freshness", 10), []);
});

test("words mode requires every term in the same segment and regex mode uses the pattern", () => {
  const words = buildSessionMatcher("zephyr board", "words", false);
  assert.equal(words.find("enable the zephyr board files", 10).length, 2);
  assert.deepEqual(words.find("zephyr only", 10), []);

  const regex = buildSessionMatcher("mcux-?harness", "regex", false);
  assert.equal(regex.find("mcuxharness and mcux-harness", 10).length, 2);
  assert.throws(() => buildSessionMatcher("([", "regex", false), SyntaxError);
});

test("empty regex matches advance instead of looping forever", () => {
  const matcher = buildSessionMatcher("a*", "regex", false);
  const found = matcher.find("bbb", 5);
  assert.ok(found.length > 0 && found.length <= 5);
});

test("snippets collapse whitespace, keep the match verbatim, and flag clipping", () => {
  const text = `${"x".repeat(300)}\n  needle  \n${"y".repeat(300)}`;
  const snippet = buildSnippet(text, { start: 303, end: 309 }, 40);
  assert.equal(snippet.match, "needle");
  assert.equal(snippet.clippedStart, true);
  assert.equal(snippet.clippedEnd, true);
  assert.doesNotMatch(snippet.prefix, /\n/);
  assert.doesNotMatch(snippet.suffix, /\n/);
});

test("segments cover user, assistant, thinking, tool, bash, and summary entries", () => {
  assert.deepEqual(
    searchableSegments(messageEntry("a", { role: "user", content: [{ type: "text", text: "hello" }] })),
    [{ role: "user", text: "hello" }],
  );

  const assistant = searchableSegments(messageEntry("b", {
    role: "assistant",
    content: [
      { type: "text", text: "answer" },
      { type: "thinking", thinking: "hidden reasoning" },
      { type: "toolCall", name: "bash", arguments: { command: "ls" } },
      { type: "image", data: "AAAA", mimeType: "image/png" },
    ],
  }));
  assert.deepEqual(assistant.map((segment) => segment.role), ["assistant", "thinking", "toolCall"]);
  assert.match(assistant[2].text, /bash \{"command":"ls"\}/);

  assert.deepEqual(
    searchableSegments(messageEntry("c", { role: "toolResult", toolName: "read", content: [{ type: "text", text: "file body" }] })),
    [{ role: "toolResult", tool: "read", text: "file body" }],
  );
  assert.deepEqual(
    searchableSegments(messageEntry("d", { role: "bashExecution", command: "git log", output: "commit" })),
    [{ role: "bash", text: "$ git log\ncommit" }],
  );
  assert.deepEqual(
    searchableSegments({ type: "compaction", id: "e", summary: "compacted" }),
    [{ role: "summary", text: "compacted" }],
  );
  assert.deepEqual(searchableSegments({ type: "label", id: "f", label: "x" }), []);
  assert.deepEqual(searchableSegments(null), []);
});

test("query parsing clamps limits and falls back to safe defaults", () => {
  const parsed = parseSessionSearchQuery(new URLSearchParams({
    q: "x".repeat(500),
    mode: "bogus",
    roles: "user,nonsense",
    limit: "9999",
    hits: "0",
    case: "1",
    projectKey: " /repo/app ",
  }));
  assert.equal(parsed.query.length, 200);
  assert.equal(parsed.mode, "substring");
  assert.deepEqual(parsed.roles, ["user"]);
  assert.equal(parsed.limit, MAX_RESULT_SESSIONS);
  assert.equal(parsed.hitsPerSession, 1);
  assert.equal(parsed.caseSensitive, true);
  assert.equal(parsed.projectKey, "/repo/app");

  const empty = parseSessionSearchQuery(new URLSearchParams());
  assert.deepEqual(empty.roles, DEFAULT_SESSION_SEARCH_ROLES);
  assert.equal(empty.projectKey, undefined);
});

test("searches session files newest first and reports match counts per session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-session-search-"));
  const older = await writeSessionFile(dir, "older.jsonl", [
    { type: "session", version: 3, id: "older", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/repo/app" },
    messageEntry("o1", { role: "user", content: "where is the needle" }),
    messageEntry("o2", { role: "assistant", content: [{ type: "text", text: "the needle is here" }] }),
  ]);
  const newer = await writeSessionFile(dir, "newer.jsonl", [
    { type: "session", version: 3, id: "newer", timestamp: "2026-02-01T00:00:00.000Z", cwd: "/repo/app" },
    messageEntry("n1", { role: "user", content: "needle again" }),
    "not json",
  ]);
  const other = await writeSessionFile(dir, "other.jsonl", [
    { type: "session", version: 3, id: "other", timestamp: "2026-02-01T00:00:00.000Z", cwd: "/other" },
    messageEntry("x1", { role: "user", content: "needle in another project" }),
  ]);

  const sessions = [
    sessionInfo(older, "older", { modified: "2026-01-01T00:00:00.000Z" }),
    sessionInfo(newer, "newer", { modified: "2026-02-01T00:00:00.000Z" }),
    sessionInfo(other, "other", { cwd: "/other", projectKey: "/other", modified: "2026-03-01T00:00:00.000Z" }),
    sessionInfo(join(dir, "missing.jsonl"), "gone"),
    sessionInfo("", "transient", { transient: true }),
  ];

  const all = await searchSessionContents({
    query: "needle",
    mode: "substring",
    caseSensitive: false,
    roles: ["user", "assistant"],
    limit: 20,
    hitsPerSession: 3,
    loadSessions: async () => sessions,
  });
  assert.deepEqual(all.results.map((result) => result.sessionId), ["other", "newer", "older"]);
  assert.equal(all.results[2].matchCount, 2);
  assert.equal(all.totalMatches, 4);
  assert.equal(all.stats.sessionsMatched, 3);
  assert.equal(all.stats.truncated, false);

  const scoped = await searchSessionContents({
    query: "needle",
    mode: "substring",
    caseSensitive: false,
    roles: ["user"],
    projectKey: "/repo/app",
    limit: 20,
    hitsPerSession: 3,
    loadSessions: async () => sessions,
  });
  assert.deepEqual(scoped.results.map((result) => result.sessionId), ["newer", "older"]);
  assert.equal(scoped.results[1].matchCount, 1);
});

test("returns nothing for a blank query and caps results by limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-session-search-limit-"));
  const sessions = [];
  for (let index = 0; index < 3; index += 1) {
    const path = await writeSessionFile(dir, `s${index}.jsonl`, [
      { type: "session", version: 3, id: `s${index}`, timestamp: "2026-01-01T00:00:00.000Z", cwd: "/repo/app" },
      messageEntry(`m${index}`, { role: "user", content: "needle" }),
    ]);
    sessions.push(sessionInfo(path, `s${index}`, { modified: `2026-01-0${index + 1}T00:00:00.000Z` }));
  }

  const blank = await searchSessionContents({
    query: "   ",
    mode: "substring",
    caseSensitive: false,
    roles: ["user"],
    limit: 20,
    hitsPerSession: 3,
    loadSessions: async () => sessions,
  });
  assert.deepEqual(blank.results, []);
  assert.equal(blank.stats.sessionsScanned, 0);

  const capped = await searchSessionContents({
    query: "needle",
    mode: "substring",
    caseSensitive: false,
    roles: ["user"],
    limit: 1,
    hitsPerSession: 3,
    loadSessions: async () => sessions,
  });
  assert.equal(capped.results.length, 1);
  assert.equal(capped.stats.sessionsMatched, 3);
  assert.equal(capped.stats.sessionsScanned, 3);
});

test("stops on the time budget and marks the response as truncated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-session-search-budget-"));
  const sessions = [];
  for (let index = 0; index < 3; index += 1) {
    const path = await writeSessionFile(dir, `b${index}.jsonl`, [
      { type: "session", version: 3, id: `b${index}`, timestamp: "2026-01-01T00:00:00.000Z", cwd: "/repo/app" },
      messageEntry(`m${index}`, { role: "user", content: "needle" }),
    ]);
    sessions.push(sessionInfo(path, `b${index}`, { modified: `2026-01-0${index + 1}T00:00:00.000Z` }));
  }

  let clock = 0;
  const outcome = await searchSessionContents({
    query: "needle",
    mode: "substring",
    caseSensitive: false,
    roles: ["user"],
    limit: 20,
    hitsPerSession: 3,
    loadSessions: async () => sessions,
    // First call is the start time, then each loop iteration burns 30s.
    now: () => (clock += 30_000),
  });
  assert.equal(outcome.stats.truncated, true);
  assert.ok(outcome.stats.sessionsScanned < sessions.length);
});
