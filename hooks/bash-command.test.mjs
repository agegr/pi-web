import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

// A `!` command typed in the composer (`executeBash()`): its `user_bash`
// handlers may ask through a dialog, which reaches the page only through the
// session's event stream, and a handler that throws is one notice, the runner's.
// Beside a run, a result pi holds until the run ends shows in its own card,
// which goes with a session read started after the run's end; a second command
// waits, with pi's TUI notice.
const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(pathToFileURL(shimPath).href);
const { useAgentSession } = await jiti.import("./useAgentSession.ts");
const { clearDraft, getDraft } = await jiti.import("@/lib/draft-store");
const { deleteSessionViewSnapshot } = await jiti.import("@/lib/session-view-cache");

globalThis.document ??= Object.assign(new EventTarget(), { visibilityState: "visible" });
globalThis.window ??= new EventTarget();

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const settle = async () => { for (let index = 0; index < 10; index++) await new Promise((resolve) => setImmediate(resolve)); };

async function setup({ fresh }) {
  const sid = fresh ? "s1" : "A";
  const log = [];
  const sources = [];
  // Session reads answer at once, or wait for release() while `holdReads` is set
  // (a forced read never waits: it stands for the read the run's end starts).
  const server = { bash: Promise.withResolvers(), holdReads: false, held: [] };
  globalThis.EventSource = class {
    readyState = 0;
    onmessage = null;
    onerror = null;
    constructor(url) { this.url = url; sources.push(this); log.push("stream"); }
    close() { this.readyState = 2; }
    emit(event) {
      this.readyState = 1;
      this.onmessage?.({ data: JSON.stringify(event) });
    }
  };
  globalThis.fetch = async (requestUrl, init = {}) => {
    const url = requestUrl.replace("?systemPrompt=0", "");
    if (url.startsWith("/api/models")) return json({ models: {}, modelList: [] });
    if (url === "/api/agent/new") return json({ sessionId: sid });
    if (url.startsWith(`/api/sessions/${sid}?`)) {
      const forced = url.includes("force=1");
      log.push(forced ? "read:force" : "read");
      if (server.holdReads && !forced) {
        const release = Promise.withResolvers();
        server.held.push(release.resolve);
        await release.promise;
      }
      return json({ sessionId: sid, filePath: `/${sid}.jsonl`, leafId: null, tree: [], treeFormat: "summary", snapshotRevision: "r", context: { messages: [], entryIds: [], oldestEntryId: null, hasMore: false } });
    }
    if (url === `/api/sessions/${sid}/state`) return json({ running: false });
    if (url === `/api/agent/${sid}` && init.body) {
      const command = JSON.parse(init.body);
      log.push(command.type);
      if (command.type !== "bash") return json({ success: true, data: null });
      return server.bash.promise;
    }
    if (url === `/api/agent/${sid}`) return json({ running: false });
    return json({});
  };
  const hook = renderHook(useAgentSession, fresh
    ? { session: null, newSessionCwd: "/project", newSessionDraftKey: "new:draft", t: (key) => key }
    : { session: { id: "A", cwd: "/project", path: "/A.jsonl", name: "A" }, newSessionCwd: null, newSessionDraftKey: null, t: (key) => key });
  await settle();
  hook.flush();
  const connect = async () => {
    for (const source of sources) if (source.readyState === 0) source.emit({ type: "connected", sessionId: sid, isStreaming: false });
    await settle();
    hook.flush();
  };
  const emit = async (event) => {
    sources.filter((source) => source.readyState === 1).at(-1)?.emit(event);
    await settle();
    hook.flush();
  };
  const notices = () => hook.result.notices.map(({ type, message }) => [type, message]);
  const teardown = () => {
    hook.unmount();
    for (const source of sources) source.close();
    for (const key of ["A", "s1", "new:draft"]) clearDraft(key);
    for (const key of ["A", "s1"]) deleteSessionViewSnapshot(key);
  };
  const release = async () => {
    for (const resolve of server.held.splice(0)) resolve();
    await settle();
    hook.flush();
  };
  return { hook, sid, log, server, connect, emit, release, notices, teardown };
}

async function withSetup(options, body) {
  const originalError = console.error;
  console.error = () => {};
  const env = await setup(options);
  try {
    await body(env);
  } finally {
    console.error = originalError;
    env.teardown();
  }
}

test("a fresh composer's first ! command opens the session's stream before it runs, for a handler's dialog", async () => {
  await withSetup({ fresh: true }, async (env) => {
    const sending = env.hook.result.handleSend("!ask ls");
    await settle();
    assert.deepEqual(env.log, ["stream"], "the command waits for the stream");
    await env.connect();
    assert.deepEqual(env.log, ["stream", "bash"]);
    env.server.bash.resolve(json({ success: true, data: { output: "", exitCode: 0 } }));
    await sending;
  });
});

for (const fresh of [true, false]) {
  test(`a user_bash handler that throws shows the runner's error once (${fresh ? "fresh composer" : "selected session"})`, async () => {
    await withSetup({ fresh }, async (env) => {
      await env.connect();
      const sending = env.hook.result.handleSend("!throw a");
      await settle();
      await env.connect();
      await env.emit({ type: "extension_error", extensionPath: "/ext/ub.js", event: "user_bash", error: "hook exploded" });
      env.server.bash.resolve(json({ error: "hook exploded", code: "extension_reported" }, 500));
      await sending;
      await settle();
      env.hook.flush();
      assert.deepEqual(env.notices(), [["error", "hook exploded"]]);
      assert.equal(getDraft(fresh ? "new:draft" : env.sid)?.value, "!throw a", "the command is back in the composer");
    });
  });
}

test("a ! result held for the run's end leaves with a read started after the run, not one joined from agent_end", async () => {
  await withSetup({ fresh: false }, async (env) => {
    await env.connect();
    await env.hook.result.handleSend("first");
    await env.emit({ type: "agent_start" });
    const sending = env.hook.result.handleSend("!echo MARK");
    await settle();
    env.server.bash.resolve(json({ success: true, data: { output: "MARK\n", exitCode: 0 } }));
    await sending;
    await settle();
    env.hook.flush();
    assert.equal(env.hook.result.pendingBash?.result?.output, "MARK\n", "the card shows the result until the run ends");

    // agent_end's read is slow; prompt_done would join it.
    env.server.holdReads = true;
    await env.emit({ type: "agent_end" });
    await env.emit({ type: "agent_settled" });
    await env.emit({ type: "prompt_done" });
    await settle();
    env.hook.flush();
    assert.equal(env.hook.result.agentRunning, false);
    assert.equal(env.hook.result.pendingBash, null, "the run's end reads afresh, and the card goes");
    assert.equal(env.log.at(-1), "read:force");
    await env.release();
    assert.equal(env.hook.result.pendingBash, null);
  });
});

test("a second ! command while one runs comes back with pi's notice", async () => {
  await withSetup({ fresh: false }, async (env) => {
    await env.connect();
    const first = env.hook.result.handleSend("!sleep 5");
    await settle();
    await env.hook.result.handleSend("!ls");
    env.hook.flush();
    assert.deepEqual(env.notices(), [["warning", "chat.bashAlreadyRunning"]]);
    assert.equal(getDraft(env.sid)?.value, "!ls");
    assert.deepEqual(env.log.filter((entry) => entry === "bash"), ["bash"]);
    env.server.bash.resolve(json({ success: true, data: { output: "", exitCode: 0 } }));
    await first;
  });
});
