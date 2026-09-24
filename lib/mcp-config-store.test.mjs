import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const root = await mkdtemp(join(tmpdir(), "pi-web-mcp-store-"));
const agentDir = join(root, "agent");
const cwd = join(root, "project");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
await mkdir(agentDir, { recursive: true });
await mkdir(join(cwd, ".pi"), { recursive: true });

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const store = await jiti.import("./mcp-config-store.ts");

const globalPath = join(agentDir, "mcp.json");
const projectPath = join(cwd, ".pi", "mcp.json");

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

async function resetConfigFiles() {
  await rm(globalPath, { force: true });
  await rm(projectPath, { force: true });
}

async function writeGlobal(contents) {
  await writeFile(globalPath, JSON.stringify(contents));
}

async function writeProject(contents) {
  await writeFile(projectPath, JSON.stringify(contents));
}

test("returns nothing when no config file exists", async () => {
  await resetConfigFiles();
  const snapshot = store.readMcpServers(cwd, agentDir);
  assert.deepEqual(snapshot.servers, []);
  assert.deepEqual(snapshot.diagnostics, []);
});

test("reads global and project servers with their scope and path", async () => {
  await resetConfigFiles();
  await writeGlobal({ mcpServers: { filesystem: { command: "npx", args: ["-y", "fs"] } } });
  await writeProject({ mcpServers: { repo: { url: "https://example.com/mcp" } } });

  const snapshot = store.readMcpServers(cwd, agentDir);
  assert.deepEqual(snapshot.servers, [
    {
      name: "filesystem",
      scope: "global",
      config: { command: "npx", args: ["-y", "fs"] },
      path: globalPath,
    },
    {
      name: "repo",
      scope: "project",
      config: { url: "https://example.com/mcp" },
      path: projectPath,
    },
  ]);
  assert.deepEqual(snapshot.diagnostics, []);
});

test("reports malformed JSON and still reads the other file", async () => {
  await resetConfigFiles();
  await writeFile(globalPath, "{ not json");
  await writeProject({ mcpServers: { ok: { command: "ok" } } });

  const snapshot = store.readMcpServers(cwd, agentDir);
  assert.equal(snapshot.diagnostics.length, 1);
  assert.equal(snapshot.diagnostics[0].path, globalPath);
  assert.deepEqual(snapshot.servers.map((server) => server.name), ["ok"]);
});

test("reports a non-object mcpServers value", async () => {
  await resetConfigFiles();
  await writeGlobal({ mcpServers: [] });

  const snapshot = store.readMcpServers(cwd, agentDir);
  assert.deepEqual(snapshot.diagnostics, [
    { path: globalPath, message: '"mcpServers" must be an object' },
  ]);
  assert.deepEqual(snapshot.servers, []);
});

test("keeps good servers when a sibling entry is invalid", async () => {
  await resetConfigFiles();
  await writeGlobal({ mcpServers: { good: { command: "good" }, bad: "nope" } });

  const snapshot = store.readMcpServers(cwd, agentDir);
  assert.deepEqual(snapshot.servers.map((server) => server.name), ["good"]);
  assert.deepEqual(snapshot.diagnostics, [
    { path: globalPath, message: 'server "bad" must be an object' },
  ]);
});

test("creates the global config file on first save", async () => {
  await resetConfigFiles();
  const error = store.saveMcpServer("global", cwd, "filesystem", { command: "npx", args: ["-y", "fs"] });

  assert.equal(error, undefined);
  const written = JSON.parse(await readFile(globalPath, "utf8"));
  assert.deepEqual(written, { mcpServers: { filesystem: { command: "npx", args: ["-y", "fs"] } } });
});

test("writes project servers to <cwd>/.pi/mcp.json", async () => {
  await resetConfigFiles();
  store.saveMcpServer("project", cwd, "repo", { command: "node", args: ["server.mjs"] });

  const written = JSON.parse(await readFile(projectPath, "utf8"));
  assert.deepEqual(written.mcpServers.repo, { command: "node", args: ["server.mjs"] });
});

test("preserves unknown top-level and server-level keys", async () => {
  await resetConfigFiles();
  await writeGlobal({
    mcpServers: { filesystem: { command: "npx", futureField: true } },
    unknownTopLevel: { keep: "me" },
  });

  store.saveMcpServer("global", cwd, "filesystem", { command: "node", args: ["a"] });
  const written = JSON.parse(await readFile(globalPath, "utf8"));

  assert.deepEqual(written.unknownTopLevel, { keep: "me" });
  // The merged entry keeps the field this app does not own.
  assert.equal(written.mcpServers.filesystem.futureField, true);
  assert.equal(written.mcpServers.filesystem.command, "node");
  assert.deepEqual(written.mcpServers.filesystem.args, ["a"]);
});

test("rejects a config with both transports", async () => {
  await resetConfigFiles();
  const error = store.saveMcpServer("global", cwd, "both", { command: "npx", url: "https://example.com/mcp" });
  assert.match(error ?? "", /not both/);
});

test("rejects a config with no transport", async () => {
  await resetConfigFiles();
  assert.match(store.saveMcpServer("global", cwd, "none", {}) ?? "", /command/);
});

test("rejects a non-http url", async () => {
  await resetConfigFiles();
  assert.match(store.saveMcpServer("global", cwd, "bad", { url: "ftp://example.com" }) ?? "", /http/);
});

test("rejects malformed args and env", async () => {
  await resetConfigFiles();
  assert.match(store.saveMcpServer("global", cwd, "a", { command: "x", args: [1] }) ?? "", /args/);
  assert.match(store.saveMcpServer("global", cwd, "b", { command: "x", env: { A: 1 } }) ?? "", /env/);
});

test("drops unknown config keys instead of writing them", async () => {
  await resetConfigFiles();
  store.saveMcpServer("global", cwd, "fs", { command: "npx", injected: "should-not-persist" });

  const written = JSON.parse(await readFile(globalPath, "utf8"));
  assert.deepEqual(written.mcpServers.fs, { command: "npx" });
});

test("removes one server and keeps the rest", async () => {
  await resetConfigFiles();
  await writeGlobal({ mcpServers: { a: { command: "a" }, b: { command: "b" } } });

  assert.equal(store.removeMcpServer("global", cwd, "a"), true);
  const written = JSON.parse(await readFile(globalPath, "utf8"));
  assert.deepEqual(Object.keys(written.mcpServers), ["b"]);
});

test("reports a missing server on remove", async () => {
  await resetConfigFiles();
  assert.equal(store.removeMcpServer("global", cwd, "absent"), false);
});

test("validates server names", () => {
  assert.equal(store.validateServerName("filesystem"), undefined);
  assert.equal(store.validateServerName("my-server_1.0"), undefined);
  assert.match(store.validateServerName("") ?? "", /required/);
  assert.match(store.validateServerName("  ") ?? "", /required/);
  assert.match(store.validateServerName("has space") ?? "", /letters/);
  assert.match(store.validateServerName("a".repeat(65)) ?? "", /64/);
  assert.match(store.validateServerName(undefined) ?? "", /required/);
});
