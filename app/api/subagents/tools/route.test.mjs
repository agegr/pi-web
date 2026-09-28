import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-subagent-tools-global-"));
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

test("tools route lists the builtin tools plus extension-registered tools", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-tools-"));
  allowFileRoot(cwd);
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(testAgentDir, "extensions"), { recursive: true });
  await writeFile(
    join(testAgentDir, "extensions", "fixture-tool.ts"),
    [
      "export default function (pi) {",
      "  pi.registerTool({",
      "    name: 'fixture_search',",
      "    label: 'Fixture search',",
      "    description: 'Search a fixture.',",
      "    parameters: { type: 'object', properties: {} },",
      "  });",
      "}",
    ].join("\n"),
  );

  const response = await GET(new Request(`http://localhost/api/subagents/tools?cwd=${encodeURIComponent(cwd)}`));
  const body = await response.json();
  assert.equal(response.status, 200);
  const names = body.tools.map((tool) => tool.name);
  for (const builtin of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
    assert.ok(names.includes(builtin), `expected builtin ${builtin}`);
  }
  const fixture = body.tools.find((tool) => tool.name === "fixture_search");
  assert.equal(fixture.source, "extension");
  assert.equal(fixture.description, "Search a fixture.");
  assert.equal(body.tools.find((tool) => tool.name === "read").source, "builtin");
});

test("tools route rejects missing and disallowed cwds", async () => {
  let response = await GET(new Request("http://localhost/api/subagents/tools"));
  assert.equal(response.status, 400);

  response = await GET(new Request(`http://localhost/api/subagents/tools?cwd=${encodeURIComponent("/nonexistent/pi-web")}`));
  assert.equal(response.status, 400);
});

test("tools route returns 403 for an existing but unallowed cwd", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-tools-unallowed-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const response = await GET(new Request(`http://localhost/api/subagents/tools?cwd=${encodeURIComponent(cwd)}`));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Access denied" });
});

test("tools route caches per cwd and evicts beyond the entry bound", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-tools-bounded-"));
  allowFileRoot(cwd);
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const routeSource = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /TOOLS_CACHE_MAX_ENTRIES = 32/);
  assert.match(routeSource, /toolsCache\.delete\(cwd\)/);
  assert.match(routeSource, /toolsCache\.size > TOOLS_CACHE_MAX_ENTRIES/);

  // A second request for the same cwd is served from the cache, so no new entry is added.
  const first = await GET(new Request(`http://localhost/api/subagents/tools?cwd=${encodeURIComponent(cwd)}`));
  const second = await GET(new Request(`http://localhost/api/subagents/tools?cwd=${encodeURIComponent(cwd)}`));
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await first.json(), await second.json());
});
