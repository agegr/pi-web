import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRuntime,
  ProjectTrustStore,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const { createSubagentController } = await createJiti(import.meta.url).import("./subagent-runtime.ts");
const { startRpcSession } = await createJiti(import.meta.url).import("./rpc-manager.ts");
const exec = promisify(execFile);

// A child takes the parent session's trust, as pi's `--approve` / `--no-approve` decide a
// run: the project settings of a folder never trusted stay unread, and an isolated run's
// throwaway worktree, which has no decision of its own, is trusted with its repository.
async function runChild(t, { trusted, isolation, loadExtensions }) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "pi-web-subagent-trust-")));
  const worktrees = `${dir}-worktrees`;
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.after(() => rm(worktrees, { recursive: true, force: true }));
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => { if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgentDir; });

  await mkdir(join(dir, "agents"));
  await writeFile(join(dir, "agents", "fixture.md"), [
    "---", "description: Trust fixture.", "tools: read", "load_skills: false", `load_extensions: ${loadExtensions}`, "max_turns: 1",
    "---", "Complete the assigned task.",
  ].join("\n"));
  await mkdir(join(dir, ".pi"));
  await writeFile(join(dir, ".pi", "settings.json"), JSON.stringify({ shellCommandPrefix: "echo project-prefix;" }));
  for (const args of [["init", "-q"], ["config", "user.email", "test@example.com"], ["config", "user.name", "Pi Web Test"],
    ["add", ".pi/settings.json"], ["commit", "-qm", "initial"]]) await exec("git", ["-C", dir, ...args]);
  if (trusted) new ProjectTrustStore(dir).set(dir, true);

  const faux = fauxProvider({ models: [{ id: "faux-model" }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const services = await createAgentSessionServices({
    cwd: dir, agentDir: dir, modelRuntime, settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true },
  });
  const { session: parent } = await createAgentSessionFromServices({
    services, sessionManager: SessionManager.create(dir, join(dir, "sessions")), model: faux.getModel("faux-model"),
  });
  const sessions = new Map();
  let child;
  const registerSession = (inner) => {
    if (inner !== parent) child = inner;
    const wrapper = { inner, cwd: dir, sessionFile: inner.sessionFile ?? "", isAlive: () => true, isRunning: () => inner.isStreaming, waitUntilReady: async () => {} };
    sessions.set(inner.sessionId, wrapper);
    return wrapper;
  };
  registerSession(parent);
  t.after(() => { for (const { inner } of sessions.values()) inner.dispose(); });
  const controller = createSubagentController({
    getSession: (id) => sessions.get(id), registerSession,
    resolveSessionPath: async (id) => sessions.get(id)?.sessionFile ?? null,
    reopenSession: async () => { throw new Error("unused"); },
    invalidateSessionList() {}, isBuiltInSubagentsEnabled: () => true,
  });
  faux.setResponses([fauxAssistantMessage([fauxText("done")])]);
  const execution = await controller.extensionRuntime.start({
    parentContext: { sessionManager: parent.sessionManager }, parentToolCallId: "call", profile: "fixture",
    task: "Report.", description: "Trust fixture", runInBackground: false, ...(isolation ? { isolation } : {}),
  });
  await execution.completion;
  return child;
}

for (const loadExtensions of [false, true]) {
  test(`a child in a folder never trusted reads no project settings (load_extensions: ${loadExtensions})`, async (t) => {
    const child = await runChild(t, { trusted: false, loadExtensions });
    assert.equal(child.settingsManager.isProjectTrusted(), false);
    assert.equal(child.settingsManager.getShellCommandPrefix(), undefined);

    // Reopened from its file (a server restart), it decides the same way.
    const reopened = (await startRpcSession(child.sessionId, child.sessionFile)).session;
    t.after(() => reopened.shutdown());
    await reopened.waitUntilReady();
    assert.equal(reopened.inner.settingsManager.isProjectTrusted(), false);
    assert.equal(reopened.inner.settingsManager.getShellCommandPrefix(), undefined);
  });
}

for (const loadExtensions of [false, true]) {
  test(`an isolated child's worktree is trusted with its trusted repository (load_extensions: ${loadExtensions})`, async (t) => {
    const { settingsManager } = await runChild(t, { trusted: true, isolation: "worktree", loadExtensions });
    assert.equal(settingsManager.isProjectTrusted(), true);
    assert.equal(settingsManager.getShellCommandPrefix(), "echo project-prefix;");
  });
}
