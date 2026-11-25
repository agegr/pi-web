import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// Real persisted sessions and an SDK-loaded extension; no provider or model turn is needed.
test("a child extension's warnings and errors also reach its live parent, as UI events only", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-child-notice-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const wrappers = [];
  t.after(async () => {
    await Promise.all(wrappers.map((wrapper) => wrapper.shutdown()));
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const jiti = createJiti(import.meta.url);
  const { startRpcSession } = await jiti.import("./rpc-manager.ts");
  const { SUBAGENT_META_TYPE } = await jiti.import("./subagents.ts");
  await mkdir(join(dir, "extensions"));
  await writeFile(join(dir, "extensions", "child-notice.ts"),     `export default function (pi) {
      pi.on("session_start", (_event, ctx) => {
        if (pi.getSessionName() !== "Delegated task") return;
        ctx.ui.notify("child info", "info");
        ctx.ui.notify("child warning", "warning");
        ctx.ui.notify("child error", "error");
      });
    }`);
  async function persist(manager) {
    const file = manager.getSessionFile();
    await writeFile(file, [manager.getHeader(), ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    return file;
  }
  async function open(manager, file) {
    const { session } = await startRpcSession(manager.getSessionId(), file);
    wrappers.push(session);
    await session.waitUntilReady();
    return session;
  }
  const parent = SessionManager.create(dir, join(dir, "sessions"));
  const parentPath = await persist(parent);
  const parentWrapper = await open(parent, parentPath);
  const parentEvents = [];
  parentWrapper.onEvent((event) => parentEvents.push(event));
  const entriesBefore = parentWrapper.inner.sessionManager.getEntries();
  const fileBefore = await readFile(parentPath, "utf8");

  const child = SessionManager.create(dir, join(dir, "sessions"), parentPath);
  child.appendSessionInfo("Delegated task");
  child.appendCustomEntry(SUBAGENT_META_TYPE, {
    version: 1, parentSessionId: parent.getSessionId(), parentSessionPath: parentPath,
    runInBackground: true, profile: "notice-profile",
    resourceSnapshot: { version: 1, loadExtensions: true, loadSkills: false, appendSystemPrompt: [], tools: ["read"] },
  });
  const childWrapper = await open(child, await persist(child));
  const childEvents = [];
  childWrapper.onEvent((event) => childEvents.push(event));
  parentEvents.length = 0;
  await childWrapper.send({ type: "reload" });
  const notices = (events) => events.filter((event) => event.type === "extension_ui_request"
    && event.method === "notify" && /child (info|warning|error)$/.test(event.message));
  assert.deepEqual(notices(childEvents).map((event) => event.notifyType), ["info", "warning", "error"]);
  assert.deepEqual(notices(parentEvents).map((event) => event.notifyType), ["warning", "error"]);
  for (const [index, notice] of notices(parentEvents).entries()) {
    assert.ok(notice.message.includes("notice-profile"));
    assert.ok(notice.message.includes(child.getSessionId()));
    assert.ok(notice.message.endsWith(notices(childEvents)[index + 1].message));
  }
  assert.deepEqual(parentEvents, notices(parentEvents));
  assert.equal(parentWrapper.isRunning(), false);
  assert.deepEqual(parentWrapper.inner.sessionManager.getEntries(), entriesBefore);
  assert.equal(await readFile(parentPath, "utf8"), fileBefore);
});