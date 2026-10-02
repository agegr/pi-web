import assert from "node:assert/strict";
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile, chmod } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import lockfile from "proper-lockfile";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  editMcpConfigFile,
  insertMcpServer,
  isMcpConfigWriteError,
  removeMcpServer,
  setMcpServersEnabled,
} = await jiti.import("./mcp-config-file.ts");
const { PROJECT_MCP_CONFIG_MAX_BYTES } = await jiti.import("./mcp-config-read.ts");
const { loadPiSdkInternals } = await jiti.import("./pi-sdk-internals.ts");

const internals = await loadPiSdkInternals();
assert.equal(internals.ok, true, internals.reason);

const posix = process.platform !== "win32";

async function fixture(t) {
  // Real paths, so the paths reported compare equal on macOS, whose temp folder is a link.
  const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-web-mcp-config-file-")));
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(join(cwd, ".pi"), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    agentDir,
    cwd,
    globalPath: join(agentDir, "mcp.json"),
    projectPath: join(cwd, ".pi", "mcp.json"),
    global: { scope: "global", agentDir },
    project: (allowedRoots = new Set([cwd])) => ({ scope: "project", cwd, allowedRoots }),
  };
}

async function refusal(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(isMcpConfigWriteError(error), `expected a typed refusal, got ${error}`);
    return error;
  }
  assert.fail("the write was not refused");
}

// Every shape of file the SDK's editor reads differently: indentation taken
// from the first indented line (none gives two spaces), CRLF line ends, no
// trailing newline, unknown keys at both levels, and `enabled` / `exposure`
// already set in the middle of an entry.
const FIXTURES = {
  "two spaces, no trailing newline": JSON.stringify({
    $schema: "https://example.com/mcp.schema.json",
    mcpServers: {
      docs: { url: "https://docs.example.com/mcp", headers: { Authorization: "Bearer ${DOCS_TOKEN}" } },
      lint: { command: "npx", args: ["-y", "lint-mcp"], enabled: true, env: { DEBUG: "1" }, "x-note": "kept" },
      off: { command: "node", enabled: false, exposure: "direct" },
    },
    autoEnableCodemode: false,
    other: [1, { nested: true }],
  }, null, 2),
  "four spaces and a trailing newline": `${JSON.stringify({
    mcpServers: {
      docs: { url: "https://docs.example.com/mcp", exposure: "codemode" },
      lint: { command: "npx", args: ["a", "b"] },
      off: { enabled: false, command: "node" },
    },
  }, null, 4)}\n`,
  tabs: JSON.stringify({ mcpServers: { docs: { url: "https://d/mcp" }, lint: { command: "x" }, off: { command: "y", enabled: false } } }, null, "\t"),
  "one line": JSON.stringify({ mcpServers: { docs: { url: "https://d/mcp" }, lint: { command: "x" }, off: { command: "y", enabled: false } } }),
  "CRLF and three spaces": JSON.stringify({ mcpServers: { docs: { url: "https://d/mcp" }, lint: { command: "x", "ü": "✓ " }, off: { command: "y", enabled: false } } }, null, 3)
    .replace(/\n/g, "\r\n"),
};

const OPERATIONS = [
  {
    name: "turn lint off",
    sdk: (path) => internals.updateMcpServerConfig(path, "lint", { enabled: false }),
    ours: (target) => setMcpServersEnabled(target, ["lint"], false),
  },
  {
    name: "turn off back on",
    sdk: (path) => internals.updateMcpServerConfig(path, "off", { enabled: true }),
    ours: (target) => setMcpServersEnabled(target, ["off"], true),
  },
  {
    name: "remove docs",
    sdk: (path) => internals.removeMcpServerConfig(path, "docs"),
    ours: (target) => removeMcpServer(target, "docs"),
  },
  {
    name: "add a server",
    sdk: (path) => internals.addMcpServerConfig(path, "added", { command: "node", args: ["s.js"], env: { A: "$$literal" } }),
    ours: (target) => insertMcpServer(target, "added", { command: "node", args: ["s.js"], env: { A: "$$literal" } }),
  },
];

