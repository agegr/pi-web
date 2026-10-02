import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-web-tool-settings-route-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");

const settingsPath = path.join(agentDir, "settings.json");
const isWindows = process.platform === "win32";

function put(body, headers = { host: "localhost", "Content-Type": "application/json" }) {
  return PUT(new Request("http://localhost/api/tools/settings", {
    method: "PUT",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

test("reports and switches Code mode on every platform", async () => {
  await writeFile(settingsPath, JSON.stringify({ defaultModel: "m" }));
  const initial = await GET();
  assert.equal(initial.status, 200);
  assert.deepEqual(await initial.json(), { isWindows, powerShellEnabled: false, codemode: "automatic" });

  const enabled = await put({ codemode: "always" });
  assert.equal(enabled.status, 200);
  assert.deepEqual(await enabled.json(), { isWindows, powerShellEnabled: false, codemode: "always" });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m", defaultTools: ["+codemode"] });

  const automatic = await put({ codemode: "automatic" });
  assert.deepEqual(await automatic.json(), { isWindows, powerShellEnabled: false, codemode: "automatic" });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m" });
});

test("rejects requests that do not name exactly one valid change, with a reason Settings › MCP translates", async () => {
  for (const body of [
    { codemode: "never" },
    { codemode: "always", enabled: true },
    {},
    [],
    "{ not json",
  ]) {
    const response = await put(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json()).reason, "invalid-request", JSON.stringify(body));
  }
  const plain = await put({ codemode: "always" }, { host: "localhost", "Content-Type": "text/plain" });
  assert.deepEqual([plain.status, await plain.json()], [415, { error: "Content-Type must be application/json", reason: "content-type" }]);
  const foreign = await put({ codemode: "always" }, { host: "localhost", origin: "https://evil.example", "Content-Type": "application/json" });
  assert.deepEqual([foreign.status, await foreign.json()], [403, { error: "Untrusted API request", reason: "request-denied" }]);
});

test("keeps the PowerShell switch Windows-only", { skip: isWindows }, async () => {
  const response = await put({ enabled: true });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).reason, "invalid-request");
});

test("reports a settings file it cannot parse instead of overwriting it", async () => {
  await writeFile(settingsPath, "{ not json");
  const read = await GET();
  assert.equal(read.status, 500);
  assert.equal((await read.json()).reason, "internal");
  const write = await put({ codemode: "always" });
  assert.equal(write.status, 500);
  const refusal = await write.json();
  // The panel shows the diagnostic of an internal failure.
  assert.equal(refusal.reason, "internal");
  assert.match(refusal.error, /JSON/);
  assert.equal(await readFile(settingsPath, "utf8"), "{ not json");
});
