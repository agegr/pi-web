import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

// Paging upward in a session widens the loaded window beyond the server's
// default tail. Switching away and back while the session's revision is
// unchanged must keep the wider window — with `messages`, `entryIds`, and the
// pagination cursor staying aligned both in hook state and in the cached view.
const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(pathToFileURL(shimPath).href);
const { useAgentSession } = await jiti.import("./useAgentSession.ts");
const { deleteSessionViewSnapshot, getSessionViewSnapshot, setSessionViewSnapshot } = await jiti.import("@/lib/session-view-cache");

globalThis.document ??= Object.assign(new EventTarget(), { visibilityState: "visible" });
globalThis.window ??= new EventTarget();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const settle = async () => { for (let index = 0; index < 10; index++) await new Promise((resolve) => setImmediate(resolve)); };
const user = (text) => ({ role: "user", content: text, timestamp: 1 });
const assistant = (text) => ({ role: "assistant", content: [{ type: "text", text }], timestamp: 1 });

function setup() {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const sources = [];
  const server = {
    entries: [
      ["e1", user("one")],
      ["e2", assistant("two")],
      ["e3", user("three")],
      ["e4", assistant("four")],
    ],
    branchEntries: [
      ["b1", user("branch-one")],
      ["b2", assistant("branch-two")],
    ],
    leafChange: null,
  };

  const context = (slice, hasMore, turnsBefore) => ({
    messages: slice.map(([, message]) => message),
    entryIds: slice.map(([id]) => id),
    oldestEntryId: slice[0]?.[0] ?? null,
    hasMore,
    turnsBefore,
    thinkingLevel: "off",
    model: null,
  });

  globalThis.EventSource = class {
    readyState = 0;
    onmessage = null;
    onerror = null;
    constructor(url) { this.url = url; sources.push(this); }
    close() { this.readyState = 2; }
    emit(event) { this.readyState = 1; this.onmessage?.({ data: JSON.stringify(event) }); }
  };

  globalThis.fetch = async (requestUrl) => {
    const url = new URL(requestUrl, "http://pi.test");
    if (url.pathname.startsWith("/api/models")) return json({ models: {}, modelList: [] });
    if (url.pathname === "/api/sessions/A") {
      const start = Math.max(0, server.entries.length - 2);
      const ids = server.entries.map(([id]) => id).join(",");
      return json({
        sessionId: "A",
        filePath: "/A.jsonl",
        leafId: server.entries.at(-1)[0],
        tree: [],
        treeFormat: "summary",
        snapshotRevision: `r:${ids}`,
        context: context(server.entries.slice(start), start > 0, start > 0 ? 1 : 0),
      });
    }
    if (url.pathname === "/api/sessions/A/context") {
      const before = url.searchParams.get("before");
      if (before) {
        const end = server.entries.findIndex(([id]) => id === before);
        const start = Math.max(0, end - 2);
        return json({ context: context(server.entries.slice(start, end), start > 0, 0) });
      }
      return json({ context: context(server.branchEntries, false, 0) });
    }
    if (url.pathname === "/api/sessions/A/state") {
      return json({ running: false, state: { isStreaming: false, isPromptRunning: false } });
    }
    return json({ success: true, data: null });
  };

  const mount = async () => {
    const hook = renderHook(useAgentSession, {
      session: { id: "A", cwd: "/project", path: "/A.jsonl", name: "A" },
      newSessionCwd: null,
      newSessionDraftKey: null,
      t: (key) => key,
      onBranchDataChange: (_tree, _leaf, change) => { server.leafChange = change; },
    });
    const flush = async () => { await settle(); hook.flush(); };
    await flush();
    return { hook, flush };
  };

  const texts = (hook) => hook.result.messages.map((m) => (typeof m.content === "string" ? m.content : m.content[0]?.text));
  const cleanup = () => {
    for (const source of sources) source.close();
    mock.timers.reset();
    deleteSessionViewSnapshot("A");
  };

  return { server, mount, texts, cleanup };
}