test("every edit writes exactly the bytes the SDK's own editor writes", async (t) => {
  const { root, globalPath, global } = await fixture(t);
  const sdkPath = join(root, "sdk.json");
  for (const [fixtureName, text] of Object.entries(FIXTURES)) {
    for (const operation of OPERATIONS) {
      await writeFile(globalPath, text);
      await writeFile(sdkPath, text);
      operation.sdk(sdkPath);
      const result = await operation.ours(global);
      assert.equal(result.written, true, `${fixtureName}: ${operation.name} wrote`);
      assert.equal(await readFile(globalPath, "utf8"), await readFile(sdkPath, "utf8"), `${fixtureName}: ${operation.name}`);
    }
  }
});

test("a file without mcpServers, or none at all, is created as the SDK creates it", async (t) => {
  const { root, globalPath, global } = await fixture(t);
  const sdkPath = join(root, "sdk.json");
  const entry = { url: "https://x/mcp" };

  await writeFile(globalPath, JSON.stringify({ autoEnableCodemode: true }, null, 4));
  await copyFile(globalPath, sdkPath);
  internals.addMcpServerConfig(sdkPath, "x", entry);
  await insertMcpServer(global, "x", entry);
  assert.equal(await readFile(globalPath, "utf8"), await readFile(sdkPath, "utf8"));

  await rm(globalPath);
  await rm(sdkPath);
  internals.addMcpServerConfig(sdkPath, "x", entry);
  await insertMcpServer(global, "x", entry);
  assert.equal(await readFile(globalPath, "utf8"), await readFile(sdkPath, "utf8"));
  assert.equal(await readFile(globalPath, "utf8"), '{\n  "mcpServers": {\n    "x": {\n      "url": "https://x/mcp"\n    }\n  }\n}\n');
});

test("an edit that changes nothing leaves the file's bytes alone", async (t) => {
  const { globalPath, global } = await fixture(t);
  const text = '{"mcpServers":{"a":{"command":"x"},  "b":{"command":"y","enabled":false}}}';
  await writeFile(globalPath, text);
  const on = await setMcpServersEnabled(global, ["a"], true);
  const off = await setMcpServersEnabled(global, ["b"], false);
  assert.deepEqual([on.written, off.written], [false, false]);
  assert.deepEqual(on.value, [{ name: "a", outcome: "unchanged" }]);
  assert.equal(await readFile(globalPath, "utf8"), text);
});

test("several servers switch in one write, each with its own outcome", async (t) => {
  const { globalPath, global } = await fixture(t);
  await writeFile(globalPath, JSON.stringify({ mcpServers: { a: { command: "x" }, b: { command: "y", enabled: false }, pw: { command: "z" } } }));
  const { value, written } = await setMcpServersEnabled(
    global,
    ["a", "b", "gone", "pw", "a"],
    false,
    (name) => (name === "pw" ? "web-password" : undefined),
  );
  assert.equal(written, true);
  assert.deepEqual(value, [
    { name: "a", outcome: "changed" },
    { name: "b", outcome: "unchanged" },
    { name: "gone", outcome: "missing" },
    { name: "pw", outcome: "refused", reason: "web-password" },
  ]);
  const servers = JSON.parse(await readFile(globalPath, "utf8")).mcpServers;
  assert.deepEqual(servers, { a: { command: "x", enabled: false }, b: { command: "y", enabled: false }, pw: { command: "z" } });
});

test("an entry that is not an object is never switched, only told apart from a missing one, and can be removed", async (t) => {
  const { globalPath, global } = await fixture(t);
  const original = `${JSON.stringify({ mcpServers: { text: "oops", nothing: null, list: [1], ok: { command: "x" } } }, null, 2)}\n`;
  await writeFile(globalPath, original);
  for (const enabled of [false, true]) {
    const { value, written } = await setMcpServersEnabled(global, ["text", "nothing", "list", "gone"], enabled);
    assert.equal(written, false);
    assert.deepEqual(value, [
      { name: "text", outcome: "not-an-object" },
      { name: "nothing", outcome: "not-an-object" },
      { name: "list", outcome: "not-an-object" },
      { name: "gone", outcome: "missing" },
    ]);
  }
  assert.equal(await readFile(globalPath, "utf8"), original);
  // Beside one that switches, the write still happens, and leaves the odd entry as it was.
  const { value } = await setMcpServersEnabled(global, ["text", "ok"], false);
  assert.deepEqual(value, [{ name: "text", outcome: "not-an-object" }, { name: "ok", outcome: "changed" }]);
  assert.deepEqual(JSON.parse(await readFile(globalPath, "utf8")).mcpServers, { text: "oops", nothing: null, list: [1], ok: { command: "x", enabled: false } });
  // Remove takes it out like any entry, and undo can put it back.
  const removed = await removeMcpServer(global, "nothing");
  assert.deepEqual(removed.value, { entry: null, index: 1 });
  await insertMcpServer(global, "nothing", null, 1);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(globalPath, "utf8")).mcpServers), ["text", "nothing", "list", "ok"]);
});

