import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  createMcpExtensionConfigLoader,
  isMcpDisabledByOperator,
  mcpRuntimeFromInternals,
  peekCodemodeSandbox,
  readBuiltinExtensionSwitches,
  runCodemodeSelfTest,
} = await jiti.import("./builtin-extensions.ts");
const { loadPiSdkInternals } = await jiti.import("./pi-sdk-internals.ts");

test("PI_WEB_DISABLE_MCP turns MCP off for any value but empty, 0, or false", () => {
  assert.equal(isMcpDisabledByOperator({}), false);
  for (const value of ["", " ", "0", "false", "FALSE"]) {
    assert.equal(isMcpDisabledByOperator({ PI_WEB_DISABLE_MCP: value }), false, JSON.stringify(value));
  }
  for (const value of ["1", "true", "yes", "on"]) {
    assert.equal(isMcpDisabledByOperator({ PI_WEB_DISABLE_MCP: value }), true, value);
  }
});

test("MCP is available only when the operator allows it and the internals loaded", () => {
  const internals = { ok: true, packageDir: "/sdk" };
  assert.deepEqual(mcpRuntimeFromInternals(internals, {}), { available: true, internals });
  assert.deepEqual(
    mcpRuntimeFromInternals(internals, { PI_WEB_DISABLE_MCP: "1" }),
    { available: false, reason: "PI_WEB_DISABLE_MCP is set" },
  );
  // The operator's switch is reported first: it is the one that would still apply after a fix.
  assert.deepEqual(
    mcpRuntimeFromInternals({ ok: false, reason: "moved" }, { PI_WEB_DISABLE_MCP: "1" }),
    { available: false, reason: "PI_WEB_DISABLE_MCP is set" },
  );
  assert.deepEqual(
    mcpRuntimeFromInternals({ ok: false, reason: "dist/extensions/mcp/runtime.js moved" }, {}),
    { available: false, reason: "dist/extensions/mcp/runtime.js moved" },
  );
});

test("the codemode self-test runs a script in the SDK's sandbox", async () => {
  assert.deepEqual(await runCodemodeSelfTest(), { available: true });
});

function definitionReturning(execute) {
  return async () => ({ name: "codemode", execute });
}

test("the codemode self-test reports a sandbox that fails, answers wrong, or hangs", async () => {
  assert.deepEqual(
    await runCodemodeSelfTest({
      createDefinition: async () => {
        throw new Error("Cannot find module quickjs.wasm");
      },
    }),
    { available: false, reason: "Cannot find module quickjs.wasm" },
  );

  assert.deepEqual(
    await runCodemodeSelfTest({
      createDefinition: definitionReturning(async () => ({
        content: [{ type: "text", text: "Script failed\n" }, { type: "text", text: "Script error:\nworker exited" }],
        isError: true,
      })),
    }),
    { available: false, reason: "the self-test script failed: Script failed\n Script error:\nworker exited" },
  );

  assert.deepEqual(
    await runCodemodeSelfTest({
      createDefinition: definitionReturning(async () => ({ content: [{ type: "text", text: "undefined" }] })),
    }),
    { available: false, reason: "the self-test script returned \"undefined\"" },
  );

  let signal;
  const hung = await runCodemodeSelfTest({
    timeoutMs: 20,
    createDefinition: definitionReturning((_id, _params, runSignal) => {
      signal = runSignal;
      return new Promise(() => {});
    }),
  });
  assert.deepEqual(hung, { available: false, reason: "the sandbox did not answer within 20 ms" });
  assert.equal(signal.aborted, true, "the script is aborted when the self-test gives up on it");
});

