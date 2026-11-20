import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-web-terminal-route-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");

test.after(() => rm(agentDir, { recursive: true, force: true }));

test("a deleted folder is refused with the typed cwd-missing body, not a 500 naming the OS error", async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "pi-web-terminal-route-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const gone = path.join(parent, "deleted-project");

  const response = await POST(new Request("http://localhost/api/terminal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: gone }),
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: `Directory does not exist: ${gone}`,
    reason: "cwd-missing",
    cwd: gone,
  });
});
