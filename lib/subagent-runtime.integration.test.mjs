import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const { createSubagentController } = await createJiti(import.meta.url).import("./subagent-runtime.ts");
const { subagentFinalText } = await createJiti(import.meta.url).import("./subagent-extension.ts");

async function withRuntime(check, configureChild) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-subagent-runtime-"));
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  const sessions = new Map();
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    await mkdir(join(dir, "agents"));
    await writeFile(join(dir, "agents", "fixture.md"), [
      "---", "description: Exercise the real subagent lifecycle.", "tools: read",
      "load_skills: false", "load_extensions: false", "---", "Complete the assigned task.",
    ].join("\n"));
    const fact = join(dir, "fact.txt");
    await writeFile(fact, "The fixture value is 42.\n");
    const faux = fauxProvider({ models: [{ id: "faux-model" }] });
    const modelRuntime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false,
    });
    modelRuntime.registerNativeProvider(faux.provider);
    const services = await createAgentSessionServices({
      cwd: dir, agentDir: dir, modelRuntime, settingsManager: SettingsManager.inMemory(),
      resourceLoaderOptions: {
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      },
    });
    const { session: parent } = await createAgentSessionFromServices({
      services, sessionManager: SessionManager.create(dir, join(dir, "sessions")), model: faux.getModel("faux-model"),
    });
    const registerSession = (inner) => {
      if (inner !== parent) configureChild?.(inner);
      const wrapper = {
        inner, cwd: dir, sessionFile: inner.sessionFile ?? "", isAlive: () => true,
        isRunning: () => inner.isStreaming, waitUntilReady: async () => {},
      };
      sessions.set(inner.sessionId, wrapper);
      return wrapper;
    };
    registerSession(parent);
    const controller = createSubagentController({
      getSession: (id) => sessions.get(id), registerSession,
      resolveSessionPath: async (id) => sessions.get(id)?.sessionFile ?? null,
      reopenSession: async () => { throw new Error("The fixture must use its live session."); },
      invalidateSessionList() {}, isBuiltInSubagentsEnabled: () => true,
    });
    const request = {
      parentContext: { sessionManager: parent.sessionManager }, parentToolCallId: "fixture-call",
      profile: "fixture", task: "Read the fixture if necessary and report the result.",
      description: "Lifecycle fixture", runInBackground: false,
    };
    await check({ controller, runtime: controller.extensionRuntime, request, faux, fact, sessions });
  } finally {
    for (const { inner } of sessions.values()) inner.dispose();
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
    await rm(dir, { recursive: true, force: true });
  }
}

const answer = (text) => fauxAssistantMessage([fauxText(text)]);
const readFact = (path, text) => fauxAssistantMessage([
  ...(text ? [fauxText(text)] : []), fauxToolCall("read", { path }),
], { stopReason: "toolUse" });
const hasLimitPrompt = (context) => context.messages.some((message) =>
  message.role === "user" && message.content.some((block) =>
    block.type === "text" && block.text.includes("You have reached your turn limit")));

