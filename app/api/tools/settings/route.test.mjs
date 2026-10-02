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
  assert.deepEqual(await initial.json(), { isWindows, powerShellEnabled: false, codemode: "automatic", codemodeMode: { value: "on" }, codemodeInlineBudget: {} });

  const enabled = await put({ codemode: "always" });
  assert.equal(enabled.status, 200);
  assert.deepEqual(await enabled.json(), { isWindows, powerShellEnabled: false, codemode: "always", codemodeMode: { value: "on" }, codemodeInlineBudget: {} });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m", defaultTools: ["+codemode"] });

  const automatic = await put({ codemode: "automatic" });
  assert.deepEqual(await automatic.json(), { isWindows, powerShellEnabled: false, codemode: "automatic", codemodeMode: { value: "on" }, codemodeInlineBudget: {} });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m" });
});

test("saves the Code mode inline budget, and null gives sessions pi's default again", async () => {
  await writeFile(settingsPath, JSON.stringify({ defaultModel: "m", codemode: { mode: "on" } }));
  const saved = await put({ codemodeInlineBudget: 1000 });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { isWindows, powerShellEnabled: false, codemode: "automatic", codemodeMode: { value: "on" }, codemodeInlineBudget: { value: 1000 } });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m", codemode: { mode: "on", inlineBudget: 1000 } });

  const zero = await put({ codemodeInlineBudget: 0 });
  assert.deepEqual((await zero.json()).codemodeInlineBudget, { value: 0 });

  const reset = await put({ codemodeInlineBudget: null });
  assert.deepEqual((await reset.json()).codemodeInlineBudget, {});
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m", codemode: { mode: "on" } });

  // A codemode that is not an object is refused, not replaced.
  await writeFile(settingsPath, JSON.stringify({ codemode: "on" }));
  const refused = await put({ codemodeInlineBudget: 1000 });
  assert.equal(refused.status, 500);
  assert.match((await refused.json()).error, /codemode must be an object/);
  assert.equal(await readFile(settingsPath, "utf8"), JSON.stringify({ codemode: "on" }));
});

test("saves the Code mode mode, and \"on\" gives sessions pi's default again", async () => {
  await writeFile(settingsPath, JSON.stringify({ defaultModel: "m", codemode: { inlineBudget: 1000 } }));
  const only = await put({ codemodeMode: "only" });
  assert.equal(only.status, 200);
  assert.deepEqual(await only.json(), {
    isWindows,
    powerShellEnabled: false,
    codemode: "automatic",
    codemodeMode: { value: "only" },
    codemodeInlineBudget: { value: 1000 },
  });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m", codemode: { inlineBudget: 1000, mode: "only" } });

  const on = await put({ codemodeMode: "on" });
  assert.deepEqual((await on.json()).codemodeMode, { value: "on" });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m", codemode: { inlineBudget: 1000 } });

  // A value that is neither mode is reported as pi reads it.
  await writeFile(settingsPath, JSON.stringify({ codemode: { mode: "never" } }));
  assert.deepEqual((await (await GET()).json()).codemodeMode, { value: "on", invalid: '"never"' });

  // A codemode that is not an object is refused, not replaced.
  await writeFile(settingsPath, JSON.stringify({ codemode: "only" }));
  const refused = await put({ codemodeMode: "only" });
  assert.equal(refused.status, 500);
  assert.match((await refused.json()).error, /codemode must be an object/);
  assert.equal(await readFile(settingsPath, "utf8"), JSON.stringify({ codemode: "only" }));
});

test("rejects requests that do not name exactly one valid change, with a reason Settings › MCP translates", async () => {
  for (const body of [
    { codemode: "never" },
    { codemode: "always", enabled: true },
    { codemode: "always", codemodeInlineBudget: 1000 },
    { codemodeMode: "only", codemodeInlineBudget: 1000 },
    { codemodeMode: "off" },
    { codemodeMode: null },
    { codemodeMode: true },
    { codemodeInlineBudget: -1 },
    { codemodeInlineBudget: 1.5 },
    { codemodeInlineBudget: "3000" },
    { codemodeInlineBudget: 1_000_001 },
    { codemodeInlineBudget: true },
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
