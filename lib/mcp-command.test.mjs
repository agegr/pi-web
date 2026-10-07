import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  bareMcpOpensSettings,
  isBareMcpCommand,
  isBuiltinMcpCommand,
  isMcpExtensionCommand,
  MCP_COMMAND_NAME,
  MCP_EXTENSION_PATH,
  mcpPromptPreparation,
} from "./mcp-command.ts";

const builtin = { name: "mcp", source: "extension", sourceInfo: { path: "builtin:mcp", source: "builtin" } };
const thirdParty = { name: "mcp", source: "extension", sourceInfo: { path: "/home/me/.pi/agent/extensions/mcp-adapter/index.ts" } };
const unrelated = { name: "deploy", source: "extension", sourceInfo: { path: "/project/.pi/extensions/deploy.ts" } };

test("the built-in /mcp is the one named mcp that pi's built-in MCP extension registered", () => {
  assert.equal(MCP_EXTENSION_PATH, "builtin:mcp");
  assert.equal(MCP_COMMAND_NAME, "mcp");
  assert.equal(isBuiltinMcpCommand(builtin), true);
  // pi.getCommands() in the host carries the same fields; a test double may omit `source`.
  assert.equal(isBuiltinMcpCommand({ name: "mcp", sourceInfo: { path: "builtin:mcp" } }), true);
  assert.equal(isBuiltinMcpCommand(thirdParty), false);
  assert.equal(isBuiltinMcpCommand({ name: "mcp" }), false);
  // Another built-in command is not /mcp, and neither is a renamed copy of it.
  assert.equal(isBuiltinMcpCommand({ name: "mcp:1", source: "extension", sourceInfo: { path: "builtin:mcp" } }), false);
});

test("only /mcp on its own is a bare /mcp", () => {
  assert.equal(isBareMcpCommand("/mcp"), true);
  assert.equal(isBareMcpCommand("  /mcp \n"), true);
  assert.equal(isBareMcpCommand("/mcp login docs"), false);
  assert.equal(isBareMcpCommand("/mcp reconnect"), false);
  assert.equal(isBareMcpCommand("/mcp:1"), false);
  assert.equal(isBareMcpCommand("/MCP"), false);
  assert.equal(isBareMcpCommand("/mc"), false);
  assert.equal(isBareMcpCommand("mcp"), false);
});

test("a bare /mcp opens Settings when the built-in owns it or nothing answers to it", () => {
  assert.equal(bareMcpOpensSettings([unrelated, builtin]), true);
  // MCP off, -builtin:mcp, or a Chat-only session (which loads no extensions at all).
  assert.equal(bareMcpOpensSettings([unrelated]), true);
  assert.equal(bareMcpOpensSettings([]), true);
  // Skills never take the name: pi lists them as skill:<name>.
  assert.equal(bareMcpOpensSettings([{ name: "skill:mcp", source: "skill", sourceInfo: { path: "/skills/mcp/SKILL.md" } }]), true);
  // The built-in command runs before pi expands a prompt template of the same name.
  assert.equal(bareMcpOpensSettings([builtin, { name: "mcp", source: "prompt", sourceInfo: { path: "/p/mcp.md" } }]), true);
  // Several extensions' /mcp are named mcp:1, mcp:2, …, and pi looks a command up by its exact
  // name, so a bare /mcp would run neither and reach the model as text
  // (lib/builtin-extensions.integration.test.mjs runs one).
  assert.equal(bareMcpOpensSettings([
    { ...thirdParty, name: "mcp:1" },
    { ...thirdParty, name: "mcp:2", sourceInfo: { path: "/other/mcp.ts" } },
  ]), true);
  // Nor does a prompt template file named mcp:1.md answer /mcp.
  assert.equal(bareMcpOpensSettings([{ name: "mcp:1", source: "prompt", sourceInfo: { path: "/p/mcp:1.md" } }]), true);
});

test("another extension's /mcp, or a prompt template named mcp, keep the message", () => {
  assert.equal(bareMcpOpensSettings([unrelated, thirdParty]), false);
  // With no extension /mcp, pi expands the template.
  assert.equal(bareMcpOpensSettings([{ name: "mcp", source: "prompt", sourceInfo: { path: "/project/.pi/prompts/mcp.md" } }]), false);
});

test("the MCP host's owner is an extension's /mcp, also when pi renamed several of them", () => {
  assert.equal(isMcpExtensionCommand(builtin), true);
  assert.equal(isMcpExtensionCommand(thirdParty), true);
  assert.equal(isMcpExtensionCommand({ ...thirdParty, name: "mcp:1" }), true);
  assert.equal(isMcpExtensionCommand({ ...thirdParty, name: "mcp:12" }), true);
  // The host's test doubles list commands without a source.
  assert.equal(isMcpExtensionCommand({ name: "mcp:2", sourceInfo: { path: "/other/mcp.ts" } }), true);
  // A prompt template is nobody's /mcp: under -builtin:mcp it would be reported as the owner.
  assert.equal(isMcpExtensionCommand({ name: "mcp", source: "prompt", sourceInfo: { path: "/p/mcp.md" } }), false);
  assert.equal(isMcpExtensionCommand({ name: "mcp:1", source: "prompt", sourceInfo: { path: "/p/mcp:1.md" } }), false);
  for (const name of ["mcp:", "mcp:x", "mcp-tools", "skill:mcp", "deploy"]) {
    assert.equal(isMcpExtensionCommand({ ...thirdParty, name }), false, name);
  }
});

test("a prompt waits for MCP servers unless it is an extension command, and the built-in /mcp only registers them", () => {
  const commands = [builtin, unrelated];
  // Text, a prompt template or a skill may start a run.
  assert.equal(mcpPromptPreparation("hello", commands), "wait");
  assert.equal(mcpPromptPreparation("/review this", commands), "wait");
  assert.equal(mcpPromptPreparation("/skill:pdf read it", commands), "wait");
  // pi reads a command only from a leading `/`, and its name up to the first space.
  assert.equal(mcpPromptPreparation(" /deploy", commands), "wait");
  assert.equal(mcpPromptPreparation("/deploy\tnow", commands), "wait");
  // Another extension's command starts no run and needs no MCP server.
  assert.equal(mcpPromptPreparation("/deploy", commands), "none");
  assert.equal(mcpPromptPreparation("/deploy now", commands), "none");
  // The built-in /mcp acts on the registered servers, so they are registered, but not waited for.
  assert.equal(mcpPromptPreparation("/mcp", commands), "register");
  assert.equal(mcpPromptPreparation("/mcp login docs", commands), "register");
  // Another extension's /mcp, or several renamed ones, are that extension's business.
  assert.equal(mcpPromptPreparation("/mcp login docs", [thirdParty]), "none");
  assert.equal(mcpPromptPreparation("/mcp:1 status", [{ ...thirdParty, name: "mcp:1" }, { ...builtin, name: "mcp:2" }]), "none");
  // With no extension answering /mcp, pi sends it to the model.
  assert.equal(mcpPromptPreparation("/mcp", [unrelated]), "wait");
});

test("the MCP host and the read-only policy read the shared constant, not their own copy", async () => {
  for (const file of ["./mcp-host.ts", "./mcp-read-only-policy.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /from "\.\/mcp-command"/, file);
    assert.doesNotMatch(source, /"builtin:mcp"/, file);
  }
  const host = await readFile(new URL("./mcp-host.ts", import.meta.url), "utf8");
  assert.match(host, /const commands = pi\.getCommands\(\)\.filter\(isMcpExtensionCommand\);\n\s*this\.active = commands\.some\(isBuiltinMcpCommand\);/);
});
