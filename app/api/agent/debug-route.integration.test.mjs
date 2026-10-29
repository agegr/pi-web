import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
});

// The debug panel polls this every two seconds while it is open: reading must leave the
// session exactly as it was, and an id the server holds nothing for must stay that way.
test("the debug route only reads: no wrapper started, no liveness registered, the idle timer untouched", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-agent-debug-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  let session;
  t.after(async () => {
    await session?.shutdown();
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  const cwd = join(dir, "project");
  await mkdir(cwd);
  await writeFile(join(dir, "settings.json"), "{}");

  const { getRpcSession, startRpcSession } = await jiti.import("../../../lib/rpc-manager.ts");
  const {
    hasActiveSessionLivenessProvider,
    listRegisteredSessionLivenessProviders,
  } = await jiti.import("../../../lib/session-liveness.ts");
  const { GET } = await jiti.import("./debug/route.ts");
  const started = await startRpcSession("__new__agent-debug", "", cwd, {});
  session = started.session;
  const id = started.realSessionId;
  await session.waitUntilReady();

  const read = async (query) => {
    const response = await GET(new Request(`http://localhost/api/agent/debug${query}`));
    return { status: response.status, cacheControl: response.headers.get("Cache-Control"), text: await response.text() };
  };

  // An id the server holds nothing for.
  const unknown = "00000000-0000-4000-8000-000000000000";
  const providersBefore = listRegisteredSessionLivenessProviders();
  const missing = await read(`?session=${unknown}`);
  assert.equal(missing.status, 200);
  assert.equal(missing.cacheControl, "no-store");
  const missingBody = JSON.parse(missing.text);
  assert.equal(missingBody.session.sessionId, unknown);
  assert.equal(missingBody.session.wrapper, null);
  assert.equal(missingBody.session.starting, false);
  assert.equal(getRpcSession(unknown), undefined, "a debug read never starts a wrapper");
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: unknown }), false, "nor registers liveness");
  assert.deepEqual(listRegisteredSessionLivenessProviders(), providersBefore);

  // A live wrapper: its idle timer object, deadline and last command stay as they were.
  const sendCalls = [];
  const send = session.send.bind(session);
  session.send = (command) => {
    sendCalls.push(command.type);
    return send(command);
  };
  const before = session.getDebugSnapshot();
  const timerBefore = session.idleTimer;
  assert.equal(typeof before.idle.nextCheckAt, "number");

  const live = await read(`?session=${encodeURIComponent(id)}`);
  assert.equal(live.status, 200);
  assert.equal(live.cacheControl, "no-store");
  const body = JSON.parse(live.text);
  assert.equal(body.session.wrapper.sessionId, id);
  assert.equal(body.session.wrapper.state, "alive");
  assert.equal(body.session.wrapper.idle.nextCheckAt, before.idle.nextCheckAt);
  assert.ok(body.sessions.some((summary) => summary.sessionId === id && summary.state === "alive"));
  assert.ok(body.server.wrappers.alive >= 1);

  assert.deepEqual(sendCalls, [], "the route never sends a command");
  assert.ok(session.idleTimer === timerBefore, "the idle timer was neither cleared nor re-armed");
  assert.deepEqual(session.getDebugSnapshot().idle, before.idle);
  assert.deepEqual(session.getDebugSnapshot().lastCommand, before.lastCommand);
  assert.equal(session.getDebugSnapshot().eventListeners, before.eventListeners, "no stream was opened");
  assert.deepEqual(listRegisteredSessionLivenessProviders(), providersBefore);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: id }), false);

  // Counts, states and times only: neither the system prompt nor a path.
  const systemPrompt = session.inner.systemPrompt;
  assert.ok(systemPrompt.length > 20, "the session has a prompt to leak");
  assert.ok(!live.text.includes(systemPrompt));
  assert.ok(!live.text.includes(systemPrompt.slice(0, 40)));
  assert.ok(!live.text.includes(dir), "no path of the session's");

  // Without ?session=, or with one no session id is that long: the global layer only.
  assert.equal(JSON.parse((await read("")).text).session, null);
  assert.equal(JSON.parse((await read(`?session=${"x".repeat(513)}`)).text).session, null);
  assert.equal(JSON.parse((await read("?session=")).text).session, null);

  // The events route labels a stream with the page's id (an invalid one with none) and keeps
  // nothing alive for it: the page's lease renewals do that.
  const { GET: openEvents } = await jiti.import("./[id]/events/route.ts");
  const openStream = async (holder) => {
    const abortController = new AbortController();
    t.after(() => abortController.abort());
    const response = await openEvents(
      new Request(`http://localhost/api/agent/${encodeURIComponent(id)}/events?holder=${encodeURIComponent(holder)}`, {
        signal: abortController.signal,
      }),
      { params: Promise.resolve({ id }) },
    );
    const reader = response.body.getReader();
    await reader.read();
    assert.match(new TextDecoder().decode((await reader.read()).value), /"type":"connected"/);
    return abortController;
  };
  const labelled = await openStream("page-debug");
  const unlabelled = await openStream("not a holder!");
  const withStreams = JSON.parse((await read(`?session=${encodeURIComponent(id)}`)).text);
  assert.deepEqual(
    withStreams.session.eventStreams.map((stream) => stream.holder ?? "(none)").sort(),
    ["(none)", "page-debug"],
  );
  assert.ok(withStreams.session.eventStreams.every((stream) => typeof stream.connectedAt === "number"));
  assert.ok(withStreams.server.eventStreams.byHolder.some((row) => row.holder === "page-debug" && row.count === 1));
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: id }), false, "a stream registers no liveness");
  assert.deepEqual(listRegisteredSessionLivenessProviders(), providersBefore);
  labelled.abort();
  unlabelled.abort();
  assert.deepEqual(JSON.parse((await read(`?session=${encodeURIComponent(id)}`)).text).session.eventStreams, []);
});