test("turn limits preserve completed results and stop unfinished work at the real SDK boundary", async (t) => {
  await t.test("a final answer at the limit does not request another answer or leak into resume", async () => {
    await withRuntime(async ({ runtime, request, faux }) => {
      faux.setResponses([
        answer("FIRST_RESULT"),
        (context) => {
          assert.equal(hasLimitPrompt(context), false, "No stale budget instruction may enter the resumed task.");
          return answer("RESUMED_RESULT");
        },
      ]);
      const first = await runtime.start({ ...request, maxTurns: 1 });
      const completed = await first.completion;
      assert.equal(completed.status, "completed");
      assert.equal(completed.result, "FIRST_RESULT");
      const resumed = await runtime.resume({ ...request, sessionId: completed.sessionId, task: "Report again." });
      const result = await resumed.completion;
      assert.equal(result.status, "completed");
      assert.equal(result.result, "RESUMED_RESULT");
    });
  });

  await t.test("the one wrap-up turn sees its instruction and may finish normally", async () => {
    await withRuntime(async ({ runtime, request, faux, fact }) => {
      faux.setResponses([
        readFact(fact),
        (context) => {
          assert.equal(hasLimitPrompt(context), true, "The instruction must arrive before the wrap-up request.");
          return answer("FINAL_REVIEW");
        },
      ]);
      const execution = await runtime.start({ ...request, maxTurns: 1 });
      const result = await execution.completion;
      assert.equal(result.status, "completed");
      assert.equal(result.result, "FINAL_REVIEW");
    });
  });

  await t.test("exhausting the wrap-up turn reports the limit and retains partial output", async () => {
    await withRuntime(async ({ runtime, request, faux, fact }) => {
      faux.setResponses([readFact(fact), readFact(fact, "PARTIAL_FINDINGS")]);
      const execution = await runtime.start({ ...request, maxTurns: 1 });
      const result = await execution.completion;
      assert.equal(result.status, "failed");
      assert.match(result.error, /turn limit/i);
      assert.equal(result.result, "PARTIAL_FINDINGS");
      const response = subagentFinalText(result);
      assert.match(response, /failed/i);
      assert.match(response, /PARTIAL_FINDINGS/);
    });
  });
});

test("a budget stop preserves messages from the existing SDK turn hook for resume", async () => {
  await withRuntime(async ({ runtime, request, faux, fact }) => {
    const resumeAnswer = (context) => answer(context.messages.some((message) => message.role === "user" &&
      message.content.some((block) => block.type === "text" && block.text === "REQUIRED_HANDOFF"))
      ? "RESUMED_WITH_HANDOFF" : "WAITING_FOR_HANDOFF");
    faux.setResponses([readFact(fact), readFact(fact, "PARTIAL_FINDINGS"), resumeAnswer, resumeAnswer]);
    const execution = await runtime.start({ ...request, maxTurns: 1 });
    const result = await execution.completion;
    assert.equal(result.status, "failed");
    assert.match(result.error, /turn limit/i);
    const resumed = await runtime.resume({ ...request, sessionId: result.sessionId });
    const again = await resumed.completion;
    assert.equal(again.status, "completed");
    assert.equal(again.result, "RESUMED_WITH_HANDOFF");
  }, (inner) => {
    const finishTurn = inner.agent.finishTurn;
    inner.agent.finishTurn = async (turn, signal) => {
      const decision = await finishTurn?.(turn, signal);
      if (!turn.message.content.some((block) => block.type === "text" && block.text === "PARTIAL_FINDINGS")) return decision;
      await inner.steer("REQUIRED_HANDOFF");
      return { action: "continue" };
    };
  });
});

