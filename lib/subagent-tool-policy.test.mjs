import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const sandbox = await mkdtemp(join(tmpdir(), "pi-tool-policy-"));
const oldHome = process.env.HOME, oldAgent = process.env.PI_CODING_AGENT_DIR;
process.env.HOME = join(sandbox, "home"); process.env.PI_CODING_AGENT_DIR = join(sandbox, "agent");
await mkdir(process.env.HOME); await mkdir(process.env.PI_CODING_AGENT_DIR);
after(async () => {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgent;
  await rm(sandbox, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url);
const { allowedSubagentTools, isSubagentToolPolicy, createSubagentToolPolicyExtension, subagentToolPolicy, subagentToolExclusions } = await jiti.import("./subagent-tool-policy.ts");
const { readSubagentSessionResources, SUBAGENT_META_TYPE } = await jiti.import("./subagents.ts");
const source = (path, source = "auto", origin = "top-level") => ({ path, source, origin, scope: "user" });
const a = { path: "/extensions/allowed.ts", sourceInfo: source("/extensions/allowed.ts"), tools: new Map([["same", {}]]) };
const b = { path: "/extensions/denied.ts", sourceInfo: source("/extensions/denied.ts"), tools: new Map([["same", {}]]) };
const policy = (selectors, deny = []) => ({ mode: selectors === undefined ? "implicitAll" : "selectors", selectors: selectors ?? [], deny });

test("actual source winner, unknown source, reserved and builtin exclusions fail closed", () => {
  const tools = [
    { name: "same", sourceInfo: b.sourceInfo },
    { name: "unknown", sourceInfo: source("/not-loaded.ts") },
    { name: "Agent", sourceInfo: a.sourceInfo },
    { name: "bash", sourceInfo: a.sourceInfo },
    { name: "read", sourceInfo: source("builtin:read", "builtin") },
  ];
  assert.deepEqual([...allowedSubagentTools(["read"], policy(["ext:allowed"]), tools, [a, b])], ["read"]);
  assert.deepEqual([...allowedSubagentTools([], policy(undefined, ["ext:denied"]), tools, [a, b])], []);
  assert.deepEqual([...allowedSubagentTools([], policy(["ext:denied"], ["ext:denied"]), tools, [a, b])], []);
  assert.deepEqual([...allowedSubagentTools([], policy([]), tools, [a, b])], []);
  assert.deepEqual([...allowedSubagentTools([], policy(undefined), tools, [a, b])], ["same"]);
  assert.ok(subagentToolExclusions(["read"]).includes("powershell"));
});

test("winner uses existing scoped aliases, longest match, case and ambiguity rules", () => {
  const extensions = [
    { path: "/a/pkg/index.ts", sourceInfo: source("/a/pkg/index.ts", "npm:@a/pkg@1.0.0", "package"), tools: new Map() },
    { path: "/b/pkg/index.ts", sourceInfo: source("/b/pkg/index.ts", "npm:@b/pkg@1.0.0", "package"), tools: new Map() },
  ];
  const tools = [{ name: "Search", sourceInfo: extensions[0].sourceInfo }];
  assert.deepEqual([...allowedSubagentTools([], policy(["ext:pkg"]), tools, extensions)], []);
  assert.deepEqual([...allowedSubagentTools([], policy(["EXT:@A/PKG/Search"]), tools, extensions)], ["Search"]);
  assert.deepEqual([...allowedSubagentTools([], policy(["ext:@a/pkg/search"]), tools, extensions)], []);
  assert.deepEqual([...allowedSubagentTools([], policy(["ext:@a/pkg/Search"], ["ext:@a/pkg"]), tools, extensions)], []);
});

test("policy factory shares predicate, never activates inactive tools, and errors block nested execution", () => {
  const handlers = {}, tools = [{ name: "same", sourceInfo: b.sourceInfo }];
  let active = ["same"], broken = false;
  const pi = { on(name, fn) { handlers[name] = fn; }, getActiveTools: () => active, setActiveTools(names) { active = names; }, getAllTools() { if (broken) throw Error("bad source"); return tools; } };
  createSubagentToolPolicyExtension([], policy(["ext:allowed"]), () => [a, b])(pi);
  for (const boundary of ["session_start", "before_agent_start", "turn_start", "turn_end"]) {
    active = ["same"]; handlers[boundary](); assert.deepEqual(active, []);
  }
  assert.equal(handlers.tool_call({ toolName: "same", parentToolCallId: "parent" }).block, true);
  broken = true;
  assert.equal(handlers.tool_call({ toolName: "same" }).block, true);
  active = ["same"]; handlers.turn_start(); assert.deepEqual(active, []);
  assert.deepEqual(subagentToolPolicy({ loadExtensions: true, extensionTools: [] }), { mode: "none", selectors: [], deny: [] });
});

test("v2 snapshots strictly validate policy and frozen builtins; v1 is not promoted", () => {
  const entries = (snapshot) => [{ type: "custom", customType: SUBAGENT_META_TYPE, data: { version: 1, parentSessionId: "p", parentSessionPath: "/p", resourceSnapshot: snapshot } }];
  const snapshot = { version: 2, builtinTools: ["powershell"], toolPolicy: policy(["ext:allowed"]), loadExtensions: true, loadSkills: false, extensions: ["allowed"], appendSystemPrompt: ["frozen"] };
  assert.equal(readSubagentSessionResources(entries(snapshot)).version, 2);
  for (const toolPolicy of [null, {}, { ...policy(), mode: "ALL" }, { ...policy(), selectors: ["ext:*"] }, { ...policy([]), deny: [3] }, { ...policy([]), extra: true }, { ...policy([]), selectors: ["ext: "] }]) {
    assert.equal(isSubagentToolPolicy(toolPolicy), false);
    assert.equal(readSubagentSessionResources(entries({ ...snapshot, toolPolicy })), null);
  }
  for (const changes of [{ builtinTools: undefined }, { toolPolicy: undefined }, { builtinTools: ["browser_mock"] }, { builtinTools: ["Agent"] }, { loadExtensions: false }, { loadSkills: undefined }, { extensions: {} }, { exactSystemPrompt: false }]) assert.equal(readSubagentSessionResources(entries({ ...snapshot, ...changes })), null);
  const snapshotV1 = { version: 1, tools: ["read"], appendSystemPrompt: [], loadExtensions: true, loadSkills: false };
  const persistedV1 = entries(snapshotV1), originalV1 = structuredClone(persistedV1);
  const legacy = readSubagentSessionResources(persistedV1);
  assert.deepEqual(legacy, { version: 1, tools: ["read"], appendSystemPrompt: [], loadExtensions: true, loadSkills: false });
  assert.deepEqual(persistedV1, originalV1, "reading never migrates or widens persisted legacy authority");
});
