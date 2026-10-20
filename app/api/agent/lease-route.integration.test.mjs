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

// A page holds its selected session's lease whether or not it holds the event
// stream, and the reply says what is under way there: a hidden page lets go of
// an idle stream and opens it again on activity (#1283).
test("a lease keeps the session alive and reports what is under way, without starting a wrapper", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-agent-lease-"));
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
  const { hasActiveSessionLivenessProvider } = await jiti.import("../../../lib/session-liveness.ts");
  const { POST } = await jiti.import("./[id]/lease/route.ts");
  const started = await startRpcSession("__new__agent-lease", "", cwd, {});
  session = started.session;
  const id = started.realSessionId;

  const lease = async (sessionId, holder) => {
    const query = holder === undefined ? "" : `?holder=${encodeURIComponent(holder)}`;
    const response = await POST(
      new Request(`http://localhost/api/agent/${encodeURIComponent(sessionId)}/lease${query}`, { method: "POST" }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    return { status: response.status, body: await response.json() };
  };

  assert.equal((await lease(id)).status, 400, "a lease needs the page that holds it");
  assert.equal((await lease(id, "bad holder!")).status, 400);

  assert.equal(hasActiveSessionLivenessProvider({ sessionId: id }), false);
  const idle = await lease(id, "page-1");
  assert.equal(idle.status, 200);
  assert.deepEqual(idle.body, { success: true, running: false, awaitingInput: false, subagentsActive: false });
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: id }), true, "the idle wrapper is kept from being reaped");

  const unknown = "00000000-0000-4000-8000-000000000000";
  const missing = await lease(unknown, "page-1");
  assert.deepEqual(missing.body, { success: true, running: false, awaitingInput: false, subagentsActive: false });
  assert.equal(getRpcSession(unknown), undefined, "a lease never starts a wrapper");
});
