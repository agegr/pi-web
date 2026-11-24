import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createAgentSessionFromServices, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { createSubagentController } = await jiti.import("./subagent-runtime.ts");

// Opt in to real requests (including the summarizer). Default CI has no model credentials.
const live = process.env.PI_WEB_LIVE_TEST_BASE_URL && process.env.PI_WEB_LIVE_TEST_API_KEY;
const extension = `export default function (pi) {
  let action;
  pi.on("input", (event) => {
    action = event.text.includes("[compact and resume]") ? "resume"
      : event.text.includes("[compact only]") ? "compact" : undefined;
  });
  pi.on("message_update", (event, ctx) => {
    if (!action || event.assistantMessageEvent.type !== "text_delta") return;
    const resume = action === "resume";
    action = undefined;
    ctx.compact({ onComplete: () => {
      if (resume) pi.sendUserMessage("Reply with the single word CONTINUED.");
    } });
  });
}
`;

for (const [mode, title] of Object.entries({
  resume: "a background report waits for the turn started by ctx.compact onComplete",
  "compact only": "a compaction with no continuation still reports the stop",
  stop: "Stop in the child chat still reports the stop",
  "parent stop": "abortSubagent still reports the stop",
  rpc: "prompt_done waits for the turn started by ctx.compact onComplete",
})) {
  test(`real SDK: ${title}`, { skip: !live && "Set PI_WEB_LIVE_TEST_BASE_URL and PI_WEB_LIVE_TEST_API_KEY" }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-subagent-compaction-"));
    const previousDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    const sessions = new Map();
    try {
      await mkdir(join(dir, "agents"));
      await mkdir(join(dir, "extensions"));
      await writeFile(join(dir, "agents", "fixture.md"), [
        "---", "description: Manual compaction fixture.", "tools: read", "extensions: [compact]",
        "load_skills: false", "codemode: off", "---", "Complete the task without calling tools.",
      ].join("\n"));
      await writeFile(join(dir, "extensions", "compact.ts"), extension);
      await writeFile(join(dir, "settings.json"), JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 1 } }));
      const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
      const modelId = process.env.PI_WEB_LIVE_TEST_MODEL ?? "cc/claude-haiku-5-5";
      modelRuntime.registerProvider("live-test", {
        baseUrl: process.env.PI_WEB_LIVE_TEST_BASE_URL,
        api: "anthropic-messages", authHeader: true, apiKey: process.env.PI_WEB_LIVE_TEST_API_KEY,
        models: [{
          id: modelId, name: modelId, reasoning: false, input: ["text"],
          contextWindow: 200_000, maxTokens: 2_048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }],
      });
      const services = await createAgentSessionServices({
        cwd: dir, agentDir: dir, modelRuntime, settingsManager: SettingsManager.inMemory(),
        resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true },
      });
      const { session: parent } = await createAgentSessionFromServices({
        services, sessionManager: SessionManager.create(dir, join(dir, "sessions")), model: modelRuntime.getModel("live-test", modelId),
      });
      const registerSession = (inner, options) => {
        const wrapper = new AgentSessionWrapper(inner, options);
        sessions.set(inner.sessionId, wrapper);
        wrapper.start();
        wrapper.beginExtensionBinding();
        return wrapper;
      };
      registerSession(parent);
      const controller = createSubagentController({
        getSession: (id) => sessions.get(id), registerSession,
        resolveSessionPath: async (id) => sessions.get(id)?.sessionFile ?? null,
        reopenSession: async () => { throw new Error("The fixture keeps its sessions open"); },
        invalidateSessionList() {}, isBuiltInSubagentsEnabled: () => true,
      });
      const runtime = controller.extensionRuntime;
      const request = { parentContext: parent, parentToolCallId: "start", profile: "fixture", description: "Compaction fixture", runInBackground: true };
      const seed = await runtime.start({ ...request, task: "Reply with the single word READY." });
      const initial = await seed.completion;
      assert.equal(initial.status, "completed", initial.error);
      assert.match(initial.result, /READY/i);
      const child = sessions.get(initial.sessionId);
      const events = [];
      let statusDuringCompaction;
      let stop;
      const stopRequested = mode === "stop" || mode === "parent stop";
      let compaction;
      const promptDone = Promise.withResolvers();
      child.onEvent((event) => {
        if (event.type === "agent_settled") events.push([event.type, event.aborted]);
        if (event.type === "compaction_start") {
          events.push([event.type, event.reason]);
          statusDuringCompaction = runtime.get(child.sessionId);
        }
        if (event.type === "compaction_end") {
          events.push([event.type, event.aborted]);
          compaction = event;
        }
        if (event.type === "prompt_done") {
          events.push([event.type, event.aborted === true]);
          promptDone.resolve();
        }
        if (stopRequested && !stop && event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
          stop = mode === "stop" ? child.send({ type: "abort" }) : controller.abort(child.sessionId);
        }
      });
      const prefix = mode === "compact only" ? "[compact only] " : stopRequested ? "" : "[compact and resume] ";
      const task = prefix + "Write a numbered list of 100 different colors. Do not call tools.";
      if (mode === "rpc") {
        await child.send({ type: "prompt", message: task });
        await promptDone.promise;
        assert.deepEqual(events, [
          ["agent_settled", true], ["compaction_start", "manual"], ["compaction_end", false],
          ["agent_settled", false], ["prompt_done", false],
        ]);
        return;
      }
      const execution = await runtime.resume({ ...request, sessionId: child.sessionId, parentToolCallId: "resume", task });
      const result = await execution.completion;
      await stop;
      if (stopRequested) {
        assert.ok(stop);
        assert.equal(result.status, "aborted");
        assert.deepEqual(events, [["agent_settled", true]]);
      } else {
        assert.ok(compaction, "Reported a result before compaction ended");
        assert.equal(compaction.aborted, false);
        assert.ok(compaction.result, compaction.errorMessage);
        assert.equal((await statusDuringCompaction).status, "running");
        assert.deepEqual(events, [
          ["agent_settled", true], ["compaction_start", "manual"], ["compaction_end", false],
          ...(mode === "resume" ? [["agent_settled", false]] : []),
        ]);
        assert.equal(result.status, mode === "resume" ? "completed" : "aborted");
      }
      await runtime.notifyParent(result);
      const reports = parent.sessionManager.getEntries().filter((entry) => entry.customType === "pi-web:subagent-notification");
      assert.equal(reports.length, 1);
      if (mode === "resume") {
        assert.match(result.result, /CONTINUED/i);
        assert.match(reports[0].content, /CONTINUED/i);
        assert.doesNotMatch(reports[0].content, /was stopped\./);
      } else {
        assert.match(reports[0].content, /was stopped\./);
      }
    } finally {
      for (const wrapper of [...sessions.values()].reverse()) {
        if (wrapper.isAlive()) await wrapper.shutdown();
      }
      if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousDir;
      await rm(dir, { recursive: true, force: true });
    }
  });
}
