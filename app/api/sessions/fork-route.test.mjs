import assert from "node:assert/strict";
import { appendFileSync, readFileSync, unlinkSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const routeSource = await readFile(new URL("./[id]/fork/route.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST: forkSession } = await jiti.import("./[id]/fork/route.ts");
const { GET: getSessionList } = await jiti.import("./route.ts");
const {
  getSessionListVersion,
  invalidateSessionListCache,
  invalidateSessionPathCache,
  listAllSessions,
} = await jiti.import("../../../lib/session-reader.ts");
const { buildSessionTree } = await jiti.import("../../../lib/session-tree.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");

/** A scratch agent dir with one branched session: u1 → a1, then u1 → a2 (the file's leaf). */
async function scratchSession(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-fork-route-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousHome = process.env.HOME;
  const previousRegistry = globalThis.__piSessions;
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.HOME = join(dir, "home");
  invalidateSessionListCache();
  const manager = SessionManager.create(join(dir, "project"), join(dir, "sessions", "project"));
  const u1 = manager.appendMessage({ role: "user", content: "Fork me", timestamp: Date.now() });
  const a1 = manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "first" }], timestamp: Date.now() });
  manager.branch(u1);
  const a2 = manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "second" }], timestamp: Date.now() });
  const id = manager.getSessionId();
  const forked = [];
  t.after(async () => {
    globalThis.__piSessions = previousRegistry;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    for (const sessionId of [id, ...forked]) invalidateSessionPathCache(sessionId);
    invalidateSessionListCache();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, manager, id, path: manager.getSessionFile(), a1, a2, forked };
}

const JSON_HEADERS = { host: "localhost", "Content-Type": "application/json" };

function post(id, headers = JSON_HEADERS) {
  return forkSession(
    new Request(`http://localhost/api/sessions/${id}/fork`, { method: "POST", headers, body: "{}" }),
    { params: Promise.resolve({ id }) },
  );
}

function assistantTexts(path) {
  return readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    .filter((entry) => entry.type === "message" && entry.message.role === "assistant")
    .map((entry) => entry.message.content[0].text);
}

/** An open wrapper as the route sees it: alive, its file, its in-memory leaf. */
function fakeWrapper({ sessionFile, leafId, running, knownIds }) {
  return {
    isAlive: () => true,
    isRunning: () => running,
    isAwaitingInput: () => false,
    sessionFile,
    inner: { sessionManager: { getLeafId: () => leafId, getEntry: (entryId) => (knownIds.includes(entryId) ? { id: entryId } : undefined) } },
  };
}

