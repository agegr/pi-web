import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

register("./test-ts-resolve-hook.mjs", import.meta.url);

const {
  getMcpServerStatus,
  getMcpServerToolCounts,
  getProjectMcpPath,
  isValidMcpServerName,
  loadMcpServerList,
  normalizeMcpServerPart,
  setMcpServerDisabled,
} = await import("./mcp-servers.ts");

function createTempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-mcp-"));
  t.after(() => {
    delete process.env.PI_CODING_AGENT_DIR;
    fs.rmSync(home, { recursive: true, force: true });
  });
  delete process.env.PI_PACKAGE_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(home, ".pi", "agent");
  return home;
}

function writeGlobal(home, servers) {
  const dir = process.env.PI_CODING_AGENT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "mcp.json"), JSON.stringify({ mcpServers: servers }, null, 2));
}

function writeProject(cwd, servers) {
  const dir = path.join(cwd, ".pi");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "mcp.json"), JSON.stringify({ mcpServers: servers }, null, 2));
}

function createCwd(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-mcp-cwd-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

test("validates server names conservatively", () => {
  assert.equal(isValidMcpServerName("tavily"), true);
  assert.equal(isValidMcpServerName("my-server_2"), true);
  assert.equal(isValidMcpServerName(""), false);
  assert.equal(isValidMcpServerName("../evil"), false);
  assert.equal(isValidMcpServerName("a/b"), false);
  assert.equal(isValidMcpServerName("a.b"), false);
  assert.equal(isValidMcpServerName("x".repeat(129)), false);
});

test("merges global and project configs with project winning", (t) => {
  const home = createTempHome(t);
  void home;
  const cwd = createCwd(t);
  writeGlobal(home, {
    tavily: { url: "https://mcp.tavily.com/mcp/?key=secret" },
    elevenlabs: { command: "uvx", args: ["elevenlabs-mcp"], disabled: true },
  });
  writeProject(cwd, {
    tavily: { disabled: true },
    local: { command: "node", args: ["server.js"] },
  });

  const list = loadMcpServerList(cwd);
  assert.deepEqual(list.servers.map((s) => s.name), ["elevenlabs", "local", "tavily"]);
  const byName = Object.fromEntries(list.servers.map((s) => [s.name, s]));
  assert.equal(byName.tavily.disabled, true);
  assert.equal(byName.tavily.source, "project");
  assert.equal(byName.tavily.overridden, true);
  assert.equal(byName.elevenlabs.disabled, true);
  assert.equal(byName.elevenlabs.source, "global");
  assert.equal(byName.elevenlabs.overridden, false);
  assert.equal(byName.local.disabled, false);
  assert.equal(byName.local.source, "project");
  assert.equal(list.projectPath, getProjectMcpPath(cwd));
  assert.equal(list.projectFileExists, true);
});

test("redacts secrets from transport details", (t) => {
  const home = createTempHome(t);
  void home;
  const cwd = createCwd(t);
  writeGlobal(home, {
    keyed: { url: "http://192.168.1.50:18080/mcp?key=pw" },
    stdio: { command: "uvx", args: ["elevenlabs-mcp", "--token", "secret"] },
    odd: { something: "else" },
  });

  const list = loadMcpServerList(cwd);
  const byName = Object.fromEntries(list.servers.map((s) => [s.name, s]));
  assert.equal(byName.keyed.transport, "http");
  assert.ok(!byName.keyed.detail.includes("key=pw"), `leaks query: ${byName.keyed.detail}`);
  assert.ok(byName.keyed.detail.includes("192.168.1.50"), byName.keyed.detail);
  assert.equal(byName.stdio.transport, "stdio");
  assert.equal(byName.stdio.detail, "uvx");
  assert.equal(byName.odd.transport, "unknown");
});

test("disabling creates a project entry preserving other keys", (t) => {
  createTempHome(t);
  const cwd = createCwd(t);
  writeProject(cwd, { tavily: { url: "https://example.com/mcp" } });

  const result = setMcpServerDisabled(cwd, "tavily", true);
  assert.equal(result.changed, true);
  const list = loadMcpServerList(cwd);
  const entry = list.servers.find((s) => s.name === "tavily");
  assert.equal(entry.disabled, true);
  const raw = JSON.parse(fs.readFileSync(path.join(cwd, ".pi", "mcp.json"), "utf8"));
  assert.equal(raw.mcpServers.tavily.url, "https://example.com/mcp");
  assert.equal(raw.mcpServers.tavily.disabled, true);
});

test("disabling twice is a no-op", (t) => {
  createTempHome(t);
  const cwd = createCwd(t);
  writeProject(cwd, { tavily: { disabled: true } });
  assert.deepEqual(setMcpServerDisabled(cwd, "tavily", true), {
    changed: false,
    path: getProjectMcpPath(cwd),
  });
});

test("enabling removes the flag and drops empty entries", (t) => {
  createTempHome(t);
  const cwd = createCwd(t);
  writeProject(cwd, { tavily: { disabled: true } });

  assert.equal(setMcpServerDisabled(cwd, "tavily", true).changed, false);
  const result = setMcpServerDisabled(cwd, "tavily", false);
  assert.equal(result.changed, true);
  const raw = JSON.parse(fs.readFileSync(path.join(cwd, ".pi", "mcp.json"), "utf8"));
  assert.ok(!("tavily" in raw.mcpServers));
});

test("enabling writes explicit false when the global config disables the server", (t) => {
  const home = createTempHome(t);
  void home;
  const cwd = createCwd(t);
  writeGlobal(home, { elevenlabs: { command: "uvx", disabled: true } });

  const result = setMcpServerDisabled(cwd, "elevenlabs", false);
  assert.equal(result.changed, true);
  const raw = JSON.parse(fs.readFileSync(path.join(cwd, ".pi", "mcp.json"), "utf8"));
  assert.equal(raw.mcpServers.elevenlabs.disabled, false);
  assert.equal(loadMcpServerList(cwd).servers.find((s) => s.name === "elevenlabs").disabled, false);
});

test("rejects invalid names and malformed files", (t) => {
  createTempHome(t);
  const cwd = createCwd(t);
  assert.throws(() => setMcpServerDisabled(cwd, "../x", true), /Invalid server name/);
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".pi", "mcp.json"), "{nope");
  assert.throws(() => loadMcpServerList(cwd), /Cannot parse/);
});

