import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-web-steering-mode-route-"));
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
  return PUT(new Request("http://localhost/api/steering-mode", {
    method: "PUT",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

function withSessions(t, wrappers) {
  const previous = globalThis.__piSessions;
  globalThis.__piSessions = new Map(wrappers.map((wrapper, index) => [`s${index}`, wrapper]));
  t.after(() => { globalThis.__piSessions = previous; });
}

function liveSession(cwd, alive = true) {
  const settingsManager = SettingsManager.create(cwd, agentDir);
  return {
    isAlive: () => alive,
    inner: { settingsManager, agent: { steeringMode: settingsManager.getSteeringMode() } },
  };
}

test("chooses pi's steeringMode in the global settings, keeping other keys", async (t) => {
  withSessions(t, []);
  await rm(settingsPath, { force: true });
  assert.deepEqual(await (await GET()).json(), { mode: "one-at-a-time" });
  // pi's default without a settings file: no file appears.
  assert.deepEqual(await (await put({ mode: "one-at-a-time" })).json(), { mode: "one-at-a-time" });
  await assert.rejects(readFile(settingsPath, "utf8"), { code: "ENOENT" });

  await writeFile(settingsPath, JSON.stringify({ defaultModel: "m" }));
  const all = await put({ mode: "all" });
  assert.equal(all.status, 200);
  assert.deepEqual(await all.json(), { mode: "all" });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m", steeringMode: "all" });
  assert.deepEqual(await (await GET()).json(), { mode: "all" });

  // "one-at-a-time" is pi's default: the key goes.
  assert.deepEqual(await (await put({ mode: "one-at-a-time" })).json(), { mode: "one-at-a-time" });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m" });
});

test("reads an older file's queueMode as pi does, and drops it on a choice", async (t) => {
  withSessions(t, []);
  await writeFile(settingsPath, JSON.stringify({ queueMode: "all" }));
  assert.deepEqual(await (await GET()).json(), { mode: "all" });
  assert.deepEqual(await (await put({ mode: "one-at-a-time" })).json(), { mode: "one-at-a-time" });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {});
});

test("applies the choice to open sessions at once, a project's own setting still winning", async (t) => {
  await writeFile(settingsPath, JSON.stringify({}));
  const plain = await mkdtemp(path.join(os.tmpdir(), "pi-web-steering-plain-"));
  const pinned = await mkdtemp(path.join(os.tmpdir(), "pi-web-steering-pinned-"));
  t.after(() => Promise.all([plain, pinned].map((dir) => rm(dir, { recursive: true, force: true }))));
  await mkdir(path.join(pinned, ".pi"));
  await writeFile(path.join(pinned, ".pi", "settings.json"), JSON.stringify({ steeringMode: "one-at-a-time" }));

  const open = liveSession(plain);
  const project = liveSession(pinned);
  const closing = liveSession(plain, false);
  withSessions(t, [open, project, closing]);

  assert.deepEqual(await (await put({ mode: "all" })).json(), { mode: "all" });
  assert.equal(open.inner.agent.steeringMode, "all");
  assert.equal(project.inner.agent.steeringMode, "one-at-a-time", "the project's .pi/settings.json overrides the global choice");
  assert.equal(closing.inner.agent.steeringMode, "one-at-a-time", "a closing wrapper is left alone");

  await put({ mode: "one-at-a-time" });
  assert.equal(open.inner.agent.steeringMode, "one-at-a-time");
});

test("refuses an unknown mode, a foreign origin and a non-JSON body", async (t) => {
  withSessions(t, []);
  await writeFile(settingsPath, JSON.stringify({ defaultModel: "m" }));
  assert.equal((await put({ mode: "some" })).status, 400);
  assert.equal((await put("{")).status, 400);
  assert.equal((await put({ mode: "all" }, { host: "localhost", "Content-Type": "text/plain" })).status, 415);
  assert.equal((await put({ mode: "all" }, { host: "localhost", origin: "https://evil.example", "Content-Type": "application/json" })).status, 403);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m" });
});
