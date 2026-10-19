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

test("status reads of a session's state leave out its system prompt (#1302)", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-agent-state-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  let session;
  t.after(async () => {
    await session?.shutdown();
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  // A project whose context file makes the prompt large, as the issue's ~350 KB replies were.
  const cwd = join(dir, "project");
  await mkdir(cwd);
  await writeFile(join(cwd, "AGENTS.md"), `# Notes\n\n${"- a project rule the agent must follow\n".repeat(8_000)}`);
  await writeFile(join(dir, "settings.json"), "{}");

  const { agentStatusUrl } = await jiti.import("../../../lib/agent-client.ts");
  const { startRpcSession } = await jiti.import("../../../lib/rpc-manager.ts");
  const { GET } = await jiti.import("./[id]/route.ts");
  const started = await startRpcSession("__new__agent-state", "", cwd, {});
  session = started.session;
  const realSessionId = started.realSessionId;

  const read = async (path) => {
    const response = await GET(new Request(`http://localhost${path}`), { params: Promise.resolve({ id: realSessionId }) });
    assert.equal(response.status, 200);
    const text = await response.text();
    return { bytes: Buffer.byteLength(text), body: JSON.parse(text) };
  };
  const full = await read(`/api/agent/${encodeURIComponent(realSessionId)}`);
  const status = await read(agentStatusUrl(realSessionId));
  t.diagnostic(`GET state: ${full.bytes} bytes; status read: ${status.bytes} bytes`);

  assert.match(full.body.state.systemPrompt, /a project rule the agent must follow/);
  assert.equal(status.body.running, true);
  assert.equal("systemPrompt" in status.body.state, false);
  // Everything else the polls read is still there, unchanged.
  const rest = { ...full.body.state };
  delete rest.systemPrompt;
  assert.deepEqual(status.body.state, rest);
  assert.ok(full.bytes > 300_000);
  assert.ok(status.bytes < 2_000);
});