test("a file that cannot be parsed is refused and left untouched, without quoting it", async (t) => {
  const { globalPath, global } = await fixture(t);
  const broken = "{\n  \"mcpServers\": { \"a\": { \"env\": { \"TOKEN\": 'ghp_abcdefghijklmnop' } } }\n}\n";
  await writeFile(globalPath, broken);
  const error = await refusal(setMcpServersEnabled(global, ["a"], false));
  assert.equal(error.reason, "unparsable");
  assert.equal(error.path, globalPath);
  assert.doesNotMatch(error.message, /ghp_/);
  assert.equal(await readFile(globalPath, "utf8"), broken);

  for (const shape of ['["not an object"]', '{"mcpServers": []}', '{"mcpServers": "x"}']) {
    await writeFile(globalPath, shape);
    assert.equal((await refusal(removeMcpServer(global, "a"))).reason, "invalid-shape", shape);
    assert.equal(await readFile(globalPath, "utf8"), shape);
  }
  // A byte-order mark is a syntax error for the SDK too.
  await writeFile(globalPath, '﻿{"mcpServers":{}}');
  assert.equal((await refusal(insertMcpServer(global, "a", { command: "x" }))).reason, "unparsable");
  assert.deepEqual((await readdir(join(globalPath, ".."))).sort(), ["mcp.json"], "no temporary file or lock is left behind");
});

test("removing or switching a server the file does not define is refused; adding a defined name is too", async (t) => {
  const { globalPath, global } = await fixture(t);
  await writeFile(globalPath, JSON.stringify({ mcpServers: { a: { command: "x" } } }));
  const missing = await refusal(removeMcpServer(global, "b"));
  assert.deepEqual([missing.reason, missing.serverName, missing.path], ["server-missing", "b", globalPath]);
  const taken = await refusal(insertMcpServer(global, "a", { command: "y" }));
  assert.deepEqual([taken.reason, taken.serverName], ["name-taken", "a"]);
  assert.deepEqual(JSON.parse(await readFile(globalPath, "utf8")), { mcpServers: { a: { command: "x" } } });
  // A file that does not exist defines nothing, and nothing is created to say so.
  await rm(globalPath);
  assert.equal((await refusal(removeMcpServer(global, "a"))).reason, "server-missing");
  const { value } = await setMcpServersEnabled(global, ["a"], false);
  assert.deepEqual(value, [{ name: "a", outcome: "missing" }]);
  assert.deepEqual(await readdir(join(globalPath, "..")), []);
});

test("a server named after an Object.prototype key is a key like any other", async (t) => {
  const { globalPath, global } = await fixture(t);
  await writeFile(globalPath, '{"mcpServers":{"a":{"command":"x"}}}');
  for (const name of ["__proto__", "constructor", "toString"]) {
    const { value } = await setMcpServersEnabled(global, [name], false);
    assert.deepEqual(value, [{ name, outcome: "missing" }]);
    assert.equal((await refusal(removeMcpServer(global, name))).reason, "server-missing");
  }
  assert.equal({}.enabled, undefined, "Object.prototype was never written");
  await insertMcpServer(global, "__proto__", { command: "proto" });
  assert.match(await readFile(globalPath, "utf8"), /"__proto__": \{\n\s+"command": "proto"/);
  await setMcpServersEnabled(global, ["__proto__"], false);
  const text = await readFile(globalPath, "utf8");
  assert.match(text, /"__proto__": \{\n\s+"command": "proto",\n\s+"enabled": false/);
  assert.equal({}.enabled, undefined);
  const { value } = await removeMcpServer(global, "__proto__");
  assert.deepEqual(value, { entry: { command: "proto", enabled: false }, index: 1 });
  assert.deepEqual(Object.keys(JSON.parse(await readFile(globalPath, "utf8")).mcpServers), ["a"]);
});

test("a removed entry goes back where it stood", async (t) => {
  const { globalPath, global } = await fixture(t);
  const original = `${JSON.stringify({ mcpServers: { a: { command: "a" }, b: { command: "b", enabled: false }, c: { command: "c" } }, after: true }, null, 2)}\n`;
  await writeFile(globalPath, original);
  const { value } = await removeMcpServer(global, "b");
  assert.deepEqual(value, { entry: { command: "b", enabled: false }, index: 1 });
  await insertMcpServer(global, "b", value.entry, value.index);
  assert.equal(await readFile(globalPath, "utf8"), original);
  // Past the end, it is appended.
  const last = await removeMcpServer(global, "c");
  await removeMcpServer(global, "a");
  await insertMcpServer(global, "c", last.value.entry, last.value.index);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(globalPath, "utf8")).mcpServers), ["b", "c"]);
});

