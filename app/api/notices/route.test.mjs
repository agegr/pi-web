import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-web-notices-route-"));
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

function put(body, headers = { host: "localhost", "Content-Type": "application/json" }) {
  return PUT(new Request("http://localhost/api/notices", {
    method: "PUT",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

const ALL_OFF = { cacheMisses: false, cacheWarming: false, compactionCosts: false, reasoningDrops: false };

test("switches one of pi's notices in the global settings, keeping other keys", async () => {
  assert.deepEqual(await (await GET()).json(), { notices: ALL_OFF });
  // Off without a settings file is pi's default already: no file appears.
  assert.deepEqual(await (await put({ key: "cacheMisses", shown: false })).json(), { notices: ALL_OFF });
  await assert.rejects(readFile(settingsPath, "utf8"), { code: "ENOENT" });

  await writeFile(settingsPath, JSON.stringify({ defaultModel: "m" }));
  const on = await put({ key: "cacheMisses", shown: true });
  assert.equal(on.status, 200);
  assert.deepEqual(await on.json(), { notices: { ...ALL_OFF, cacheMisses: true } });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m", notices: { cacheMisses: true } });

  // As pi's setNotice(): only that key is written, off included.
  await put({ key: "reasoningDrops", shown: true });
  const off = await put({ key: "cacheMisses", shown: false });
  assert.deepEqual(await off.json(), { notices: { ...ALL_OFF, reasoningDrops: true } });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    defaultModel: "m",
    notices: { cacheMisses: false, reasoningDrops: true },
  });
});

test("reads and replaces the legacy showCacheMissNotices as pi migrates it", async () => {
  await writeFile(settingsPath, JSON.stringify({ showCacheMissNotices: true, notices: { cacheWarming: false } }));
  // The legacy switch fills every key, those already in notices win.
  assert.deepEqual(await (await GET()).json(), {
    notices: { cacheMisses: true, cacheWarming: false, compactionCosts: true, reasoningDrops: true },
  });
  await put({ key: "reasoningDrops", shown: false });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    notices: { cacheMisses: true, cacheWarming: false, compactionCosts: true, reasoningDrops: false },
  });
});

test("refuses an unknown key, what is not a boolean, a foreign origin and a non-JSON body", async () => {
  await writeFile(settingsPath, JSON.stringify({ defaultModel: "m" }));
  assert.equal((await put({ key: "cacheMisses", shown: "yes" })).status, 400);
  assert.equal((await put({ key: "showCacheMissNotices", shown: true })).status, 400);
  assert.equal((await put({ key: "toString", shown: true })).status, 400);
  assert.equal((await put("{")).status, 400);
  assert.equal((await put({ key: "cacheMisses", shown: true }, { host: "localhost", "Content-Type": "text/plain" })).status, 415);
  assert.equal((await put({ key: "cacheMisses", shown: true }, { host: "localhost", origin: "https://evil.example", "Content-Type": "application/json" })).status, 403);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m" });
});