test("limits respect finalized tool-batch termination instead of reviving or failing it", async (t) => {
  for (const terminalTurn of [1, 2]) {
    await t.test(`termination on turn ${terminalTurn} ends normally without an extra request`, async () => {
      await withRuntime(async ({ runtime, request, faux, fact }) => {
        faux.setResponses([
          ...(terminalTurn === 2 ? [readFact(fact)] : []),
          readFact(fact, "TERMINAL_RESULT"), answer("REVIVED_RESULT"),
        ]);
        const execution = await runtime.start({ ...request, maxTurns: 1 });
        const result = await execution.completion;
        assert.equal(result.status, "completed");
        assert.equal(result.result, "TERMINAL_RESULT");
        assert.equal(faux.state.callCount, terminalTurn);
      }, (inner) => {
        const afterToolCall = inner.agent.afterToolCall;
        let calls = 0;
        inner.agent.afterToolCall = async (context, signal) => ({
          ...await afterToolCall?.(context, signal), terminate: ++calls === terminalTurn,
        });
      });
    });
  }

  await t.test("a policy block with termination also ends without a wrap-up request", async () => {
    await withRuntime(async ({ runtime, request, faux, fact }) => {
      faux.setResponses([readFact(fact, "POLICY_TERMINATED"), answer("REVIVED_RESULT")]);
      const execution = await runtime.start({ ...request, maxTurns: 1 });
      const result = await execution.completion;
      assert.equal(result.status, "completed");
      assert.equal(result.result, "POLICY_TERMINATED");
      assert.equal(faux.state.callCount, 1);
    }, (inner) => {
      const beforeToolCall = inner.agent.beforeToolCall;
      inner.agent.beforeToolCall = async (context, signal) => ({
        ...await beforeToolCall?.(context, signal), block: true, reason: "Fixture policy", terminate: true,
      });
    });
  });

  await t.test("a mixed tool batch still receives its one wrap-up turn", async () => {
    await withRuntime(async ({ runtime, request, faux, fact }) => {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("read", { path: fact }), fauxToolCall("read", { path: fact })], { stopReason: "toolUse" }),
        (context) => {
          assert.equal(hasLimitPrompt(context), true);
          return answer("MIXED_BATCH_FINISHED");
        },
      ]);
      const execution = await runtime.start({ ...request, maxTurns: 1 });
      const result = await execution.completion;
      assert.equal(result.status, "completed");
      assert.equal(result.result, "MIXED_BATCH_FINISHED");
    }, (inner) => {
      const afterToolCall = inner.agent.afterToolCall;
      let calls = 0;
      inner.agent.afterToolCall = async (context, signal) => ({
        ...await afterToolCall?.(context, signal), terminate: ++calls === 1,
      });
    });
  });
});

test("unlimited runs, provider failures, and requested cancellation retain their own outcomes", { timeout: 30_000 }, async (t) => {
  await t.test("omitting the limit does not inject a budget instruction", async () => {
    await withRuntime(async ({ runtime, request, faux, fact }) => {
      faux.setResponses([readFact(fact), readFact(fact), (context) => {
        assert.equal(hasLimitPrompt(context), false);
        return answer("UNLIMITED_RESULT");
      }]);
      const execution = await runtime.start(request);
      const result = await execution.completion;
      assert.equal(result.status, "completed");
      assert.equal(result.result, "UNLIMITED_RESULT");
    });
  });

  for (const stopReason of ["error", "aborted"]) {
    await t.test(`an unsolicited ${stopReason} is not success on start or resume`, async () => {
      await withRuntime(async ({ runtime, request, faux }) => {
        const failure = fauxAssistantMessage([], { stopReason, errorMessage: `FIXTURE_${stopReason}` });
        faux.setResponses([failure, failure]);
        const execution = await runtime.start({ ...request, maxTurns: 1 });
        const result = await execution.completion;
        assert.equal(result.status, "failed");
        assert.equal(result.error, `FIXTURE_${stopReason}`);
        const resumed = await runtime.resume({ ...request, sessionId: result.sessionId });
        const again = await resumed.completion;
        assert.equal(again.status, "failed");
        assert.equal(again.error, `FIXTURE_${stopReason}`);
      });
    });
  }

  await t.test("an explicit cancellation is aborted and the child can subsequently resume", async () => {
    await withRuntime(async ({ controller, runtime, request, faux }) => {
      let entered, release;
      const started = new Promise((resolve) => { entered = resolve; });
      const pending = new Promise((resolve) => { release = resolve; });
      faux.setResponses([async () => {
        entered();
        await pending;
        return answer("NOT_A_COMPLETED_TASK");
      }]);
      const execution = await runtime.start({ ...request, maxTurns: 1 });
      await started;
      const stopping = controller.abort(execution.run.sessionId);
      release();
      await stopping;
      const result = await execution.completion;
      assert.equal(result.status, "aborted");
      assert.equal(result.error, undefined);
      faux.setResponses([answer("AFTER_CANCELLATION")]);
      const resumed = await runtime.resume({ ...request, sessionId: result.sessionId });
      const again = await resumed.completion;
      assert.equal(again.status, "completed");
      assert.equal(again.result, "AFTER_CANCELLATION");
    });
  });
});
