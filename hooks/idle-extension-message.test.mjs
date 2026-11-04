import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

// An extension's sendMessage({ display: true }) while no run goes: the page
// reads the branch's newest entries and appends them after its window, keeping
// the pages the reader loaded above, instead of putting back the newest window.
const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(pathToFileURL(shimPath).href);
const { useAgentSession } = await jiti.import("./useAgentSession.ts");
const { deleteSessionViewSnapshot } = await jiti.import("@/lib/session-view-cache");

globalThis.document ??= Object.assign(new EventTarget(), { visibilityState: "visible" });
globalThis.window ??= new EventTarget();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const settle = async () => { for (let index = 0; index < 10; index++) await new Promise((resolve) => setImmediate(resolve)); };
const user = (text) => ({ role: "user", content: text, timestamp: 1 });
const assistant = (text) => ({ role: "assistant", content: [{ type: "text", text }], timestamp: 1 });
const custom = (text, display = true) => ({ role: "custom", customType: "watcher", content: text, display, timestamp: 2 });

async function setup({ hold = [] } = {}) {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const sources = [];
  // The branch as the live wrapper holds it; a full read answers its newest two
  // entries, a page the two before `before`, a tail read from the newest user or
  // assistant entry on. `hold` keeps a kind of read from answering.
  const server = {
    entries: [["e1", user("one")], ["e2", assistant("two")], ["e3", user("three")], ["e4", assistant("four")]],
    hold: new Set(hold),
    held: [],
    reads: { full: 0, page: 0, tail: 0 },
  };
  const context = (slice, hasMore) => ({
    messages: slice.map(([, message]) => message),
    entryIds: slice.map(([id]) => id),
    oldestEntryId: slice[0]?.[0] ?? null,
    hasMore,
    turnsBefore: 0,
    thinkingLevel: "off",
    model: null,
  });
  const answer = async (kind, body) => {
    server.reads[kind]++;
    // Snapshot the branch when the read is handled, as the server would.
    const response = json(body());
    if (server.hold.has(kind)) {
      const gate = Promise.withResolvers();
      server.held.push({ kind, gate });
      await gate.promise;
    }
    return response;
  };
  globalThis.EventSource = class {
    readyState = 0;
    onmessage = null;
    onerror = null;
    constructor(url) { this.url = url; sources.push(this); }
    close() { this.readyState = 2; }
    emit(event) { this.readyState = 1; this.onmessage?.({ data: JSON.stringify(event) }); }
  };
  globalThis.fetch = async (requestUrl, init = {}) => {
    const url = new URL(requestUrl, "http://pi.test");
    if (url.pathname.startsWith("/api/models")) return json({ models: {}, modelList: [] });
    if (url.pathname === "/api/sessions/A") {
      return answer("full", () => {
        const start = Math.max(0, server.entries.length - 2);
        const ids = server.entries.map(([id]) => id).join(",");
        return { sessionId: "A", filePath: "/A.jsonl", leafId: server.entries.at(-1)[0], tree: [], treeFormat: "summary", snapshotRevision: `r:${ids}`, context: context(server.entries.slice(start), start > 0) };
      });
    }
    if (url.pathname === "/api/sessions/A/context") {
      const before = url.searchParams.get("before");
      if (before) {
        return answer("page", () => {
          const end = server.entries.findIndex(([id]) => id === before);
          return { context: context(server.entries.slice(Math.max(0, end - 2), end), end > 2) };
        });
      }
      assert.equal(url.searchParams.get("tail"), "1");
      return answer("tail", () => {
        let start = server.entries.length - 1;
        while (start > 0 && !["user", "assistant"].includes(server.entries[start][1].role)) start--;
        return { context: context(server.entries.slice(start), start > 0) };
      });
    }
    if (url.pathname === "/api/sessions/A/state") return json({ running: false, state: { isStreaming: false, isPromptRunning: false } });
    if (url.pathname === "/api/agent/A" && init.body) return json({ success: true, data: null });
    return json({ running: false, state: { isStreaming: false, isPromptRunning: false } });
  };
  const hook = renderHook(useAgentSession, { session: { id: "A", cwd: "/project", path: "/A.jsonl", name: "A" }, newSessionCwd: null, newSessionDraftKey: null, t: (key) => key });
  const flush = async () => { await settle(); hook.flush(); };
  await flush();
  const connect = async () => {
    for (const source of sources) if (source.readyState === 0) source.emit({ type: "connected", sessionId: "A", isStreaming: false });
    await flush();
  };
  await connect();
  const emit = async (event) => {
    sources.filter((source) => source.readyState === 1).at(-1)?.emit(event);
    await flush();
  };
  // An extension's message: pi appends the entry, then sends its events.
  const post = async (id, message) => {
    server.entries.push([id, message]);
    await emit({ type: "message_start", message });
    await emit({ type: "message_end", message });
  };
  const release = async (kind) => {
    const index = server.held.findIndex((held) => held.kind === kind);
    server.held.splice(index, 1)[0].gate.resolve();
    await flush();
  };
  const texts = () => hook.result.messages.map((m) => (typeof m.content === "string" ? m.content : m.content[0]?.text));
  const teardown = () => {
    hook.unmount();
    for (const source of sources) source.close();
    mock.timers.reset();
    deleteSessionViewSnapshot("A");
  };
  return { hook, server, flush, connect, emit, post, release, texts, teardown };
}

