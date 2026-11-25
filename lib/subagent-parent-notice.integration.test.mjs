import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-child-notice-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const wrappers = [];
  const streams = new AbortController();
  t.after(async () => {
    streams.abort();
    await Promise.all(wrappers.map((wrapper) => wrapper.shutdown()));
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
  const { startRpcSession } = await jiti.import("./rpc-manager.ts");
  const { SUBAGENT_META_TYPE } = await jiti.import("./subagents.ts");
  const { GET } = await jiti.import("../app/api/agent/[id]/events/route.ts");
  await mkdir(join(dir, "extensions"));
  await writeFile(join(dir, "extensions", "child-notice.ts"), [
    'export default function (pi) {',
    '  pi.on("session_start", (_event, ctx) => {',
    '    if (pi.getSessionName() !== "Delegated task") return ctx.ui.notify("parent barrier", "info");',
    '    ctx.ui.notify("child info", "info");',
    '    ctx.ui.notify("child warning", "warning");',
    '    ctx.ui.notify("child error", "error");',
    '  });',
    '  pi.on("session_shutdown", (_event, ctx) => {',
    '    if (pi.getSessionName() === "Delegated task") ctx.ui.notify("child shutdown", "warning");',
    '  });',
    '}',
  ].join("\n"));
  async function persist(manager) {
    const file = manager.getSessionFile();
    await writeFile(file, [manager.getHeader(), ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    return file;
  }
  async function open(id, file) {
    const { session } = await startRpcSession(id, file);
    wrappers.push(session);
    await session.waitUntilReady();
    return session;
  }
  async function stream(id) {
    const response = await GET(new Request("http://localhost/api/agent/" + id + "/events", {
      signal: streams.signal,
    }), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/event-stream/);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    return async (until) => {
      const events = [];
      for (;;) {
        const stop = buffer.indexOf("\n\n");
        if (stop < 0) {
          const { value, done } = await reader.read();
          assert.equal(done, false, "SSE ended before the expected event");
          buffer += value;
          continue;
        }
        const line = buffer.slice(0, stop);
        buffer = buffer.slice(stop + 2);
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6));
        events.push(event);
        if (until(event)) return events;
      }
    };
  }
  const parent = SessionManager.create(dir, join(dir, "sessions"));
  const parentPath = await persist(parent);
  const root = await open(parent.getSessionId(), parentPath);
  const rootStream = await stream(root.sessionId);
  await rootStream((event) => event.type === "connected");
  const flush = async () => {
    await root.send({ type: "reload" });
    return rootStream((event) => event.method === "notify" && event.message === "parent barrier");
  };
  async function child(runInBackground = true) {
    const manager = SessionManager.create(dir, join(dir, "sessions"), { parentSession: parentPath });
    manager.appendSessionInfo("Delegated task");
    manager.appendCustomEntry(SUBAGENT_META_TYPE, {
      version: 1, parentSessionId: root.sessionId, parentSessionPath: parentPath,
      runInBackground, profile: "notice-profile",
      resourceSnapshot: { version: 1, loadExtensions: true, loadSkills: false, appendSystemPrompt: [], tools: ["read"] },
    });
    manager.appendMessage({ role: "user", content: "Recorded task", timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Recorded answer" }], timestamp: Date.now() });
    const path = manager.getSessionFile();
    const sender = await open(manager.getSessionId(), path);
    assert.equal(sender.inner.sessionManager.getHeader()?.parentSession, parentPath);
    return sender;
  }
  return { child, flush, open, root, parentPath, SessionManager, SUBAGENT_META_TYPE };
}

const notices = (events) => events.filter((event) => event.type === "extension_ui_request"
  && event.method === "notify" && /child (info|warning|error|shutdown)$/.test(event.message));

for (const background of [true, false]) {
  test("the parent SSE receives UI-only notices from a " + (background ? "background" : "foreground") + " child session", async (t) => {
    const { child, flush, root, parentPath } = await fixture(t);
    const before = await readFile(parentPath, "utf8");
    const sender = await child(background);
    const events = await flush();
    assert.deepEqual(notices(events).map((event) => [event.notifyType, event.message]), [
      ["warning", "notice-profile (" + sender.sessionId + "): child warning"],
      ["error", "notice-profile (" + sender.sessionId + "): child error"],
    ]);
    assert.equal(root.isRunning(), false);
    assert.equal(events.some((event) => event.type === "agent_start" || event.type === "queue_update"), false);
    assert.equal(await readFile(parentPath, "utf8"), before);
  });
}

test("an SDK clone with copied subagent metadata cannot notify the original parent", async (t) => {
  const { child, flush, open, SessionManager, SUBAGENT_META_TYPE } = await fixture(t);
  const source = await child();
  await flush();
  const cloned = await source.send({ type: "clone" });
  assert.equal(cloned.cancelled, false);
  // The original child can still notify during the clone command's shutdown.
  await flush();
  const dir = dirname(source.sessionFile);
  const filename = (await readdir(dir)).find((name) => name.endsWith(cloned.newSessionId + ".jsonl"));
  assert.ok(filename);
  const cloneFile = join(dir, filename);
  const clone = SessionManager.open(cloneFile, undefined);
  assert.equal(clone.getHeader().parentSession, source.sessionFile);
  assert.notEqual(clone.getSessionId(), source.sessionId);
  assert.ok(clone.getEntries().some((entry) => entry.customType === SUBAGENT_META_TYPE));
  await open(clone.getSessionId(), cloneFile);
  assert.deepEqual(notices(await flush()), []);
});

test("a child evicted after an external SDK write can send a shutdown warning to the parent's SSE", async (t) => {
  const { child, flush, SessionManager } = await fixture(t);
  const sender = await child();
  await flush();
  const manager = SessionManager.open(sender.sessionFile, undefined);
  manager.appendSessionInfo("External SDK write");
  assert.match(await readFile(sender.sessionFile, "utf8"), /External SDK write/);
  assert.equal(sender.evictIfDiskAhead(), true);
  assert.deepEqual(notices(await flush()).map((event) => event.message), [
    "notice-profile (" + sender.sessionId + "): child shutdown",
  ]);
});
