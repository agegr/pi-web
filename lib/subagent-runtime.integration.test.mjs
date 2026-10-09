import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
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

async function withRuntime(check, configureChild, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-subagent-runtime-"));
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  const sessions = new Map();
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    await mkdir(join(dir, "agents"));
    await writeFile(join(dir, "agents", "fixture.md"), [
      "---", "description: Exercise the real subagent lifecycle.", `tools: ${options.tools ?? "read"}`,
      "load_skills: false", "load_extensions: false", "max_turns: 1",
      ...(options.codemode ? [`codemode: ${options.codemode}`] : []),
      "---", "Complete the assigned task.",
    ].join("\n"));
    await writeFile(join(dir, "agents", "fixture-unlimited.md"), [
      "---", "description: Exercise a run the profile leaves without a turn limit.", "tools: read",
      "load_skills: false", "load_extensions: false", "---", "Complete the assigned task.",
    ].join("\n"));
    await writeFile(join(dir, "agents", "fixture-profile-options.md"), [
      "---", "description: Exercise the options only a profile decides.", "tools: read",
      "load_skills: false", "load_extensions: false", "thinking: low", "inherit_context: true",
      "---", "Complete the assigned task.",
    ].join("\n"));
    if (options.settings) await writeFile(join(dir, "settings.json"), JSON.stringify(options.settings));
    const fact = join(dir, "fact.txt");
    await writeFile(fact, "The fixture value is 42.\n");
    const faux = fauxProvider({ models: [{ id: "faux-model", reasoning: true }] });
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
    if (options.parentCodemode) {
      const parentTools = parent.getActiveToolNames.bind(parent);
      parent.getActiveToolNames = () => [...new Set([...parentTools(), "codemode"])] ;
    }
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

const codemodeScript = (fact, target) => `
const readResult = await tools.read({ path: ${JSON.stringify(fact)} });
let writeError;
try {
  await tools.write({ path: ${JSON.stringify(target)}, content: "must not be written" });
} catch (error) {
  writeError = String(error);
}
return JSON.stringify({ readResult, writeError });
`;

test("codemode subagents use the sandbox and keep the profile allowlist", async () => {
  await withRuntime(async ({ runtime, request, faux, fact, sessions }) => {
    const target = `${fact}.write-attempt`;
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("codemode", { code: codemodeScript(fact, target) })], { stopReason: "toolUse" }),
      answer("CODEMODE_DONE"),
    ]);
    const execution = await runtime.start(request);
    const result = await execution.completion;
    assert.equal(result.status, "completed");
    assert.equal(result.result, "CODEMODE_DONE");
    const child = sessions.get(result.sessionId).inner;
    const codemodeResult = child.agent.state.messages.findLast(
      (message) => message.role === "toolResult" && message.toolName === "codemode",
    );
    const output = codemodeResult.content.map((block) => block.text ?? "").join("");
    assert.match(output, /42/);
    assert.match(output, /tools\.write does not exist/);
    assert.equal(existsSync(target), false);
  }, undefined, { codemode: "on" });
});

test("codemode inheritance respects off and preserves chat-only profiles", async (t) => {
  await t.test("inherit enables codemode when the parent has it", async () => {
    await withRuntime(async ({ runtime, request, faux, sessions }) => {
      faux.setResponses([answer("INHERITED")]);
      const execution = await runtime.start(request);
      const result = await execution.completion;
      assert.equal(result.status, "completed");
      assert.ok(sessions.get(result.sessionId).inner.getActiveToolNames().includes("codemode"));
    }, undefined, { parentCodemode: true, codemode: "inherit" });
  });
  await t.test("missing codemode stays disabled", async () => {
    await withRuntime(async ({ runtime, request, faux, sessions }) => {
      faux.setResponses([answer("DEFAULT_OFF")]);
      const execution = await runtime.start(request);
      const result = await execution.completion;
      assert.equal(result.status, "completed");
      assert.equal(sessions.get(result.sessionId).inner.getActiveToolNames().includes("codemode"), false);
    }, undefined, { parentCodemode: true });
  });
  await t.test("off blocks inherited codemode", async () => {
    await withRuntime(async ({ runtime, request, faux, sessions }) => {
      faux.setResponses([answer("OFF")]);
      const execution = await runtime.start(request);
      const result = await execution.completion;
      assert.equal(result.status, "completed");
      assert.equal(sessions.get(result.sessionId).inner.getActiveToolNames().includes("codemode"), false);
    }, undefined, { parentCodemode: true, codemode: "off" });
  });
  await t.test("inherit does not turn tools:none into a scripting session", async () => {
    await withRuntime(async ({ runtime, request, faux, sessions }) => {
      faux.setResponses([answer("CHAT_ONLY")]);
      const execution = await runtime.start(request);
      const result = await execution.completion;
      const child = sessions.get(result.sessionId);
      assert.equal(result.status, "completed");
      assert.equal(child.inner.getActiveToolNames().includes("codemode"), false);
      assert.equal(child.inner.getActiveToolNames().length, 0);
    }, undefined, { parentCodemode: true, tools: "none" });
  });
  await t.test("explicit on is rejected for a chat-only profile", async () => {
    await withRuntime(async ({ runtime, request }) => {
      await assert.rejects(runtime.start(request), /chat-only/);
    }, undefined, { codemode: "on", tools: "none" });
  });
});

