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

const MINUTE = 60_000;

// A page renews its selected session whether or not it holds the event stream: each renewal
// resets the session's one idle countdown, and the reply says what is under way there, so a
// hidden page lets go of an idle stream and opens it again on activity (#1283).
test("a lease renewal resets the idle countdown and reports what is under way, without starting a wrapper", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-agent-lease-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const previousTimeout = process.env.PI_WEB_IDLE_TIMEOUT_MS;
  process.env.PI_CODING_AGENT_DIR = dir;
  delete process.env.PI_WEB_IDLE_TIMEOUT_MS;
  let session;
  t.after(async () => {
    await session?.shutdown();
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    if (previousTimeout === undefined) delete process.env.PI_WEB_IDLE_TIMEOUT_MS;
    else process.env.PI_WEB_IDLE_TIMEOUT_MS = previousTimeout;
    await rm(dir, { recursive: true, force: true });
  });
  const cwd = join(dir, "project");
  await mkdir(cwd);
  await writeFile(join(dir, "settings.json"), "{}");

  const { getRpcSession, startRpcSession, SESSION_IDLE_TIMEOUT_MS } = await jiti.import("../../../lib/rpc-manager.ts");
  const { hasActiveSessionLivenessProvider, listRegisteredSessionLivenessProviders } = await jiti.import("../../../lib/session-liveness.ts");
  const { POST } = await jiti.import("./[id]/lease/route.ts");
  const started = await startRpcSession("__new__agent-lease", "", cwd, {});
  session = started.session;
  const id = started.realSessionId;

  // Only the wrapper's own clock moves from here on; its armed timers are real and long.
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const idle = () => session.getDebugSnapshot().idle;
  const lease = async (sessionId) => {
    const response = await POST(
      new Request(`http://localhost/api/agent/${encodeURIComponent(sessionId)}/lease`, { method: "POST" }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    return { status: response.status, body: await response.json() };
  };
  const providersBefore = listRegisteredSessionLivenessProviders();

  assert.equal(SESSION_IDLE_TIMEOUT_MS, 10 * MINUTE);
  const armed = idle();
  assert.notEqual(armed.nextCheckAt, null);
  const commandBefore = session.getDebugSnapshot().lastCommand;
  now += 7 * MINUTE;
  const renewed = await lease(id);
  assert.equal(renewed.status, 200);
  assert.deepEqual(renewed.body, { success: true, running: false, awaitingInput: false, subagentsActive: false });
  assert.deepEqual(
    { lastResetAt: idle().lastResetAt, nextCheckAt: idle().nextCheckAt },
    { lastResetAt: now, nextCheckAt: now + SESSION_IDLE_TIMEOUT_MS },
    "the countdown starts over at the full timeout",
  );
  assert.ok(idle().nextCheckAt > armed.nextCheckAt);
  assert.deepEqual(session.getDebugSnapshot().lastCommand, commandBefore, "a renewal is not a command");
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: id }), false, "pi-web keeps no lease of its own");
  assert.deepEqual(listRegisteredSessionLivenessProviders(), providersBefore);

  const unknown = "00000000-0000-4000-8000-000000000000";
  const missing = await lease(unknown);
  assert.equal(missing.status, 200);
  assert.deepEqual(missing.body, { success: true, running: false, awaitingInput: false, subagentsActive: false });
  assert.equal(getRpcSession(unknown), undefined, "a renewal never starts a wrapper");

  // Stop's forced deadline stays put: a bash command abort_bash cannot stop.
  Object.defineProperty(session.inner, "isBashRunning", { configurable: true, get: () => true });
  session.inner.abortBash = () => {};
  t.after(() => { delete session.inner.isBashRunning; });
  await session.send({ type: "abort_bash" });
  const forced = idle();
  assert.equal(forced.forcedByStop, true);
  now += 3 * MINUTE;
  const running = await lease(id);
  assert.equal(running.body.running, true);
  assert.deepEqual(idle(), forced, "a renewal does not push back Stop's forced deadline");
  delete session.inner.isBashRunning;

  // A closing wrapper is not revived: no new countdown on it.
  now += MINUTE;
  const beforeClose = idle().lastResetAt;
  const closing = session.shutdown();
  assert.equal(session.isAlive(), false);
  const closed = await lease(id);
  assert.deepEqual(closed.body, { success: true, running: false, awaitingInput: false, subagentsActive: false });
  assert.equal(idle().lastResetAt, beforeClose, "no timer armed on a closing wrapper");
  await closing;
  assert.equal(idle().nextCheckAt, null);
  assert.equal(getRpcSession(id), undefined, "and nothing started in its place");
});