test("the global file is written 0600, through a link that stays a link, a dangling one too", { skip: !posix }, async (t) => {
  const { root, agentDir, globalPath, global } = await fixture(t);
  await writeFile(globalPath, JSON.stringify({ mcpServers: { a: { command: "x" } } }), { mode: 0o644 });
  await chmod(globalPath, 0o644);
  await setMcpServersEnabled(global, ["a"], false);
  assert.equal((await stat(globalPath)).mode & 0o777, 0o600, "a file that may hold literal secrets is private");

  // A dotfiles setup: the link is written through and stays a link.
  const dotfiles = join(root, "dotfiles");
  await mkdir(dotfiles);
  await rm(globalPath);
  await writeFile(join(dotfiles, "mcp.json"), JSON.stringify({ mcpServers: { a: { command: "x" } } }));
  await symlink(join(dotfiles, "mcp.json"), globalPath);
  const { realPath } = await setMcpServersEnabled(global, ["a"], false);
  assert.equal(realPath, join(dotfiles, "mcp.json"));
  assert.ok((await lstat(globalPath)).isSymbolicLink(), "the link is still a link");
  assert.equal(JSON.parse(await readFile(join(dotfiles, "mcp.json"), "utf8")).mcpServers.a.enabled, false);
  assert.equal((await stat(join(dotfiles, "mcp.json"))).mode & 0o777, 0o600);
  assert.deepEqual((await readdir(dotfiles)).sort(), ["mcp.json"], "the temporary file was renamed in the real folder");

  // A link to a file that does not exist yet: the file it names is created.
  await rm(globalPath);
  await symlink(join(dotfiles, "new", "mcp.json"), globalPath);
  await insertMcpServer(global, "b", { url: "https://b/mcp" });
  assert.ok((await lstat(globalPath)).isSymbolicLink());
  assert.deepEqual(JSON.parse(await readFile(join(dotfiles, "new", "mcp.json"), "utf8")), { mcpServers: { b: { url: "https://b/mcp" } } });

  // A missing agent folder is created private.
  const fresh = join(root, "fresh-agent");
  await insertMcpServer({ scope: "global", agentDir: fresh }, "c", { command: "c" });
  assert.equal((await stat(fresh)).mode & 0o777, 0o700);
  assert.equal((await stat(join(fresh, "mcp.json"))).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(agentDir), ["mcp.json"]);
});

test("a project file keeps its mode, and a new one is 0644", { skip: !posix }, async (t) => {
  const { cwd, projectPath, project } = await fixture(t);
  await writeFile(projectPath, JSON.stringify({ mcpServers: { a: { command: "x" } } }));
  await chmod(projectPath, 0o664);
  await setMcpServersEnabled(project(), ["a"], false);
  assert.equal((await stat(projectPath)).mode & 0o777, 0o664, "a committed file keeps its mode");

  await rm(join(cwd, ".pi"), { recursive: true });
  await insertMcpServer(project(), "b", { command: "b" });
  assert.equal((await stat(projectPath)).mode & 0o777, 0o644);
  assert.deepEqual(JSON.parse(await readFile(projectPath, "utf8")), { mcpServers: { b: { command: "b" } } });
});

