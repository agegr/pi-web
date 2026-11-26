import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-web-queue-modes-route-"));
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
  return PUT(new Request("http://localhost/api/queue-modes", {
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
    inner: {
      settingsManager,
      agent: { steeringMode: settingsManager.getSteeringMode(), followUpMode: settingsManager.getFollowUpMode() },
    },
  };
}

const DEFAULTS = { steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" };

test("chooses pi's steeringMode and followUpMode in the global settings, keeping other keys", async (t) => {
  withSessions(t, []);
  await rm(settingsPath, { force: true });
  assert.deepEqual(await (await GET()).json(), DEFAULTS);
  // pi's default without a settings file: no file appears.
  assert.deepEqual(await (await put({ steeringMode: "one-at-a-time" })).json(), DEFAULTS);
  await assert.rejects(readFile(settingsPath, "utf8"), { code: "ENOENT" });

  await writeFile(settingsPath, JSON.stringify({ defaultModel: "m" }));
  const all = await put({ steeringMode: "all" });
  assert.equal(all.status, 200);
  assert.deepEqual(await all.json(), { ...DEFAULTS, steeringMode: "all" });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m", steeringMode: "all" });

  // One key per choice: the other stays as it was.
  assert.deepEqual(await (await put({ followUpMode: "all" })).json(), { steeringMode: "all", followUpMode: "all" });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m", steeringMode: "all", followUpMode: "all" });
  assert.deepEqual(await (await GET()).json(), { steeringMode: "all", followUpMode: "all" });

  // "one-at-a-time" is pi's default: the key goes.
  assert.deepEqual(await (await put({ steeringMode: "one-at-a-time" })).json(), { ...DEFAULTS, followUpMode: "all" });
  assert.deepEqual(await (await put({ followUpMode: "one-at-a-time" })).json(), DEFAULTS);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m" });
});

test("reads an older file's queueMode as pi does, and drops it on a steering choice", async (t) => {
  withSessions(t, []);
  await writeFile(settingsPath, JSON.stringify({ queueMode: "all" }));
  assert.deepEqual(await (await GET()).json(), { ...DEFAULTS, steeringMode: "all" });
  // A follow-up choice leaves the steering key alone, migrated or not.
  await put({ followUpMode: "all" });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { queueMode: "all", followUpMode: "all" });
  assert.deepEqual(await (await put({ steeringMode: "one-at-a-time" })).json(), { ...DEFAULTS, followUpMode: "all" });
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { followUpMode: "all" });
});

test("applies the choice to open sessions at once, a project's own setting still winning", async (t) => {
  await writeFile(settingsPath, JSON.stringify({}));
  const plain = await mkdtemp(path.join(os.tmpdir(), "pi-web-steering-plain-"));
  const pinned = await mkdtemp(path.join(os.tmpdir(), "pi-web-steering-pinned-"));
  t.after(() => Promise.all([plain, pinned].map((dir) => rm(dir, { recursive: true, force: true }))));
  await mkdir(path.join(pinned, ".pi"));
  await writeFile(path.join(pinned, ".pi", "settings.json"), JSON.stringify({ steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" }));

  const open = liveSession(plain);
  const project = liveSession(pinned);
  const closing = liveSession(plain, false);
  withSessions(t, [open, project, closing]);

  await put({ steeringMode: "all" });
  await put({ followUpMode: "all" });
  assert.deepEqual(open.inner.agent, { steeringMode: "all", followUpMode: "all" });
  assert.deepEqual(project.inner.agent, DEFAULTS, "the project's .pi/settings.json overrides the global choice");
  assert.deepEqual(closing.inner.agent, DEFAULTS, "a closing wrapper is left alone");

  await put({ steeringMode: "one-at-a-time" });
  assert.deepEqual(open.inner.agent, { ...DEFAULTS, followUpMode: "all" });
});

test("refuses an unknown mode, an empty choice, a foreign origin and a non-JSON body", async (t) => {
  withSessions(t, []);
  await writeFile(settingsPath, JSON.stringify({ defaultModel: "m" }));
  assert.equal((await put({ steeringMode: "some" })).status, 400);
  assert.equal((await put({ steeringMode: "all", followUpMode: "some" })).status, 400);
  assert.equal((await put({})).status, 400);
  assert.equal((await put("{")).status, 400);
  assert.equal((await put({ steeringMode: "all" }, { host: "localhost", "Content-Type": "text/plain" })).status, 415);
  assert.equal((await put({ steeringMode: "all" }, { host: "localhost", origin: "https://evil.example", "Content-Type": "application/json" })).status, 403);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultModel: "m" });
});