test("forks an idle session on disk without starting it, and the copy is a row of its own", async (t) => {
  const source = await scratchSession(t);
  const versionBefore = getSessionListVersion();
  const response = await post(source.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  source.forked.push(body.sessionId);
  assert.notEqual(body.sessionId, source.id);
  assert.equal(body.session.id, body.sessionId);
  assert.deepEqual(body.session.relation, { kind: "fork", originSessionId: source.id });
  assert.equal(body.session.parentSessionId, source.id);
  assert.equal(body.session.cwd, join(source.dir, "project"));
  assert.equal(typeof body.session.projectKey, "string", "grouped like any listed session");
  assert.equal(body.session.firstMessage, "Fork me");
  // Named after the source's title plus a short random suffix, already in the row.
  assert.match(body.session.name, /^Fork me · [0-9a-f]{4}$/);
  assert.equal(SessionManager.open(source.path).getSessionName(), undefined, "the source keeps no name");
  assert.ok(getSessionListVersion() > versionBefore, "other windows hear of the copy");
  // The file's leaf branch, and no AgentSession was started for it.
  assert.deepEqual(assistantTexts(body.session.path), ["second"]);
  assert.equal(globalThis.__piSessions?.has(source.id) ?? false, false);

  const list = await (await getSessionList(new Request("http://localhost/api/sessions"))).json();
  const listed = list.sessions.find((session) => session.id === body.sessionId);
  assert.ok(listed, "the list has the copy");
  assert.equal(listed.modified, body.session.modified, "the row does not move when the list replaces it");
  assert.equal(listed.projectKey, body.session.projectKey);
  assert.equal(listed.name, body.session.name);
  assert.deepEqual(listed.relation, { kind: "fork", originSessionId: source.id });
  const { rows } = buildSessionTree({
    sessions: list.sessions,
    uiState: { version: 1, revision: 0, sessions: {}, projects: {} },
    runningIds: new Set(),
    awaitingIds: new Set(),
    unreadIds: new Set(),
    selectedSessionId: body.sessionId,
    currentProject: { key: body.session.projectKey, root: body.session.projectRoot },
    groupExpansion: {},
    moreShown: {},
    pinnedCollapsed: false,
  });
  assert.deepEqual(
    rows.filter((row) => row.kind === "session").map((row) => row.key).sort(),
    [`session:group:${body.sessionId}`, `session:group:${source.id}`].sort(),
  );
});

test("an open wrapper's leaf is the branch forked, unless the file moved past an idle wrapper", async (t) => {
  const source = await scratchSession(t);
  const knownIds = source.manager.getEntries().map((entry) => entry.id);
  globalThis.__piSessions = new Map([[source.id, fakeWrapper({ sessionFile: source.path, leafId: source.a1, running: true, knownIds })]]);
  const live = await (await post(source.id)).json();
  source.forked.push(live.sessionId);
  assert.deepEqual(assistantTexts(live.session.path), ["first"], "the branch the open session shows, also while it runs");

  // Another pi process appended to the file: an idle wrapper is behind it,
  // so the file's leaf is forked, as a page load would show it.
  appendFileSync(source.path, `${JSON.stringify({ type: "session_info", id: "ext00001", parentId: source.a2, timestamp: new Date().toISOString(), name: "Renamed in the CLI" })}\n`);
  globalThis.__piSessions = new Map([[source.id, fakeWrapper({ sessionFile: source.path, leafId: source.a1, running: false, knownIds })]]);
  const behind = await (await post(source.id)).json();
  source.forked.push(behind.sessionId);
  assert.deepEqual(assistantTexts(behind.session.path), ["second"]);
  assert.match(behind.session.name, /^Renamed in the CLI · [0-9a-f]{4}$/);
  assert.match(live.session.name, /^Fork me · [0-9a-f]{4}$/);
});

test("refusals: unknown session, unsaved wrapper, no JSON content type", async (t) => {
  const source = await scratchSession(t);
  const versionBefore = getSessionListVersion();
  const missing = await post("no-such-session");
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "not_found");
  assert.ok(getSessionListVersion() > versionBefore, "a stale row is dropped on the next load");

  globalThis.__piSessions = new Map([["transient", fakeWrapper({ sessionFile: join(source.dir, "sessions", "project", "unwritten.jsonl"), leafId: "u1", running: true, knownIds: [] })]]);
  const unsaved = await post("transient");
  assert.equal(unsaved.status, 409);
  assert.equal((await unsaved.json()).code, "unsaved");

  const plain = await post(source.id, { host: "localhost", "Content-Type": "text/plain" });
  assert.equal(plain.status, 415);
  assert.equal((await plain.json()).code, "request-denied");
});

test("a source deleted behind its cached path is not found, forgotten and dropped from the list", async (t) => {
  const source = await scratchSession(t);
  // The sidebar's list has cached every path; the pi CLI then deletes the file.
  assert.ok((await listAllSessions()).some((session) => session.id === source.id));
  assert.equal(globalThis.__piSessionPathCache?.has(source.id), true);
  unlinkSync(source.path);
  const versionBefore = getSessionListVersion();
  const response = await post(source.id);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "not_found");
  assert.equal(globalThis.__piSessionPathCache.has(source.id), false, "the dead path is not served again");
  assert.ok(getSessionListVersion() > versionBefore, "the next list load drops its row");
});

test("the route never starts, prompts or forks an AgentSession", () => {
  assert.doesNotMatch(routeSource, /startRpcSession|\.send\(|\.fork\(|\.prompt\(|shutdown\(/);
  assert.match(routeSource, /if \(!isApiRequestAllowed\(req\)\) return refusal\(403, "request-denied"/);
  assert.match(routeSource, /if \(!hasJsonContentType\(req\)\) return refusal\(415, "request-denied"/);
  assert.match(routeSource, /const fork = forkSessionBranch\(sourcePath, liveLeafId, sourceTitle\);\s*cacheSessionPath\(fork\.sessionId, fork\.path\);\s*invalidateSessionListCache\(\);/);
  // The source's title is the one await before the copy; the leaf is read after it.
  const title = routeSource.indexOf("const sourceTitle = await readForkSourceTitle(sourcePath);");
  const leaf = routeSource.indexOf("const wrapper = getRpcSession(id);");
  assert.ok(title >= 0 && title < leaf, "the title is read before the leaf");
  assert.doesNotMatch(routeSource.slice(leaf, routeSource.indexOf("const fork = forkSessionBranch(")), /await /);
  // The row is read once the name is written.
  assert.ok(routeSource.indexOf("await readSessionInfo(fork.path)") > routeSource.indexOf("const fork = forkSessionBranch("));
});
