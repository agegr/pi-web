import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSessionFromServices, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const tool = (name, exposure) => `pi.registerTool({ name: ${JSON.stringify(name)}, label: "x", description: "x",
  ${exposure ? `exposure: ${JSON.stringify(exposure)},` : ""} parameters: { type: "object", properties: {} },
  execute: async () => ({ content: [{ type: "text", text: ${JSON.stringify(`${name} ran`)} }] }) });`;

// pi keeps MCP tools an allowlist does not name registered for codemode scripts (`--tools`), so an
// extension the profile did not select must not hand a script one.
test("a codemode script reaches only the tools a child's ext: selectors admit", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "subagent-codemode-scope-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => { if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir; });
  await mkdir(join(dir, "extensions"), { recursive: true });
  await writeFile(join(dir, "extensions", "alpha.ts"), `export default function (pi) { ${tool("alpha_tool")} }\n`);
  await writeFile(join(dir, "extensions", "beta.ts"), `export default function (pi) { ${tool("mcp__beta__write", "deferred")} ${tool("beta_tool", "deferred")} }\n`);
  await mkdir(join(dir, ".pi", "agents"), { recursive: true });
  await writeFile(join(dir, ".pi", "agents", "selected.md"), "---\ndescription: Selected\ntools: read, ext:alpha\ncodemode: on\n---\nCHILD\n");

  const faux = fauxProvider({ models: [{ id: "faux-model" }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const services = await createAgentSessionServices({ cwd: dir, agentDir: dir, modelRuntime, settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true } });
  const { session: parentSession } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(dir), model: faux.getModel("faux-model") });
  t.after(() => parentSession.dispose());

  const jiti = createJiti(import.meta.url);
  const { createSubagentController } = await jiti.import("./subagent-runtime.ts");
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
  const parentId = parentSession.sessionId;
  const parent = { inner: parentSession, cwd: dir, sessionFile: join(dir, "parent.jsonl"), isAlive: () => true, isRunning: () => false };
  const state = {};
  const controller = createSubagentController({
    getSession: (id) => id === parentId ? parent : state.child?.inner.sessionId === id ? state.child : undefined,
    registerSession(inner, options) {
      state.child = new AgentSessionWrapper(inner, options);
      state.child.start(); state.child.beginExtensionBinding();
    },
    reopenSession: async () => { throw new Error("unused"); }, resolveSessionPath: async () => state.child.sessionFile,
    invalidateSessionList() {}, isBuiltInSubagentsEnabled: () => true,
  });
  t.after(async () => { if (state.child?.isAlive()) await state.child.shutdown(); });

  const code = `const out = {};
for (const name of ["alpha_tool", "mcp__beta__write", "beta_tool"]) {
  try { out[name] = await tools[name]({}); } catch (error) { out[name] = "failed"; }
}
console.log(JSON.stringify({ callable: Object.keys(tools), out }));`;
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const execution = await controller.extensionRuntime.start({ parentContext: parentSession, parentToolCallId: "start", profile: "selected", task: "work", description: "work" });
  assert.equal((await execution.completion).status, "completed");
  const result = state.child.inner.agent.state.messages.findLast((message) => message.role === "toolResult" && message.toolName === "codemode");
  const { callable, out } = JSON.parse(result.content.map((block) => block.text ?? "").join("").match(/\{"callable".*\}/)[0]);
  assert.deepEqual(callable.sort(), ["alpha_tool", "read"]);
  assert.deepEqual(out, { alpha_tool: "alpha_tool ran", mcp__beta__write: "failed", beta_tool: "failed" });
  assert.equal(state.child.inner.getAllTools().some((candidate) => candidate.name === "mcp__beta__write"), false);
});
