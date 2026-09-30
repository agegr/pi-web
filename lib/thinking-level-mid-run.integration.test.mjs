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

// The composer keeps the reasoning control usable while a run streams (#851).
// That only works because AgentSession re-reads the thinking level before each
// model request of a run instead of freezing the level the run started with.
test("a thinking level set mid-run applies from the next model request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-thinking-mid-run-"));
  try {
    const faux = fauxProvider({ models: [{ id: "faux-reasoner", reasoning: true }] });
    const modelRuntime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    modelRuntime.registerNativeProvider(faux.provider);

    const { session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      modelRuntime,
      model: faux.getModel("faux-reasoner"),
      thinkingLevel: "low",
      tools: ["ls"],
      sessionManager: SessionManager.inMemory(dir),
      settingsManager: SettingsManager.inMemory(),
    });

    const requestLevels = [];
    faux.setResponses([
      (_context, options) => {
        requestLevels.push(options?.reasoning);
        // The user picks a new level while this response is still streaming.
        session.setThinkingLevel("high");
        return fauxAssistantMessage([fauxToolCall("ls", { path: "." })], { stopReason: "toolUse" });
      },
      (_context, options) => {
        requestLevels.push(options?.reasoning);
        return fauxAssistantMessage([fauxText("done")]);
      },
    ]);

    await session.prompt("list the directory");

    assert.deepEqual(requestLevels, ["low", "high"]);
    assert.equal(session.thinkingLevel, "high");
    session.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
