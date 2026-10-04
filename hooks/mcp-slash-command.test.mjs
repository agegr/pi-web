import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { bareMcpOpensSettings } from "../lib/mcp-command.ts";

// A bare /mcp opens Settings › MCP when pi's built-in MCP extension owns it, or
// when the session has no /mcp at all (ADR 0006, lib/mcp-command.ts). These tests
// run the hook's own callbacks, taken from its source, against stubbed state.

const read = async (path) => (await readFile(new URL(path, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const hookSource = await read("./useAgentSession.ts");
const chatWindowSource = await read("../components/ChatWindow.tsx");
const appShellSource = await read("../components/AppShell.tsx");
const hookFile = ts.createSourceFile("useAgentSession.ts", hookSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** The function a `const <name> = useCallback(fn, deps)` declaration wraps, as JavaScript. */
function callbackSource(name) {
  let found;
  const visit = (node) => {
    if (found) return;
    if (
      ts.isVariableDeclaration(node)
      && node.name.getText(hookFile) === name
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && node.initializer.expression.getText(hookFile) === "useCallback"
    ) {
      found = node.initializer.arguments[0];
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(hookFile);
  assert.ok(found, `useCallback ${name} not found`);
  return ts.transpileModule(`(${found.getText(hookFile)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.trim().replace(/;$/, "");
}

const CALLBACKS = ["replaceSlashCommands", "clearSlashCommands", "requestSlashCommands", "slashCommandsForMcp", "handleBuiltinSlashCommand"];
const compiled = Object.fromEntries(CALLBACKS.map((name) => [
  name,
  // The callbacks read hook state as free variables; `with` resolves them from the scope.
  new Function("scope", `with (scope) { return ${callbackSource(name)}; }`),
]));

const builtinMcp = { name: "mcp", source: "extension", sourceInfo: { path: "builtin:mcp", source: "builtin", scope: "temporary", origin: "top-level" } };
const otherMcp = { name: "mcp", source: "extension", sourceInfo: { path: "/home/me/.pi/agent/extensions/mcp-adapter.ts", source: "local", scope: "user", origin: "top-level" } };
const deploy = { name: "deploy", source: "extension", sourceInfo: { path: "/project/.pi/extensions/deploy.ts", source: "local", scope: "project", origin: "top-level" } };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function hook({ commands = [], pending = null, getCommands = async () => ({ commands: [] }), openSettings = true } = {}) {
  const calls = { notices: [], opened: [], requests: [], lists: [], errors: [], loading: [] };
  const scope = {
    sessionIdRef: { current: "session-1" },
    ensureNewSession: async () => "session-1",
    addNotice: (notice) => calls.notices.push(notice),
    onOpenSettings: openSettings ? (section) => calls.opened.push(section) : undefined,
    bareMcpOpensSettings,
    slashCommandsRef: { current: commands },
    slashCommandsLoadRef: { current: pending },
    slashCommandsGenerationRef: { current: 0 },
    setSlashCommands: (list) => calls.lists.push(list),
    setSlashCommandsLoading: (loading) => calls.loading.push(loading),
    sendAgentCommand: async (sid, command) => {
      calls.requests.push(command.type);
      return getCommands();
    },
    setIsCompacting: () => {},
    console: { error: (...args) => calls.errors.push(args) },
  };
  for (const name of CALLBACKS) scope[name] = compiled[name](scope);
  return { run: scope.handleBuiltinSlashCommand, scope, calls };
}

test("a bare /mcp the built-in owns opens Settings › MCP with no notice and no request", async () => {
  const { run, calls } = hook({ commands: [deploy, builtinMcp] });
  assert.deepEqual(await run("/mcp"), { handled: true, action: "openSettings" });
  assert.deepEqual(calls.opened, ["mcp"]);
  // complete() says nothing for a command that opens a panel.
  assert.deepEqual(calls.notices, []);
  assert.deepEqual(calls.requests, []);
});

test("another extension's /mcp is sent as before", async () => {
  const { run, calls } = hook({ commands: [deploy, otherMcp] });
  assert.deepEqual(await run("/mcp"), { handled: false });
  assert.deepEqual(calls.opened, []);
  assert.deepEqual(calls.notices, []);
});

test("with several extensions' mcp:1 / mcp:2, a bare /mcp opens Settings and /mcp:1 is sent", async () => {
  // pi runs neither for a bare /mcp (it looks commands up by exact name), so sending it would
  // hand the model the text "/mcp"; Settings › MCP says which extensions took the name.
  const commands = [{ ...otherMcp, name: "mcp:1" }, { ...otherMcp, name: "mcp:2" }];
  const bare = hook({ commands });
  assert.deepEqual(await bare.run("/mcp"), { handled: true, action: "openSettings" });
  assert.deepEqual(bare.calls.opened, ["mcp"]);
  const numbered = hook({ commands });
  assert.deepEqual(await numbered.run("/mcp:1"), { handled: false });
  assert.deepEqual(numbered.calls.opened, []);
});

test("every /mcp subcommand is sent, without asking whose /mcp it is", async () => {
  for (const message of ["/mcp login docs", "/mcp logout", "/mcp reconnect", "/mcp   login"]) {
    const { run, calls } = hook({ commands: [] });
    assert.deepEqual(await run(message), { handled: false }, message);
    assert.deepEqual(calls.opened, []);
    assert.deepEqual(calls.requests, []);
  }
});

test("a command list still loading is awaited, not guessed", async () => {
  // The palette asks for the list as "/mcp" is typed; Enter often comes first.
  const load = deferred();
  const { run, calls } = hook({ commands: [], pending: load.promise });
  let settled = false;
  const result = run("/mcp").then((value) => { settled = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(calls.opened, []);
  load.resolve([builtinMcp]);
  assert.deepEqual(await result, { handled: true, action: "openSettings" });
  assert.deepEqual(calls.opened, ["mcp"]);
  assert.deepEqual(calls.requests, [], "the request under way is reused");

  const other = deferred();
  const second = hook({ commands: [], pending: other.promise });
  const sent = second.run("/mcp");
  other.resolve([otherMcp]);
  assert.deepEqual(await sent, { handled: false });

  // A request under way wins over an older list, which a reload may have outdated.
  const fresh = deferred();
  const third = hook({ commands: [otherMcp], pending: fresh.promise });
  const opened = third.run("/mcp");
  fresh.resolve([builtinMcp]);
  assert.deepEqual(await opened, { handled: true, action: "openSettings" });
});

test("with no list yet, /mcp asks for one and keeps it", async () => {
  const { run, scope, calls } = hook({ getCommands: async () => ({ commands: [builtinMcp] }) });
  assert.deepEqual(await run("/mcp"), { handled: true, action: "openSettings" });
  assert.deepEqual(calls.requests, ["get_commands"]);
  // The ref mirrors the state the palette renders.
  assert.deepEqual(scope.slashCommandsRef.current, [builtinMcp]);
  assert.deepEqual(calls.lists, [[builtinMcp]]);
  assert.equal(scope.slashCommandsLoadRef.current, null);

  // A Chat-only session (or MCP turned off) lists no /mcp at all.
  const chatOnly = hook({ getCommands: async () => ({ commands: [] }) });
  assert.deepEqual(await chatOnly.run("/mcp"), { handled: true, action: "openSettings" });
  assert.deepEqual(chatOnly.calls.requests, ["get_commands"]);
});

test("a list that cannot be read sends /mcp as before", async () => {
  const failing = hook({ getCommands: async () => { throw new Error("HTTP 500"); } });
  assert.deepEqual(await failing.run("/mcp"), { handled: false });
  assert.deepEqual(failing.calls.opened, []);
  assert.deepEqual(failing.calls.notices, []);
  assert.equal(failing.calls.errors.length, 1);

  // A failed refresh falls back to the list already loaded.
  const refresh = deferred();
  const known = hook({ commands: [builtinMcp], pending: refresh.promise });
  const result = known.run("/mcp");
  refresh.resolve(null);
  assert.deepEqual(await result, { handled: true, action: "openSettings" });
});

test("a list cleared by set_tools is not written back by a request it outdated", async () => {
  // Another extension's /mcp, then a switch to Chat only while the palette's request runs.
  const answer = deferred();
  const { run, scope, calls } = hook({ getCommands: () => answer.promise });
  const outdated = scope.requestSlashCommands();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.requests, ["get_commands"]);
  scope.clearSlashCommands();
  assert.equal(scope.slashCommandsLoadRef.current, null, "the next reader asks again");
  answer.resolve({ commands: [otherMcp] });
  assert.deepEqual(await outdated, [otherMcp]);
  assert.deepEqual(scope.slashCommandsRef.current, [], "the cleared list stays cleared");
  assert.deepEqual(calls.lists, [[]]);
  assert.equal(calls.loading.at(-1), false, "nothing newer is loading, so the palette stops waiting");

  // The next bare /mcp asks the session as it is now: Chat only lists no /mcp.
  scope.sendAgentCommand = async (sid, command) => {
    calls.requests.push(command.type);
    return { commands: [] };
  };
  assert.deepEqual(await run("/mcp"), { handled: true, action: "openSettings" });
  assert.deepEqual(calls.requests, ["get_commands", "get_commands"]);
});

test("an older request answering after a newer one does not overwrite it", async () => {
  const answers = [deferred(), deferred()];
  const { scope, calls } = hook();
  let next = 0;
  scope.sendAgentCommand = async () => answers[next++].promise;
  const older = scope.requestSlashCommands();
  const newer = scope.requestSlashCommands();
  await new Promise((resolve) => setImmediate(resolve));
  answers[1].resolve({ commands: [builtinMcp] });
  await newer;
  assert.deepEqual(scope.slashCommandsRef.current, [builtinMcp]);
  answers[0].resolve({ commands: [otherMcp] });
  await older;
  assert.deepEqual(scope.slashCommandsRef.current, [builtinMcp]);
  assert.deepEqual(calls.lists, [[builtinMcp]]);
  assert.equal(scope.slashCommandsLoadRef.current, null);
});

test("without a way to open Settings, /mcp is sent", async () => {
  const { run, calls } = hook({ commands: [builtinMcp], openSettings: false });
  assert.deepEqual(await run("/mcp"), { handled: false });
  assert.deepEqual(calls.requests, []);
});

test("the /mcp case returns before anything a prompt does, and the list ref has one writer", () => {
  const mcpCase = hookSource
    .slice(hookSource.indexOf('        case "mcp": {'), hookSource.indexOf('        case "copy": {'))
    .replace(/^\s*\/\/.*$/gm, "");
  assert.match(mcpCase, /onOpenSettings\("mcp"\)/);
  assert.doesNotMatch(mcpCase, /promoteNewSession|sendAgentCommand|setMessages|onSend/);
  // set_tools clears the list through the same writer, so a cleared list is never read as loaded.
  assert.equal(hookSource.match(/\bsetSlashCommands\(/g).length, 1);
  assert.match(hookSource, /clearSlashCommands\(\);\n\s+setExtensionStatuses\(\[\]\)/);
});

test("AppShell opens Settings on the section the chat asks for", () => {
  assert.match(chatWindowSource, /onOpenSettings\?: \(section: SettingsSection\) => void;/);
  assert.match(chatWindowSource, /onSessionStatsPanelOpen,\n\s+onOpenSettings,\n\s+deferInitialScroll/);
  assert.match(appShellSource, /const openSettingsSection = useCallback\(\(section: SettingsSection\) => \{\n\s+setSettingsSection\(section\);/);
  assert.match(appShellSource, /onOpenSettings=\{openSettingsSection\}/);
});
