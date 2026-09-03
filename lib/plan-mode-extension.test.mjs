import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const { getPlanToolNames, isPlanBlockedTool, planModeExtension } = await createJiti(import.meta.url).import("./plan-mode-extension.ts");
const rpcManagerSource = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

test("plan mode enables only known read-only tools", () => {
  assert.deepEqual(
    getPlanToolNames(["read", "bash", "powershell", "edit", "write", "grep", "find", "ls", "questionnaire", "deploy"]),
    ["read", "grep", "find", "ls", "questionnaire"],
  );
});

test("plan mode blocks built-in and extension mutation paths", () => {
  assert.equal(isPlanBlockedTool("bash"), true);
  assert.equal(isPlanBlockedTool("powershell"), true);
  assert.equal(isPlanBlockedTool("edit"), true);
  assert.equal(isPlanBlockedTool("write"), true);
  assert.equal(isPlanBlockedTool("deploy"), true);
  assert.equal(isPlanBlockedTool("read"), false);
  assert.equal(isPlanBlockedTool("questionnaire"), false);
});

test("the plan command restricts tools, publishes status, and restores the prior selection", async () => {
  const handlers = new Map();
  const entries = [];
  const statuses = [];
  let activeTools = ["read", "bash", "deploy"];
  let planCommand;
  planModeExtension({
    registerCommand(name, command) {
      if (name === "plan") planCommand = command;
    },
    on(event, handler) {
      handlers.set(event, handler);
    },
    getActiveTools() {
      return [...activeTools];
    },
    getAllTools() {
      return ["read", "bash", "grep", "deploy"].map((name) => ({ name }));
    },
    setActiveTools(names) {
      activeTools = [...names];
    },
    appendEntry(customType, data) {
      entries.push({ customType, data });
    },
  });
  const context = {
    ui: {
      setStatus: (key, text) => statuses.push({ key, text }),
      notify: () => {},
    },
  };

  await planCommand.handler("", context);
  assert.deepEqual(activeTools, ["read", "grep"]);
  assert.deepEqual(statuses.at(-1), { key: "plan-mode", text: "PLAN" });
  assert.equal(handlers.get("tool_call")({ toolName: "deploy" }).block, true);
  assert.match(handlers.get("before_agent_start")().message.content, /PLAN MODE ACTIVE/);
  assert.equal(entries.at(-1).data.enabled, true);

  await planCommand.handler("", context);
  assert.deepEqual(activeTools, ["read", "bash", "deploy"]);
  assert.deepEqual(statuses.at(-1), { key: "plan-mode", text: undefined });
});

test("direct shell commands cannot bypass plan mode", () => {
  assert.match(
    rpcManagerSource,
    /case "bash": \{\s+if \(this\.extensionStatuses\.has\("plan-mode"\)\)/,
  );
});