test("the MCP extension gets no servers from mcp.json but keeps autoEnableCodemode, read with fresh trust", async (t) => {
  const internals = await loadPiSdkInternals();
  assert.equal(internals.ok, true, internals.reason);
  const dir = await mkdtemp(join(tmpdir(), "pi-web-mcp-config-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const agentDir = join(dir, "agent");
  const project = join(dir, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(project, ".pi"), { recursive: true });
  await writeFile(join(agentDir, "mcp.json"), JSON.stringify({
    autoEnableCodemode: false,
    mcpServers: { docs: { url: "https://example.com/mcp" } },
  }));
  await writeFile(join(project, ".pi", "mcp.json"), JSON.stringify({
    autoEnableCodemode: true,
    mcpServers: { local: { command: "never-started" } },
  }));

  const load = createMcpExtensionConfigLoader(internals, agentDir);
  // What a wrapper built before the folder required trust keeps reporting; trust is read fresh instead.
  const context = { cwd: project, isProjectTrusted: () => true };
  const trust = new ProjectTrustStore(agentDir);
  assert.deepEqual(load(context), { servers: [], errors: [], autoEnableCodemode: false }, "no decision yet");
  // A trusted project's value overrides the global one, as in the CLI.
  trust.set(project, true);
  assert.deepEqual(load(context), { servers: [], errors: [], autoEnableCodemode: true });
  trust.set(project, false);
  assert.deepEqual(load(context), { servers: [], errors: [], autoEnableCodemode: false });
  // Inherited from a trusted parent.
  trust.set(project, null);
  trust.set(dir, true);
  assert.deepEqual(load(context), { servers: [], errors: [], autoEnableCodemode: true });
  // A caller may supply its own read.
  const untrusted = createMcpExtensionConfigLoader(internals, agentDir, () => false);
  assert.deepEqual(untrusted(context), { servers: [], errors: [], autoEnableCodemode: false });
  // A folder that needs no trust has no project file, so the SDK is told not to read one: a file
  // landing between the trust read and the SDK's own read is never read without a decision,
  // even under a trusted parent.
  const fresh = join(dir, "fresh");
  await mkdir(fresh);
  const asked = [];
  const recording = createMcpExtensionConfigLoader({
    loadMcpConfig: (options) => {
      asked.push(options.projectTrusted);
      return { servers: [], errors: [] };
    },
  }, agentDir);
  recording({ cwd: fresh, isProjectTrusted: () => true });
  assert.deepEqual(asked, [false]);

  await writeFile(join(agentDir, "mcp.json"), "{ not json");
  await writeFile(join(project, ".pi", "mcp.json"), "{}");
  assert.deepEqual(load(context), { servers: [], errors: [] });

  const throwing = createMcpExtensionConfigLoader({
    loadMcpConfig: () => {
      throw new Error("EACCES");
    },
  }, agentDir);
  assert.deepEqual(throwing(context), { servers: [], errors: [] });
});

test("Settings reads the sandbox self-test's result without ever starting it", async (t) => {
  const key = Symbol.for("pi-web.codemodeSandbox");
  const previous = globalThis[key];
  t.after(() => {
    if (previous === undefined) delete globalThis[key];
    else globalThis[key] = previous;
  });
  delete globalThis[key];
  assert.deepEqual(await peekCodemodeSandbox(), { checked: false });
  assert.equal(globalThis[key], undefined, "peeking started no self-test");

  let settle;
  globalThis[key] = new Promise((resolve) => {
    settle = resolve;
  });
  assert.deepEqual(await peekCodemodeSandbox(), { checked: false }, "still running");
  settle({ available: false, reason: "no wasm" });
  await globalThis[key];
  assert.deepEqual(await peekCodemodeSandbox(), { checked: true, available: false, reason: "no wasm" });
  globalThis[key] = Promise.resolve({ available: true });
  assert.deepEqual(await peekCodemodeSandbox(), { checked: true, available: true });
});

test("the extensions settings switch built-ins off as the session's resource loader would", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-builtin-switches-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const agentDir = join(dir, "agent");
  const cwd = join(dir, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(cwd, ".pi"), { recursive: true });
  const globalPath = join(agentDir, "settings.json");
  const projectPath = join(cwd, ".pi", "settings.json");
  const on = { enabled: true };
  const read = (projectTrusted = true) => readBuiltinExtensionSwitches({ agentDir, cwd, projectTrusted });

  assert.deepEqual(await read(), { codemode: on, "tool-search": on, mcp: on });

  // Never installs: a configured package that is missing is not even looked up.
  await writeFile(globalPath, JSON.stringify({ extensions: ["-builtin:mcp"], packages: ["npm:pi-web-test-not-a-package"] }));
  assert.deepEqual(await read(), { codemode: on, "tool-search": on, mcp: { enabled: false, settingsPath: globalPath } });

  // A trusted project's entry overrides the global one; an untrusted project's is not read. Each
  // switch then also says what the global list alone makes of it, for a global setting to be weighed against.
  await writeFile(projectPath, JSON.stringify({ extensions: ["+builtin:mcp", "-builtin:codemode"] }));
  assert.deepEqual(await read(), {
    codemode: { enabled: false, settingsPath: projectPath, global: on },
    "tool-search": { ...on, global: on },
    mcp: { ...on, global: { enabled: false, settingsPath: globalPath } },
  });
  assert.deepEqual(await read(false), { codemode: on, "tool-search": on, mcp: { enabled: false, settingsPath: globalPath } });
  assert.deepEqual(
    await readBuiltinExtensionSwitches({ agentDir, projectTrusted: true }),
    { codemode: on, "tool-search": on, mcp: { enabled: false, settingsPath: globalPath } },
    "without a project only the global settings count",
  );

  // Patterns follow the SDK's rules, not a string comparison.
  await writeFile(globalPath, `\uFEFF${JSON.stringify({ extensions: ["!builtin:*", "+builtin:tool-search"] })}`);
  await rm(projectPath);
  const off = { enabled: false, settingsPath: globalPath };
  assert.deepEqual(await read(), { codemode: off, "tool-search": on, mcp: off });

  await writeFile(globalPath, "{ not json");
  assert.deepEqual(await read(), { codemode: on, "tool-search": on, mcp: on }, "an unparsable file counts as empty, as in the SDK");
});

test("a trusted project's settings that are not a regular file never stall the switches read", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-builtin-switches-fifo-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const agentDir = join(dir, "agent");
  const cwd = join(dir, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(cwd, ".pi"), { recursive: true });
  const projectPath = join(cwd, ".pi", "settings.json");
  const read = () => readBuiltinExtensionSwitches({ agentDir, cwd, projectTrusted: true });

  // A directory, and a file past the cap, throw as an unreadable file does; the overview then keeps the built-ins on.
  await mkdir(projectPath);
  await assert.rejects(read(), /not a regular file/);
  await rm(projectPath, { recursive: true });
  await writeFile(projectPath, `{"extensions":[],"pad":"${"x".repeat(1024 * 1024)}"}`);
  await assert.rejects(read(), /larger than/);
  if (process.platform !== "win32") {
    // A plain readFileSync() would wait on a FIFO until something writes to it, holding the whole server.
    await rm(projectPath);
    execFileSync("mkfifo", [projectPath]);
    await assert.rejects(read(), /not a regular file/);
    // Untrusted, the project's file is never opened at all.
    assert.deepEqual(
      await readBuiltinExtensionSwitches({ agentDir, cwd, projectTrusted: false }),
      { codemode: { enabled: true }, "tool-search": { enabled: true }, mcp: { enabled: true } },
    );
  }
});
