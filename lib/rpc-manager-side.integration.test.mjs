import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });

/** A scratch agent dir with an extension tool and a skill, a project with an AGENTS.md. */
async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-side-start-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
  const cwd = join(dir, "project");
  await mkdir(cwd, { recursive: true });
  await writeFile(join(cwd, "AGENTS.md"), "PROJECT-RULE\n");
  await mkdir(join(dir, "agent", "extensions"), { recursive: true });
  await writeFile(join(dir, "agent", "extensions", "ext-tool.js"), `export default function (pi) {
  pi.registerTool({ name: "ext_tool", label: "ext", description: "demo", parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }) });
  pi.registerCommand("ext-cmd", { description: "demo", handler: async () => {} });
}
`);
  await mkdir(join(dir, "agent", "skills", "demo"), { recursive: true });
  await writeFile(join(dir, "agent", "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: SKILL-MARK\n---\nBody\n");
  return { cwd, sessionDir: join(dir, "sessions") };
}

const tool = (name) => ({ name, description: name, parameters: { type: "object", properties: {} } });

/** A parent as pi leaves it: its tools recorded in a system message, a user turn and a reply. */
function parentSession({ cwd, sessionDir }, tools, pin) {
  const manager = SessionManager.create(cwd, sessionDir);
  manager.appendMessage({ role: "system", content: "parent prompt", toolsAdded: tools.map(tool), timestamp: Date.now() });
  manager.appendMessage({ role: "user", content: "question", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "answer" }], timestamp: Date.now() });
  if (pin) manager.appendCustomEntry("pi-web:tool-selection", { version: 1, tools: pin });
  return manager.getSessionFile();
}

async function startSide(t, parentFile) {
  const { createSideSession } = await jiti.import("./session-fork.ts");
  const { startRpcSession } = await jiti.import("./rpc-manager.ts");
  const side = createSideSession(parentFile);
  const { session } = await startRpcSession(side.sessionId, side.path, undefined);
  t.after(() => session.shutdown());
  return { side, session };
}

test("a side chat is the parent's session without edit, write and the tools of extensions", async (t) => {
  const dirs = await scratch(t);
  const { SIDE_BOUNDARY_TEXT } = await jiti.import("./side-session.ts");
  const { session } = await startSide(t, parentSession(dirs, ["read", "bash", "edit", "write"]));

  assert.deepEqual(session.inner.getActiveToolNames(), ["read", "bash"]);
  // Registered is what the Tools panel lists: only these, not the rest of SIDE_TOOLS.
  assert.deepEqual(session.inner.getAllTools().map((item) => item.name), ["read", "bash"]);
  // Everything else stays: extensions loaded, AGENTS.md and skills in the prompt.
  assert.ok(session.inner.resourceLoader.getExtensions().extensions.some((extension) => extension.commands.has("ext-cmd")));
  const prompt = session.inner.systemPrompt;
  assert.match(prompt, /PROJECT-RULE/);
  assert.match(prompt, /SKILL-MARK/);
  assert.equal(prompt.includes(SIDE_BOUNDARY_TEXT), false, "the boundary is a message, not the prompt");
  assert.equal(session.inner.agent.state.messages.at(-1).content, SIDE_BOUNDARY_TEXT);
  assert.equal(session.isChatOnly(), false);
});

test("a side chat of a Read-only parent has no shell", async (t) => {
  const dirs = await scratch(t);
  const pin = ["read", "grep", "find", "ls"];
  const { session } = await startSide(t, parentSession(dirs, pin, pin));
  assert.deepEqual(session.inner.getActiveToolNames().sort(), [...pin].sort());
  assert.deepEqual(session.inner.getAllTools().map((item) => item.name).sort(), [...pin].sort());
});

test("a side chat of a Chat-only parent stays Chat only, with the parent's exact prompt", async (t) => {
  const dirs = await scratch(t);
  const { SIDE_BOUNDARY_TEXT } = await jiti.import("./side-session.ts");
  const { session } = await startSide(t, parentSession(dirs, [], []));
  assert.equal(session.isChatOnly(), true);
  assert.deepEqual(session.inner.getActiveToolNames(), []);
  assert.equal(session.inner.systemPrompt.includes(SIDE_BOUNDARY_TEXT), false);
  assert.equal(session.inner.agent.state.messages.at(-1).content, SIDE_BOUNDARY_TEXT);
});

test("a side chat's first prompt names it, and only that one", async (t) => {
  const dirs = await scratch(t);
  const { SIDE_SESSION_NAME } = await jiti.import("./session-family.ts");
  const { session } = await startSide(t, parentSession(dirs, ["read", "bash", "edit", "write"]));
  const name = () => session.inner.sessionManager.getSessionName();
  assert.equal(name(), SIDE_SESSION_NAME);
  // With no model the prompt itself fails, past where it names the chat.
  await session.send({ type: "prompt", message: "/not-a-name" }).catch(() => {});
  assert.equal(name(), SIDE_SESSION_NAME);
  await session.send({ type: "prompt", message: "why did it fail?\nsee the log" }).catch(() => {});
  assert.equal(name(), "why did it fail?");
  await session.send({ type: "prompt", message: "a later question" }).catch(() => {});
  assert.equal(name(), "why did it fail?");
});

test("a side chat's tools stay fixed and it cannot be forked", async (t) => {
  const dirs = await scratch(t);
  const { setRpcSessionTools } = await jiti.import("./rpc-manager.ts");
  const { side, session } = await startSide(t, parentSession(dirs, ["read", "bash", "edit", "write"]));
  await assert.rejects(setRpcSessionTools(side.sessionId, side.path, ["read", "edit"]), /fixed when it is forked/);
  assert.deepEqual(session.inner.getActiveToolNames(), ["read", "bash"]);
  await assert.rejects(session.send({ type: "clone" }), /cannot be forked/);
  await assert.rejects(session.send({ type: "fork", entryId: "x" }), /cannot be forked/);
});

test("broken side metadata is refused, never reopened with the parent's tools", async (t) => {
  const dirs = await scratch(t);
  const { createSideSession } = await jiti.import("./session-fork.ts");
  const { startRpcSession, setRpcSessionTools } = await jiti.import("./rpc-manager.ts");
  const side = createSideSession(parentSession(dirs, ["read", "bash", "edit", "write"]));
  const lines = (await readFile(side.path, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  lines[1].data = { version: 2 };
  await writeFile(side.path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  await assert.rejects(startRpcSession(side.sessionId, side.path, undefined), /Invalid side chat metadata/);
  await assert.rejects(setRpcSessionTools(side.sessionId, side.path, ["read", "edit"]), /fixed when it is forked/);
});