test("matches live tools by adapter naming", () => {
  const tools = [
    { name: "tavily_tavily_search", active: true },
    { name: "tavily_tavily_extract", active: false },
    { name: "mcp__ahk", active: true },
    { name: "ahk_MouseClick", active: true },
    { name: "my_server_ping", active: true },
    { name: "read", active: true },
  ];
  assert.deepEqual(getMcpServerToolCounts(tools, "tavily"), { active: 1, total: 2 });
  assert.deepEqual(getMcpServerToolCounts(tools, "ahk"), { active: 2, total: 2 });
  assert.deepEqual(getMcpServerToolCounts(tools, "my-server"), { active: 1, total: 1 });
  assert.deepEqual(getMcpServerToolCounts(tools, "missing"), { active: 0, total: 0 });
  assert.deepEqual(getMcpServerToolCounts(null, "tavily"), { active: 0, total: 0 });
  assert.equal(normalizeMcpServerPart("my-server"), "my_server");
});

test("derives status from config and counts", () => {
  assert.equal(getMcpServerStatus({ disabled: true }, { active: 5, total: 5 }), "disabled");
  assert.equal(getMcpServerStatus({ disabled: false }, { active: 2, total: 3 }), "active");
  assert.equal(getMcpServerStatus({ disabled: false }, { active: 0, total: 3 }), "inactive");
  assert.equal(getMcpServerStatus({ disabled: false }, { active: 0, total: 0 }), "not-loaded");
});