test("a project file is written only where the reader's link rule lets it be read", { skip: !posix }, async (t) => {
  const { root, cwd, projectPath, project } = await fixture(t);
  const outside = join(root, "outside.json");
  const outsideText = JSON.stringify({ mcpServers: { a: { command: "x" } } });
  await writeFile(outside, outsideText);

  // A link outside the allowed roots is refused, and its target never touched.
  await symlink(outside, projectPath);
  const linkOutside = await refusal(setMcpServersEnabled(project(), ["a"], false));
  assert.deepEqual([linkOutside.reason, linkOutside.path], ["link-outside", projectPath]);
  assert.equal(await readFile(outside, "utf8"), outsideText);
  // Once that folder is allowed too, the link is written through and stays a link.
  await setMcpServersEnabled(project(new Set([cwd, root])), ["a"], false);
  assert.ok((await lstat(projectPath)).isSymbolicLink());
  assert.equal(JSON.parse(await readFile(outside, "utf8")).mcpServers.a.enabled, false);
  await rm(projectPath);

  // A dangling link is refused rather than taken for a missing file, so nothing is created at its target.
  await symlink(join(root, "planted.json"), projectPath);
  assert.equal((await refusal(insertMcpServer(project(), "b", { command: "b" }))).reason, "link-dangling");
  await assert.rejects(stat(join(root, "planted.json")));
  await rm(projectPath);

  // The same for a .pi folder that is a link: outside the roots, or to nothing.
  await rm(join(cwd, ".pi"), { recursive: true });
  await mkdir(join(root, "elsewhere"));
  await symlink(join(root, "elsewhere"), join(cwd, ".pi"));
  assert.equal((await refusal(insertMcpServer(project(), "b", { command: "b" }))).reason, "link-outside");
  assert.deepEqual(await readdir(join(root, "elsewhere")), []);
  await rm(join(cwd, ".pi"));
  await symlink(join(root, "nowhere"), join(cwd, ".pi"));
  assert.equal((await refusal(insertMcpServer(project(), "b", { command: "b" }))).reason, "link-dangling");
  await assert.rejects(stat(join(root, "nowhere")));
  await rm(join(cwd, ".pi"));
  await mkdir(join(cwd, ".pi"));

  // Not a regular file, or larger than the reader parses.
  await mkdir(projectPath);
  assert.equal((await refusal(setMcpServersEnabled(project(), ["a"], false))).reason, "not-a-file");
  await rm(projectPath, { recursive: true });
  await writeFile(projectPath, `{"mcpServers":{}}${" ".repeat(PROJECT_MCP_CONFIG_MAX_BYTES)}`);
  assert.equal((await refusal(setMcpServersEnabled(project(), ["a"], false))).reason, "too-large");
});

test("concurrent writes are serialized, so none is lost", async (t) => {
  const { globalPath, global } = await fixture(t);
  await writeFile(globalPath, '{"mcpServers":{}}');
  const names = Array.from({ length: 25 }, (_, index) => `s${index}`);
  await Promise.all(names.map((name) => insertMcpServer(global, name, { command: name })));
  assert.deepEqual(Object.keys(JSON.parse(await readFile(globalPath, "utf8")).mcpServers).sort(), [...names].sort());
  await Promise.all(names.map((name, index) => setMcpServersEnabled(global, [name], index % 2 === 0)));
  const servers = JSON.parse(await readFile(globalPath, "utf8")).mcpServers;
  for (const [index, name] of names.entries()) assert.equal(servers[name].enabled, index % 2 === 0 ? undefined : false, name);
  // A refused edit does not stall the queue behind it.
  await Promise.all([
    refusal(removeMcpServer(global, "missing")),
    removeMcpServer(global, "s0"),
  ]);
  assert.equal(JSON.parse(await readFile(globalPath, "utf8")).mcpServers.s0, undefined);
});

test("a write waits for another process's lock on the same file", async (t) => {
  const { globalPath, global } = await fixture(t);
  await writeFile(globalPath, '{"mcpServers":{"a":{"command":"x"}}}');
  const release = await lockfile.lock(globalPath, { realpath: false });
  let done = false;
  const write = setMcpServersEnabled(global, ["a"], false).then((result) => {
    done = true;
    return result;
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(done, false, "the write waits while the lock is held");
  assert.equal(await readFile(globalPath, "utf8"), '{"mcpServers":{"a":{"command":"x"}}}');
  await release();
  assert.equal((await write).written, true);
  assert.equal(JSON.parse(await readFile(globalPath, "utf8")).mcpServers.a.enabled, false);
});

test("an edit's own refusal writes nothing", async (t) => {
  const { globalPath, global } = await fixture(t);
  const text = '{"mcpServers":{"a":{"command":"x"}}}';
  await writeFile(globalPath, text);
  await assert.rejects(editMcpConfigFile(global, ({ servers }) => {
    servers.a.enabled = false;
    throw new Error("changed my mind");
  }), /changed my mind/);
  assert.equal(await readFile(globalPath, "utf8"), text);
});
