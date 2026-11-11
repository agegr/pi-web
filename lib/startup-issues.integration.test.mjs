import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// startRpcSession() builds real SDK sessions here; keep them out of ~/.pi.
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const root = await mkdtemp(join(tmpdir(), "pi-web-startup-issues-"));
process.env.HOME = root;
process.env.USERPROFILE = root;

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { startRpcSession } = await jiti.import("./rpc-manager.ts");
const { STARTUP_ISSUE_LIMIT } = await jiti.import("./startup-issues.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  await rm(root, { recursive: true, force: true });
});

const MODELS_JSON = {
  providers: {
    local: {
      baseUrl: "http://127.0.0.1:9",
      apiKey: "dummy",
      api: "openai-completions",
      models: [{ id: "local-model", name: "Local", reasoning: false, contextWindow: 1000, maxTokens: 100 }],
    },
  },
};

async function agentDir({ settings = { defaultProvider: "local", defaultModel: "local-model" }, files = {}, modelsJson = MODELS_JSON } = {}) {
  const dir = await mkdtemp(join(root, "agent-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  await mkdir(join(dir, "extensions"), { recursive: true });
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, "extensions", name), content);
  if (modelsJson) await writeFile(join(dir, "models.json"), JSON.stringify(modelsJson));
  await writeFile(join(dir, "settings.json"), JSON.stringify(settings));
  return dir;
}

async function start(t, dir) {
  const { session } = await startRpcSession(`__new__${randomUUID()}`, "", dir, {});
  t.after(() => session.shutdown());
  await session.waitUntilReady();
  return session;
}

function listen(session) {
  const notices = [];
  const stop = session.onEvent((event) => {
    if (event.method === "notify") notices.push({ id: event.id, type: event.notifyType, message: event.message });
    if (event.type === "extension_error") notices.push({ type: "extension_error", message: event.error });
  });
  return { notices, stop };
}

test("a broken extension, a conflict and a throwing session_start reach every stream, under the same ids", async (t) => {
  const pkgA = join(root, "pkgs", "alpha", "index.js");
  const pkgB = join(root, "pkgs", "beta", "index.js");
  const tool = `export default function (pi) { pi.registerTool({ name: "dupe", label: "d", description: "d", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [] }) }); }`;
  for (const file of [pkgA, pkgB]) {
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, tool);
  }
  const dir = await agentDir({
    settings: { defaultProvider: "local", defaultModel: "local-model", extensions: [pkgA, pkgB] },
    files: {
      "broken.js": `export default function (pi) { pi.on("session_start", () => {`,
      "throws.js": `export default function (pi) { pi.on("session_start", () => { throw new Error("start boom"); }); }`,
    },
  });
  const session = await start(t, dir);

  const first = listen(session);
  first.stop();
  const messages = first.notices.map((notice) => `${notice.type}: ${notice.message}`);
  assert.equal(messages.length, 3, messages.join("\n"));
  assert.match(messages[0], /^error: Failed to load extension: .*broken\.js/s);
  assert.equal(messages[1], `error: ${pkgB}: Tool "dupe" conflicts with ${pkgA}`);
  assert.equal(messages[2], `error: Extension "${join(dir, "extensions", "throws.js")}" error: start boom`);

  // A second tab, or the same page reconnecting: the same notices, which the page shows once.
  const second = listen(session);
  assert.deepEqual(second.notices, first.notices);

  // /reload lists the extensions' issues again to the open stream; later streams get that list.
  await writeFile(join(dir, "extensions", "later.js"), `export default function () { throw new Error("later boom"); }`);
  second.notices.length = 0;
  await session.send({ type: "reload" });
  second.stop();
  const reloaded = second.notices.filter((notice) => notice.type !== "extension_error");
  assert.ok(reloaded.some((notice) => /later\.js: Failed to load extension: later boom$/.test(notice.message)), JSON.stringify(reloaded));
  const third = listen(session);
  third.stop();
  assert.deepEqual(third.notices, reloaded);
});

test("the server log names every broken extension, the page gets a bounded number of notices", async (t) => {
  const files = {};
  for (let i = 0; i < 12; i++) files[`broken${String(i).padStart(2, "0")}.js`] = `export default function (pi) { pi.on(`;
  const dir = await agentDir({ files });
  const logged = [];
  const warn = console.warn;
  console.warn = (...args) => { logged.push(args.join(" ")); };
  let session;
  try {
    session = await start(t, dir);
  } finally {
    console.warn = warn;
  }
  const named = new Set(logged.flatMap((line) => line.match(/broken\d\d/g) ?? []));
  assert.equal(named.size, 12);
  const { notices, stop } = listen(session);
  stop();
  assert.equal(notices.length, STARTUP_ISSUE_LIMIT);
  assert.equal(notices.at(-1).message, `${12 - (STARTUP_ISSUE_LIMIT - 1)} more startup issues: see the server log`);
});

test("a session with no model at all is not told of pi's /login", async (t) => {
  const dir = await agentDir({ settings: {}, modelsJson: null });
  const session = await start(t, dir);
  const { notices, stop } = listen(session);
  stop();
  assert.deepEqual(notices, []);
});
