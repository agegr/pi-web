import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

const TOOLS = [
  { name: "read", description: "read" },
  { name: "bash", description: "bash" },
  { name: "lookup", description: "no exposure field" },
  { name: "ask", description: "model-only", exposure: "model-only" },
  { name: "scripted", description: "codemode", exposure: "codemode" },
  { name: "searchable", description: "deferred", exposure: "deferred" },
  { name: "withdrawn", description: "hidden", exposure: "hidden" },
];

function makeWrapper() {
  const activated = [];
  const inner = {
    sessionId: "tool-exposure-session",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    sessionManager: { getCwd: () => process.cwd() },
    settingsManager: { getDefaultTools: () => undefined },
    agent: { state: {} },
    extensionRunner: { emit: async () => {} },
    subscribe: () => () => {},
    getActiveToolNames: () => ["read", "lookup"],
    getAllTools: () => TOOLS,
    setActiveToolsByName: (names) => activated.push(names),
    dispose: () => {},
  };
  return { wrapper: new AgentSessionWrapper(inner), activated };
}

test("a tool selection keeps only the extension tools pi activates on registration", (t) => {
  const { wrapper, activated } = makeWrapper();
  t.after(() => wrapper.destroy());

  wrapper.setActiveToolSelection(["read"]);

  assert.deepEqual(activated, [["read", "lookup", "ask"]]);
});

test("get_tools leaves out withdrawn tools and reports each tool's exposure", async (t) => {
  const { wrapper } = makeWrapper();
  t.after(() => wrapper.destroy());

  const tools = await wrapper.send({ type: "get_tools" });

  assert.deepEqual(
    tools.map(({ name, exposure, active }) => ({ name, exposure, active })),
    [
      { name: "read", exposure: undefined, active: true },
      { name: "bash", exposure: undefined, active: false },
      { name: "lookup", exposure: undefined, active: true },
      { name: "ask", exposure: "model-only", active: false },
      { name: "scripted", exposure: "codemode", active: false },
      { name: "searchable", exposure: "deferred", active: false },
    ],
  );
});