test("codemode only hides direct declarations while keeping scripts callable", async () => {
  await withRuntime(async ({ runtime, request, faux, fact, sessions }) => {
    let declared;
    faux.setResponses([(context) => {
      declared = getCurrentTools(context.messages).map((tool) => tool.name);
      return fauxAssistantMessage([fauxToolCall("codemode", {
        code: `return await tools.read({ path: ${JSON.stringify(fact)} });`,
      })], { stopReason: "toolUse" });
    }, answer("ONLY_MODE")]);
    const execution = await runtime.start(request);
    const result = await execution.completion;
    const child = sessions.get(result.sessionId).inner;
    const codemodeResult = child.agent.state.messages.findLast(
      (message) => message.role === "toolResult" && message.toolName === "codemode",
    );
    assert.equal(result.status, "completed");
    assert.match(codemodeResult.content.map((block) => block.text ?? "").join(""), /42/);
    assert.ok(child.getActiveToolNames().includes("read"));
    assert.ok(child.getActiveToolNames().includes("codemode"));
    assert.ok(declared.includes("codemode"));
    assert.equal(declared.includes("read"), false);
  }, undefined, { codemode: "on", settings: { codemode: { mode: "only" } } });
});

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
      const first = await runtime.start(request);
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
      const execution = await runtime.start(request);
      const result = await execution.completion;
      assert.equal(result.status, "completed");
      assert.equal(result.result, "FINAL_REVIEW");
    });
  });

  await t.test("exhausting the wrap-up turn reports the limit and retains partial output", async () => {
    await withRuntime(async ({ runtime, request, faux, fact }) => {
      faux.setResponses([readFact(fact), readFact(fact, "PARTIAL_FINDINGS")]);
      const execution = await runtime.start(request);
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

const sawText = (context, text) => context.messages.some((message) => message.role === "user" &&
  message.content.some((block) => block.type === "text" && block.text === text));

test("messages queued as the limit ends are reported instead of running past it", async (t) => {
  await t.test("a message from an existing turn hook is not delivered after the limit, nor on resume", async () => {
    await withRuntime(async ({ runtime, request, faux, fact }) => {
      faux.setResponses([
        readFact(fact),
        readFact(fact, "PARTIAL_FINDINGS"),
        answer("PAST_THE_LIMIT"),
      ]);
      const execution = await runtime.start(request);
      const result = await execution.completion;
      assert.equal(faux.state.callCount, 2);
      assert.equal(result.status, "failed");
      assert.match(result.error, /turn limit/i);
      assert.match(result.error, /LATE_HANDOFF/);
      assert.equal(result.result, "PARTIAL_FINDINGS");
      faux.setResponses([(context) => {
        assert.equal(sawText(context, "LATE_HANDOFF"), false, "A reported message must not reach the resumed task.");
        assert.equal(hasLimitPrompt(context), true, "Only the delivered wrap-up instruction stays in the transcript.");
        return answer("RESUMED_RESULT");
      }]);
      const resumed = await runtime.resume({ ...request, sessionId: result.sessionId, task: "Continue." });
      const again = await resumed.completion;
      assert.equal(again.status, "completed");
      assert.equal(again.result, "RESUMED_RESULT");
    }, (inner) => {
      const finishTurn = inner.agent.finishTurn;
      inner.agent.finishTurn = async (turn, signal) => {
        const decision = await finishTurn?.(turn, signal);
        if (!turn.message.content.some((block) => block.type === "text" && block.text === "PARTIAL_FINDINGS")) return decision;
        await inner.steer("LATE_HANDOFF");
        return { action: "continue" };
      };
    });
  });

  await t.test("a steer queued before the wrap-up turn arrives together with the instruction", async () => {
    await withRuntime(async ({ runtime, request, faux, fact }) => {
      let sessionId;
      faux.setResponses([
        async () => {
          await runtime.steer(sessionId, "EARLY_NOTE");
          return readFact(fact);
        },
        (context) => {
          assert.equal(sawText(context, "EARLY_NOTE"), true);
          assert.equal(hasLimitPrompt(context), true, "A queued steer must not hold the instruction back.");
          return answer("FINAL_WITH_NOTE");
        },
        answer("PAST_THE_LIMIT"),
      ]);
      const execution = await runtime.start(request);
      sessionId = execution.run.sessionId;
      const result = await execution.completion;
      assert.equal(faux.state.callCount, 2);
      assert.equal(result.status, "completed");
      assert.equal(result.result, "FINAL_WITH_NOTE");
    });
  });

  await t.test("the parent's steer during the wrap-up turn is reported, and a steer after the limit is refused", async () => {
    await withRuntime(async ({ runtime, request, faux, fact, sessions }) => {
      let sessionId;
      faux.setResponses([
        readFact(fact),
        async () => {
          await runtime.steer(sessionId, "PARENT_NOTE");
          return readFact(fact, "PARTIAL_FINDINGS");
        },
        answer("PAST_THE_LIMIT"),
      ]);
      const execution = await runtime.start(request);
      sessionId = execution.run.sessionId;
      let lateSteer;
      sessions.get(sessionId).inner.subscribe((event) => {
        if (event.type !== "turn_end" || faux.state.callCount !== 2) return;
        lateSteer ??= runtime.steer(sessionId, "TOO_LATE").then(() => "accepted", (error) => error.message);
      });
      const result = await execution.completion;
      assert.equal(faux.state.callCount, 2);
      assert.equal(result.status, "failed");
      assert.match(result.error, /PARENT_NOTE/);
      assert.doesNotMatch(result.error, /You have reached your turn limit/);
      assert.match(await lateSteer, /turn limit/i);
    });
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
        const execution = await runtime.start(request);
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
      const execution = await runtime.start(request);
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
      const execution = await runtime.start(request);
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
      const execution = await runtime.start({ ...request, profile: "fixture-unlimited" });
      const result = await execution.completion;
      assert.equal(result.status, "completed");
      assert.equal(result.result, "UNLIMITED_RESULT");
    });
  });

  await t.test("a provider error is a failure on start and resume", async () => {
    await withRuntime(async ({ runtime, request, faux }) => {
      const failure = fauxAssistantMessage([], { stopReason: "error", errorMessage: "FIXTURE_error" });
      faux.setResponses([failure, failure]);
      const execution = await runtime.start(request);
      const result = await execution.completion;
      assert.equal(result.status, "failed");
      assert.equal(result.error, "FIXTURE_error");
      const resumed = await runtime.resume({ ...request, sessionId: result.sessionId });
      const again = await resumed.completion;
      assert.equal(again.status, "failed");
      assert.equal(again.error, "FIXTURE_error");
    });
  });

  await t.test("stopping the child from its own chat is aborted, not failed or completed", async () => {
    await withRuntime(async ({ runtime, request, faux, sessions }) => {
      let sessionId;
      // The child chat's Stop calls the session's own abort(); the controller never hears of it.
      const stopFromChildChat = () => {
        void sessions.get(sessionId).inner.abort();
        return answer("NOT_A_COMPLETED_TASK");
      };
      faux.setResponses([stopFromChildChat]);
      const execution = await runtime.start(request);
      sessionId = execution.run.sessionId;
      const result = await execution.completion;
      assert.equal(result.status, "aborted");
      assert.equal(result.error, undefined);
      faux.setResponses([stopFromChildChat]);
      const resumed = await runtime.resume({ ...request, sessionId });
      const again = await resumed.completion;
      assert.equal(again.status, "aborted");
      assert.equal(again.error, undefined);
    });
  });

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
      const execution = await runtime.start(request);
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

test("the profile decides thinking and parent context, and input files still reach the task", async () => {
  await withRuntime(async ({ runtime, request, faux, fact, sessions }) => {
    let seen;
    faux.setResponses([(context) => {
      seen = JSON.stringify({ systemPrompt: context.systemPrompt, messages: context.messages });
      return answer("PROFILE_OPTIONS_RESULT");
    }]);
    const parentThinking = sessions.get(request.parentContext.sessionManager.getSessionId()).inner.thinkingLevel;
    assert.notEqual(parentThinking, "low", "The fixture needs a parent level the profile can differ from.");
    const execution = await runtime.start({
      ...request, profile: "fixture-profile-options", inputFiles: [basename(fact)],
    });
    const result = await execution.completion;
    assert.equal(result.status, "completed");
    assert.equal(result.result, "PROFILE_OPTIONS_RESULT");
    assert.equal(sessions.get(execution.run.sessionId).inner.thinkingLevel, "low");
    assert.match(seen, /active conversation context from the parent session/);
    assert.match(seen, /<document path=\\"fact\.txt\\">\\nThe fixture value is 42\./);
  });
});
