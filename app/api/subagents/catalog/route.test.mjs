import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-subagent-catalog-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

test("catalog route lists project and user agents for an allowed cwd", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-catalog-"));
  allowFileRoot(cwd);
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
  await writeFile(join(cwd, ".pi", "agents", "scout.md"), "---\nname: scout\ndescription: Project scout\ntools: read\n---\nGo look.\n");
  await mkdir(join(testAgentDir, "agents"), { recursive: true });
  await writeFile(join(testAgentDir, "agents", "planner.md"), "---\nname: planner\ndescription: Global planner\n---\nPlan.\n");

  const response = await GET(new Request(`http://localhost/api/subagents/catalog?cwd=${encodeURIComponent(cwd)}`));
  const body = await response.json();
  assert.equal(response.status, 200);
  const scout = body.agents.find((agent) => agent.name === "scout");
  assert.equal(scout.source, "project");
  assert.deepEqual(scout.tools, ["read"]);
  const planner = body.agents.find((agent) => agent.name === "planner");
  assert.equal(planner.source, "user");
});

test("catalog route rejects missing and disallowed cwds", async () => {
  let response = await GET(new Request("http://localhost/api/subagents/catalog"));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Valid cwd required" });

  response = await GET(new Request(`http://localhost/api/subagents/catalog?cwd=${encodeURIComponent("/nonexistent/pi-web")}`));
  assert.equal(response.status, 400);
});

test("catalog route returns 403 for an existing but unallowed cwd", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-catalog-unallowed-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const response = await GET(new Request(`http://localhost/api/subagents/catalog?cwd=${encodeURIComponent(cwd)}`));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Access denied" });
});