test("an idle message appends after the window and keeps the pages loaded above", async () => {
  const env = await setup();
  try {
    assert.deepEqual(env.texts(), ["three", "four"]);
    await env.hook.result.loadContext("A", null, "e3");
    await env.flush();
    assert.deepEqual(env.texts(), ["one", "two", "three", "four"], "the reader paged up");
    const fullReads = env.server.reads.full;

    await env.post("c1", custom("Build finished"));
    assert.deepEqual(env.texts(), ["one", "two", "three", "four", "Build finished"]);
    assert.deepEqual(env.hook.result.entryIds, ["e1", "e2", "e3", "e4", "c1"], "entry ids stay parallel");
    assert.equal(env.server.reads.full, fullReads, "no full read put the newest window back");

    await env.post("c2", custom("hidden", false));
    assert.equal(env.server.reads.tail, 1, "a message pi does not show reads nothing");
    await env.post("c3", { ...custom("truthy"), display: 1 });
    assert.equal(env.server.reads.tail, 2, "any truthy display shows, as in pi");
    // The hidden one comes with it, as a full read holds it; the chat leaves it out.
    assert.deepEqual(env.texts().slice(-3), ["Build finished", "hidden", "truthy"]);
    assert.deepEqual(env.hook.result.entryIds.slice(-3), ["c1", "c2", "c3"]);
  } finally {
    env.teardown();
  }
});

test("a burst arriving while a read is out shares one more read after it", async () => {
  const env = await setup();
  try {
    env.server.hold.add("tail");
    await env.post("c1", custom("one"));
    await env.post("c2", custom("two"));
    await env.post("c3", custom("three"));
    assert.equal(env.server.held.length, 1, "one read out");
    env.server.hold.clear();
    await env.release("tail");
    await env.flush();
    assert.equal(env.server.reads.tail, 2, "the burst took one more read");
    assert.deepEqual(env.texts(), ["three", "four", "one", "two", "three"]);
  } finally {
    env.teardown();
  }
});

test("a full read under way when the message arrives is waited out, forced ones too", async () => {
  // The mount's forced read, answered before the message was written.
  const env = await setup({ hold: ["full"] });
  try {
    env.server.hold = new Set(["tail"]);
    assert.equal(env.server.held.length, 1);
    await env.post("c1", custom("Build finished"));
    assert.equal(env.server.reads.tail, 0, "the read waits for the full read under way");
    await env.release("full");
    assert.equal(env.server.reads.tail, 1);
    assert.deepEqual(env.texts(), ["three", "four"]);
    await env.release("tail");
    assert.deepEqual(env.texts(), ["three", "four", "Build finished"], "the full read's older answer did not take it away");
  } finally {
    env.teardown();
  }
});

test("a message written while a `!` command's read is out still shows", async () => {
  const env = await setup();
  try {
    // The command's own read is answered before the message, which lands while it is out.
    env.server.hold.add("full");
    const running = env.hook.result.handleSend("!ls");
    await env.flush();
    assert.equal(env.server.held.length, 1);
    env.server.hold = new Set(["tail"]);
    await env.post("c1", custom("Build finished"));
    await env.release("full");
    await running;
    await env.flush();
    assert.equal(env.server.reads.tail, 1, "read after the command's read");
    await env.release("tail");
    assert.deepEqual(env.texts(), ["three", "four", "Build finished"]);
  } finally {
    env.teardown();
  }
});

test("a run started while the read is out keeps its messages", async () => {
  const env = await setup();
  try {
    env.server.hold.add("tail");
    await env.post("c1", custom("Build finished"));
    await env.post("c2", custom("again"));
    const sending = env.hook.result.handleSend("hello");
    await env.flush();
    await env.connect();
    await sending;
    env.server.entries.push(["u1", user("hello")]);
    await env.emit({ type: "agent_start" });
    await env.emit({ type: "message_end", message: user("hello") });
    assert.deepEqual(env.texts(), ["three", "four", "hello"]);

    env.server.hold.clear();
    await env.release("tail");
    assert.deepEqual(env.texts(), ["three", "four", "hello"], "the read's answer is dropped while the run goes");
    assert.equal(env.server.reads.tail, 1, "and no read follows it");
    assert.equal(env.hook.result.agentRunning, true);
  } finally {
    env.teardown();
  }
});

test("a read that does not reach back to the window takes the full read", async () => {
  const env = await setup();
  try {
    // A user and an assistant entry the page never saw, then the message.
    env.server.entries.push(["u9", user("elsewhere")], ["a9", assistant("reply")]);
    const fullReads = env.server.reads.full;
    await env.post("c1", custom("Build finished"));
    assert.equal(env.server.reads.full, fullReads + 1);
    assert.deepEqual(env.texts(), ["reply", "Build finished"]);
  } finally {
    env.teardown();
  }
});
