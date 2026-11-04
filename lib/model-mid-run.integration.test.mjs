import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

// The composer keeps the model selector usable while a run streams, as pi's TUI
// keeps its model keys. That only works because AgentSession hands the agent
// loop the current model before each turn of a run instead of freezing the
// model the run started with.
test("a model set mid-run answers from the next model request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-model-mid-run-"));
  try {
    const faux = fauxProvider({ models: [{ id: "faux-first" }, { id: "faux-second" }] });
    const modelRuntime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    modelRuntime.registerNativeProvider(faux.provider);

    const sessionManager = SessionManager.inMemory(dir);
    const { session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      modelRuntime,
      model: faux.getModel("faux-first"),
      tools: ["ls"],
      sessionManager,
      settingsManager: SettingsManager.inMemory(),
    });

    const requestModels = [];
    faux.setResponses([
      async (_context, _options, _state, model) => {
        requestModels.push(model.id);
        // The user picks another model while this response is still streaming.
        await session.setModel(faux.getModel("faux-second"));
        return fauxAssistantMessage([fauxToolCall("ls", { path: "." })], { stopReason: "toolUse" });
      },
      (_context, _options, _state, model) => {
        requestModels.push(model.id);
        return fauxAssistantMessage([fauxText("done")]);
      },
    ]);

    await session.prompt("list the directory");

    assert.deepEqual(requestModels, ["faux-first", "faux-second"]);
    assert.equal(session.model?.id, "faux-second");
    const answers = sessionManager.getEntries()
      .filter((entry) => entry.type === "message" && entry.message.role === "assistant")
      .map((entry) => entry.message.model);
    assert.deepEqual(answers, ["faux-first", "faux-second"]);
    session.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