test("paging upward survives a session switch without corrupting cached entry alignment", async () => {
  const env = setup();
  let first;
  let second;
  let third;
  try {
    first = await env.mount();
    assert.deepEqual(env.texts(first.hook), ["three", "four"]);
    assert.deepEqual(first.hook.result.entryIds, ["e3", "e4"]);
    assert.equal(first.hook.result.hasEarlierMessages, true);
    assert.equal(first.hook.result.earlierTurnCount, 1);

    await first.hook.result.loadContext("A", null, "e3");
    await first.flush();
    assert.deepEqual(env.texts(first.hook), ["one", "two", "three", "four"]);
    assert.deepEqual(first.hook.result.entryIds, ["e1", "e2", "e3", "e4"]);
    assert.equal(first.hook.result.hasEarlierMessages, false);

    // Switching away preserves the paged-in window in the view cache.
    first.hook.unmount();
    const afterFirstUnmount = getSessionViewSnapshot("A");
    assert.ok(afterFirstUnmount, "unmount keeps the paged-in snapshot");
    assert.deepEqual(afterFirstUnmount.entryIds, ["e1", "e2", "e3", "e4"]);
    assert.equal(afterFirstUnmount.messages.length, 4);
    assert.equal(afterFirstUnmount.oldestEntryId, "e1");
    assert.equal(afterFirstUnmount.hasMore, false);
    assert.equal(afterFirstUnmount.turnsBefore, 0);

    // Coming back runs a forced background read with the same revision; the
    // server only returns the default tail, so the cached snapshot must keep
    // its wider entryIds and cursor aligned with its messages.
    second = await env.mount();
    assert.deepEqual(env.texts(second.hook), ["one", "two", "three", "four"]);
    assert.deepEqual(second.hook.result.entryIds, ["e1", "e2", "e3", "e4"]);
    assert.equal(second.hook.result.hasEarlierMessages, false);

    const afterRefresh = getSessionViewSnapshot("A");
    assert.ok(afterRefresh, "background refresh keeps the snapshot");
    assert.equal(afterRefresh.messages.length, 4);
    assert.deepEqual(afterRefresh.entryIds, ["e1", "e2", "e3", "e4"]);
    assert.deepEqual(afterRefresh.loadedEntryIds, ["e1", "e2", "e3", "e4"]);
    assert.equal(afterRefresh.oldestEntryId, "e1");
    assert.equal(afterRefresh.hasMore, false);
    assert.equal(afterRefresh.turnsBefore, 0);

    // A second round-trip keeps the exact same aligned window.
    second.hook.unmount();
    third = await env.mount();
    assert.deepEqual(env.texts(third.hook), ["one", "two", "three", "four"]);
    assert.deepEqual(third.hook.result.entryIds, ["e1", "e2", "e3", "e4"]);
    assert.equal(third.hook.result.hasEarlierMessages, false);
    third.hook.unmount();
  } finally {
    first?.hook.unmount();
    second?.hook.unmount();
    third?.hook.unmount();
    env.cleanup();
  }
});

test("unchanged background refresh never overwrites a wider cached snapshot with tail entryIds", async () => {
  const env = setup();
  let mounted;
  try {
    // Seed a wider cached snapshot directly, matching a session whose wider
    // window was already saved before remounting.
    setSessionViewSnapshot({
      sessionId: "A",
      revision: "r:e1,e2,e3,e4",
      messages: [user("one"), assistant("two"), user("three"), assistant("four")],
      entryIds: ["e1", "e2", "e3", "e4"],
      leafId: "e4",
      oldestEntryId: "e1",
      hasMore: false,
      turnsBefore: 0,
      summaryTree: [],
      thinkingLevel: "off",
      model: null,
      loadedEntryIds: ["e1", "e2", "e3", "e4"],
    });

    mounted = await env.mount();
    const cached = getSessionViewSnapshot("A");
    assert.ok(cached);
    assert.equal(cached.messages.length, cached.entryIds.length);
    assert.deepEqual(cached.entryIds, ["e1", "e2", "e3", "e4"]);
    assert.equal(cached.oldestEntryId, "e1");
    assert.equal(cached.hasMore, false);
    assert.equal(cached.turnsBefore, 0);
  } finally {
    mounted?.hook.unmount();
    env.cleanup();
  }
});

test("a new server revision replaces the wider cached snapshot cleanly", async () => {
  const env = setup();
  let first;
  let second;
  try {
    first = await env.mount();
    await first.hook.result.loadContext("A", null, "e3");
    await first.flush();
    first.hook.unmount();
    assert.equal(getSessionViewSnapshot("A")?.entryIds.length, 4);

    // Server advances while the user was on another session.
    env.server.entries.push(["e5", user("five")], ["e6", assistant("six")]);
    second = await env.mount();
    assert.deepEqual(env.texts(second.hook), ["five", "six"]);
    assert.deepEqual(second.hook.result.entryIds, ["e5", "e6"]);
    const cached = getSessionViewSnapshot("A");
    assert.ok(cached);
    assert.equal(cached.messages.length, 2);
    assert.deepEqual(cached.entryIds, ["e5", "e6"]);
    assert.equal(cached.oldestEntryId, "e5");
    assert.equal(cached.hasMore, true);
  } finally {
    first?.hook.unmount();
    second?.hook.unmount();
    env.cleanup();
  }
});

test("switching to another branch without a full read drops the stale snapshot on unmount", async () => {
  const env = setup();
  let first;
  try {
    first = await env.mount();
    await env.server.leafChange("b2");
    await first.flush();
    assert.deepEqual(first.hook.result.entryIds, ["b1", "b2"]);
    first.hook.unmount();
    assert.equal(getSessionViewSnapshot("A"), null);
  } finally {
    first?.hook.unmount();
    env.cleanup();
  }
});
