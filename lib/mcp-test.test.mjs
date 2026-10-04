import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test, { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// A test connects for real, and an OAuth server's test reads and writes
// mcp-auth.json: the agent dir is a temporary folder, never ~/.pi/agent.
const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-web-mcp-test-")));
const agentDir = join(root, "agent");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url);
const { loadPiSdkInternals } = await jiti.import("./pi-sdk-internals.ts");
const {
  MCP_TEST_DEADLINE_MS,
  MCP_TEST_REQUEST_TIMEOUT_MS,
  connectForTest,
  createTestRedactor,
  runsShellCommand,
  testMcpServer,
} = await jiti.import("./mcp-test.ts");
const { clearMcpStatuses, readMcpStatus } = await jiti.import("./mcp-status.ts");
const { mcpSignInKey, noteMcpSignOut } = await jiti.import("./mcp-sign-out.ts");

const internals = await loadPiSdkInternals();
assert.equal(internals.ok, true, internals.reason);

const ENV_FIXTURE = fileURLToPath(new URL("./__fixtures__/mcp-env-server.mjs", import.meta.url));
const HANG_FIXTURE = fileURLToPath(new URL("./__fixtures__/mcp-hang-server.mjs", import.meta.url));

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => clearMcpStatuses());

let counter = 0;
function target(config, overrides = {}) {
  counter += 1;
  return {
    scope: "global",
    name: `server-${counter}`,
    sourcePath: join(agentDir, "mcp.json"),
    configKey: `key-${counter}`,
    config,
    cwd: root,
    ...overrides,
  };
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Kills the fixture whose pid `pidFile` holds, if it is still running: a failed assertion must not leave it behind. */
function killFixture(pidFile) {
  if (!existsSync(pidFile)) return;
  try {
    process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function waitUntilExited(pid, ms = 6_000) {
  for (const started = Date.now(); Date.now() - started < ms && isRunning(pid);) await delay(50);
  return !isRunning(pid);
}

test("a stdio server connects, lists its tools, and never sees PI_WEB_PASSWORD", async () => {
  const envFile = join(root, "env-names.json");
  const previous = process.env.PI_WEB_PASSWORD;
  process.env.PI_WEB_PASSWORD = "web-password";
  try {
    const entry = target({
      command: process.execPath,
      args: [ENV_FIXTURE],
      env: { PI_WEB_FIXTURE_ENV_FILE: envFile },
      toolExposure: { record: "direct" },
    });
    const result = await testMcpServer(entry, internals);
    assert.equal(result.state, "connected", result.error);
    assert.deepEqual(result.tools.map((tool) => [tool.name, tool.readOnly, tool.exposure]), [
      ["env_has", true, "codemode"],
      ["env_get", true, "codemode"],
      ["spawn_child", false, "codemode"],
      ["record", false, "direct"],
    ]);
    assert.equal(result.toolCount, 4);
    assert.equal(result.tools[0].description, "Whether the server's environment defines a variable.");
    assert.deepEqual(result.serverInfo, { name: "pi-web-env-fixture", version: "1.0.0" });
    assert.equal(result.cwd, root);
    assert.equal(result.error, undefined);
    assert.equal(typeof result.durationMs, "number");
    assert.ok(result.testedAt <= Date.now());
    const names = JSON.parse(readFileSync(envFile, "utf8"));
    assert.ok(names.includes("PI_WEB_FIXTURE_ENV_FILE"));
    assert.ok(!names.includes("PI_WEB_PASSWORD"), "the server's environment holds PI_WEB_PASSWORD");
    // The result is the entry's status from now on, for the panel's dots.
    const status = readMcpStatus(entry, entry.configKey);
    assert.equal(status.origin, "test");
    assert.equal(status.state, "connected");
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_PASSWORD;
    else process.env.PI_WEB_PASSWORD = previous;
  }
});

test("a server that cannot start reports the SDK's message, with its stderr tail apart", async () => {
  const result = await testMcpServer(
    target({ command: process.execPath, args: ["-e", "process.stderr.write('cannot start: no config\\n'); process.exit(1)"] }),
    internals,
  );
  assert.equal(result.state, "failed");
  assert.equal(result.stderr, "cannot start: no config");
  assert.ok(result.error && !result.error.includes("cannot start"), result.error);
  assert.deepEqual(result.tools, []);

  // A server that prints a value of its env gets it masked: the browser sees names only.
  const echoed = await testMcpServer(
    target({ command: process.execPath, args: [ENV_FIXTURE], env: { PI_WEB_FIXTURE_FAIL: "literal value it was given" } }),
    internals,
  );
  assert.equal(echoed.state, "failed");
  assert.equal(echoed.stderr, "•••");
});

test("a server's tool fields other than name and schema are read only when they are strings, and it is closed either way", { skip: process.platform === "win32" }, async () => {
  const pidFile = join(root, "odd.pid");
  const result = await testMcpServer(
    target({
      command: process.execPath,
      args: [ENV_FIXTURE],
      env: { PI_WEB_FIXTURE_ODD_TOOLS: "1", PI_WEB_FIXTURE_PID_FILE: pidFile },
      toolExposure: { "to*": "direct" },
    }),
    internals,
  );
  assert.equal(result.state, "connected", result.error);
  assert.deepEqual(result.tools, [
    // A number, an object and a string where an object belongs: nothing to describe.
    { name: "numbered", readOnly: false, exposure: "codemode" },
    // The title's first line; `readOnlyHint: "yes"` is not true.
    { name: "constructor", description: "Builds things", readOnly: false, exposure: "codemode" },
    // Object.prototype names are just names: the `to*` pattern decides, as it would for any other name.
    { name: "toString", readOnly: false, exposure: "direct" },
  ]);
  assert.ok(await waitUntilExited(Number(readFileSync(pidFile, "utf8"))), "the server still runs after its test");
});

test("an oversized error is masked first and then shortened, so no secret is cut in half", async () => {
  const secret = "literal-secret-value-1234";
  const result = await testMcpServer(
    target({ command: process.execPath, args: [ENV_FIXTURE], env: { PI_WEB_FIXTURE_INIT_ERROR: ` ${secret}`, API_TOKEN: secret } }),
    internals,
  );
  assert.equal(result.state, "failed");
  assert.ok(result.error.length <= 2_000, `error of ${result.error.length} characters`);
  assert.match(result.error, /••• •••/);
  // Shortened after masking: the last word is the mask or its ellipsis, never half the secret.
  assert.ok(!result.error.includes("literal"), result.error.slice(-80));
});

test("a server that never answers is stopped at the deadline, and the answer does not wait for it to exit", { skip: process.platform === "win32" }, async (t) => {
  const pidFile = join(root, "hang.pid");
  t.after(() => killFixture(pidFile));
  const started = Date.now();
  // It ignores SIGTERM, so only the SIGKILL 2.5 s after the close ends it.
  const result = await testMcpServer(
    target({ command: process.execPath, args: [HANG_FIXTURE], env: { PI_WEB_FIXTURE_PID_FILE: pidFile, PI_WEB_FIXTURE_IGNORE_TERM: "1" } }),
    internals,
    { deadlineMs: 600, closeWaitMs: 300 },
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 600 + 300 + 700, `answered after ${elapsed} ms`);
  assert.equal(result.state, "failed");
  assert.equal(result.timedOut, true);
  assert.equal(result.stderr, "hang fixture waiting");
  const pid = Number(readFileSync(pidFile, "utf8"));
  assert.ok(await waitUntilExited(pid), `server ${pid} is still running`);
});

test("the hang fixture ends by itself once the test process that started it is gone", { skip: process.platform === "win32" }, async (t) => {
  // An interrupted run (Ctrl-C, a CI timeout) kills the test process but not the fixture, which
  // pi-mcp starts in its own process group and which ignores SIGTERM here.
  const pidFile = join(root, "orphan.pid");
  t.after(() => killFixture(pidFile));
  const launcher = [
    'const { spawn } = require("node:child_process");',
    `const child = spawn(process.execPath, [${JSON.stringify(HANG_FIXTURE)}], { detached: true, stdio: ["pipe", "ignore", "ignore"], env: { ...process.env, PI_WEB_FIXTURE_PID_FILE: ${JSON.stringify(pidFile)}, PI_WEB_FIXTURE_IGNORE_TERM: "1" } });`,
    'child.unref();',
    // Gone before the fixture is: a parent that dies leaves it re-parented.
    `const wait = setInterval(() => { if (require("node:fs").existsSync(${JSON.stringify(pidFile)})) { clearInterval(wait); process.exit(0); } }, 20);`,
  ].join("\n");
  execFileSync(process.execPath, ["-e", launcher], { timeout: 5_000 });
  const pid = Number(readFileSync(pidFile, "utf8"));
  assert.ok(await waitUntilExited(pid, 3_000), `the orphaned fixture ${pid} is still running`);
});

test("each request waits at most the test's request timeout, whatever the entry says", { skip: process.platform === "win32" }, async (t) => {
  assert.equal(MCP_TEST_REQUEST_TIMEOUT_MS, 15_000);
  assert.equal(MCP_TEST_DEADLINE_MS, 20_000);
  const pidFile = join(root, "hang-timeout.pid");
  t.after(() => killFixture(pidFile));
  const started = Date.now();
  const result = await testMcpServer(
    target({ command: process.execPath, args: [HANG_FIXTURE], env: { PI_WEB_FIXTURE_PID_FILE: pidFile }, timeout: 120 }),
    internals,
    { requestTimeoutMs: 300, deadlineMs: 10_000, closeWaitMs: 300 },
  );
  assert.ok(Date.now() - started < 3_000);
  // The request timed out, not the deadline.
  assert.equal(result.state, "failed");
  assert.equal(result.timedOut, undefined);
  assert.match(result.error, /time/i);
  assert.ok(await waitUntilExited(Number(readFileSync(pidFile, "utf8"))));
});

test("an HTTP server that answers 401 with a challenge needs a sign-in", async (t) => {
  const http = createServer((request, response) => {
    request.resume();
    response.writeHead(401, {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="http://127.0.0.1:${http.address().port}/.well-known/oauth-protected-resource"`,
    });
    response.end(JSON.stringify({ error: "unauthorized" }));
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => http.close(resolve)));
  const entry = target({ url: `http://127.0.0.1:${http.address().port}/mcp` }, { name: "oauth" });
  const result = await testMcpServer(entry, internals);
  assert.equal(result.state, "needs-auth", result.error);
  assert.equal(result.error, undefined);
  assert.equal(result.cwd, undefined, "only a stdio server runs in a folder");
  assert.equal(readMcpStatus(entry, entry.configKey).state, "needs-auth");
  // The OAuth state lives in the agent dir the test points at, as a session's does.
  assert.ok((await readdir(agentDir)).includes("mcp-auth.json"));
});

test("a failing !command is named by its field, never by its text", async () => {
  const command = "pi-web-no-such-command-secret-text";
  const config = { command: process.execPath, args: [ENV_FIXTURE], env: { TOKEN: `!${command}` } };
  assert.equal(runsShellCommand(config, internals), true);
  const result = await testMcpServer(target(config), internals);
  assert.equal(result.state, "failed");
  assert.match(result.error, /env "TOKEN"/);
  assert.ok(!result.error.includes(command), result.error);
  assert.match(result.error, /•••/);
});

test("a !command's text is masked where the SDK quotes it, and its words never garble other words", () => {
  const redact = (config, text) => createTestRedactor(config, [], internals)(text);
  const header = { url: "https://api.example.com/mcp", headers: { Authorization: "!gh auth token" } };
  assert.equal(
    redact(header, 'MCP server "gh" header "Authorization": Failed to resolve header from shell command: gh auth token'),
    'MCP server "gh" header "Authorization": Failed to resolve header from shell command: •••',
  );
  assert.equal(redact(header, "MCP server requires authentication"), "MCP server requires authentication");
  const env = { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "!cat ~/.config/gh-token" } };
  assert.equal(redact(env, "Error: Cannot locate application config; category missing"), "Error: Cannot locate application config; category missing");
  assert.equal(redact(env, 'env "GITHUB_TOKEN" from shell command: cat ~/.config/gh-token'), 'env "GITHUB_TOKEN" from shell command: •••');
  // A command that shares words with the SDK's own message leaves them readable.
  const words = { command: "server", env: { TOKEN: "!pass show the token for MCP server" } };
  assert.equal(
    redact(words, 'Failed to resolve MCP server "x" env "TOKEN" from shell command: pass show the token for MCP server'),
    'Failed to resolve MCP server "x" env "TOKEN" from shell command: •••',
  );
  // A short command is masked where it is quoted, and nowhere else.
  const short = { command: "server", env: { TOKEN: "!env" } };
  assert.equal(
    redact(short, 'Failed to resolve env "TOKEN" from shell command: env\nthe environment is empty'),
    'Failed to resolve env "TOKEN" from shell command: •••\nthe environment is empty',
  );
});

test("URL and argument secrets are masked where a message quotes them on their own", () => {
  const redact = (config, text) => createTestRedactor(config, [], internals)(text);
  const query = { url: "https://mcp.example.com/mcp?api_key=sk-live-abcdef1234567890" };
  assert.equal(
    redact(query, "status 403: invalid api key sk-live-abcdef1234567890 for https://mcp.example.com/mcp?api_key=sk-live-abcdef1234567890"),
    "status 403: invalid api key ••• for https://mcp.example.com/mcp?api_key=•••",
  );
  // `new URL()` adds the `/` of an empty path, and a message may quote that spelling.
  const normalized = { url: "https://mcp.example.com?token=abcdefghijk123456" };
  assert.equal(redact(normalized, "connect to https://mcp.example.com/?token=abcdefghijk123456 failed"), "connect to https://mcp.example.com/?token=••• failed");
  const userinfo = { url: "https://user:hunter2secret@mcp.example.com/mcp" };
  assert.equal(redact(userinfo, "password hunter2secret rejected"), "password ••• rejected");
  const args = { command: "server", args: ["--api-key=sk-abcdefghijklmnopqrstuvwx", "--token", "tok-123456789"] };
  assert.equal(redact(args, "invalid key sk-abcdefghijklmnopqrstuvwx, token tok-123456789"), "invalid key •••, token •••");
});

test("literal values, what references resolved to, and URL and argument secrets are masked in messages", () => {
  const http = createTestRedactor(
    {
      url: "https://mcp.example.com/mcp?token=query-secret-1234567890",
      headers: { Authorization: "Bearer literal-header-secret", "X-Key": "${API_KEY}", "X-Run": "!op read op://vault/key" },
      oauth: { clientId: "id", clientSecret: "literal-client-secret" },
    },
    [{ options: { headers: { Authorization: "Bearer literal-header-secret", "X-Key": "resolved-api-key-value", "X-Run": "resolved-command-output" } } }],
    internals,
  );
  const text = [
    "Bearer literal-header-secret",
    "token literal-header-secret",
    "key resolved-api-key-value",
    "out resolved-command-output",
    "cmd op read op://vault/key",
    "secret literal-client-secret",
    "url https://mcp.example.com/mcp?token=query-secret-1234567890",
    "reference ${API_KEY}",
  ].join("\n");
  const masked = http(text);
  for (const secret of ["literal-header-secret", "resolved-api-key-value", "resolved-command-output", "op read op://vault/key", "literal-client-secret", "query-secret-1234567890"]) {
    assert.ok(!masked.includes(secret), `${secret} in ${masked}`);
  }
  assert.match(masked, /reference \$\{API_KEY\}/, "a reference names where a secret lives and stays");
  assert.match(masked, /url https:\/\/mcp\.example\.com\/mcp\?token=/);

  const stdio = createTestRedactor(
    { command: "server", args: ["--api-key=sk-abcdefghijklmnopqrstuvwx", "--verbose"], env: { MODE: "production-mode", SHORT: "1", REF: "${HOME}" } },
    [{ options: { env: { MODE: "production-mode", SHORT: "1", REF: "/home/someone", PATH: "/usr/bin:/bin" } } }],
    internals,
  );
  const shown = stdio("--api-key=sk-abcdefghijklmnopqrstuvwx --verbose production-mode 1 /home/someone /usr/bin:/bin");
  assert.ok(!shown.includes("sk-abcdefghijklmnopqrstuvwx"), shown);
  assert.ok(!shown.includes("production-mode"), shown);
  assert.ok(!shown.includes("/home/someone"), shown);
  // Too short to be a secret, and the host's own environment is not the entry's.
  assert.match(shown, / 1 /);
  assert.match(shown, /\/usr\/bin:\/bin$/);
  assert.match(shown, /--verbose/);
});

/** A connect stand-in that records when it ran and waits `ms` or for the abort. */
function recordingConnect(log, ms = 80) {
  return async (entry, signal) => {
    log.push(`start ${entry.name}`);
    await Promise.race([delay(ms), new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))]);
    log.push(`end ${entry.name}`);
    return signal.aborted
      ? { state: "failed", timedOut: true, tools: [], toolCount: 0, durationMs: ms }
      : { state: "connected", tools: [], toolCount: 0, durationMs: ms };
  };
}

test("tests of entries that run a shell command run one at a time; others run alongside", async () => {
  const log = [];
  const connect = recordingConnect(log);
  const command = (name) => target({ command: "server", env: { TOKEN: "!pass show token" } }, { name });
  const header = target({ url: "https://h.example/mcp", headers: { Authorization: "!pass show h" } }, { name: "header" });
  const secret = target({ url: "https://s.example/mcp", oauth: { clientSecret: "!pass show s" } }, { name: "secret" });
  const plain = target({ command: "server", env: { TOKEN: "${TOKEN}" } }, { name: "plain" });
  for (const entry of [command("a"), header, secret]) assert.equal(runsShellCommand(entry.config, internals), true, entry.name);
  assert.equal(runsShellCommand(plain.config, internals), false);
  // An env value on an HTTP entry is never resolved, so it runs nothing.
  assert.equal(runsShellCommand({ url: "https://x.example/mcp", env: { X: "!echo" } }, internals), false);

  const results = await Promise.all([
    testMcpServer(command("a"), internals, { connect }),
    testMcpServer(command("b"), internals, { connect }),
    testMcpServer(plain, internals, { connect }),
  ]);
  const at = (line) => log.indexOf(line);
  assert.equal(log.length, 6);
  assert.ok(at("start b") > at("end a"), `b started before a ended: ${log}`);
  assert.ok(at("start plain") < at("end a"), `plain waited for a: ${log}`);
  // queuedMs is a wall-clock delta: a test with nobody ahead can still cross a millisecond
  // boundary on a loaded machine, and the panel shows a wait only from 500 ms.
  assert.ok((results[0].queuedMs ?? 0) < 50, `a waited ${results[0].queuedMs} ms`);
  assert.ok(results[1].queuedMs >= 50, `b waited ${results[1].queuedMs} ms`);
  assert.equal(results[2].queuedMs, undefined, "a test that runs no shell command never queues");
});

test("a press after every caller gave up starts a new test, even while the old one still closes", async () => {
  const log = [];
  const entry = target({ command: "server" }, { name: "reopened" });
  // Closing takes a while after the abort, as a stdio server's does.
  const connect = async (_entry, signal) => {
    log.push("start");
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    await delay(300);
    return { state: "failed", timedOut: true, tools: [], toolCount: 0, durationMs: 1 };
  };
  const leaving = new AbortController();
  const first = testMcpServer(entry, internals, { connect, signal: leaving.signal });
  await delay(20);
  leaving.abort();
  await delay(20);
  const second = testMcpServer(entry, internals, { connect: recordingConnect(log, 30), signal: new AbortController().signal });
  assert.notEqual(second, first);
  assert.equal((await second).state, "connected");
  assert.deepEqual(log.slice(0, 2), ["start", "start reopened"]);
  assert.equal((await first).timedOut, true);
  // The cancelled test records nothing over the new one's result.
  assert.equal(readMcpStatus(entry, entry.configKey).state, "connected");
});

test("presses on the same entry join its test; another folder is another test", async () => {
  const log = [];
  const connect = recordingConnect(log, 50);
  const entry = target({ command: "server" }, { name: "same" });
  const [first, second, elsewhere] = await Promise.all([
    testMcpServer(entry, internals, { connect }),
    testMcpServer({ ...entry }, internals, { connect }),
    testMcpServer({ ...entry, cwd: join(root, "other") }, internals, { connect }),
  ]);
  assert.equal(first, second);
  assert.notEqual(first, elsewhere);
  assert.deepEqual(log.filter((line) => line.startsWith("start")), ["start same", "start same"]);
  // Once it is over, a press starts a new test.
  await testMcpServer(entry, internals, { connect });
  assert.equal(log.filter((line) => line.startsWith("start")).length, 3);
});

test("a sign-out while an OAuth entry's test runs keeps its result out of the record, and the next press starts afresh", async () => {
  const log = [];
  const connect = recordingConnect(log, 80);
  const url = "https://signed-out.example/mcp";
  const entry = target({ url }, { name: "signed-out" });
  const first = testMcpServer(entry, internals, { connect });
  await delay(20);
  // What signOutMcpServer() does first, before it removes the tokens.
  noteMcpSignOut(mcpSignInKey("signed-out", url));
  const second = testMcpServer(entry, internals, { connect });
  assert.notEqual(second, first, "a press after the sign-out does not join the test started before it");
  assert.equal((await first).state, "connected");
  assert.equal((await second).state, "connected");
  assert.equal(log.filter((line) => line.startsWith("start")).length, 2);
  // Only the test started after the sign-out is recorded.
  const status = readMcpStatus(entry, entry.configKey);
  assert.equal(status.testedAt, (await second).testedAt);

  // A stdio entry has no URL to sign out of, so nothing bars it.
  const stdio = target({ command: "server" }, { name: "stdio" });
  await testMcpServer(stdio, internals, { connect });
  assert.equal(readMcpStatus(stdio, stdio.configKey).state, "connected");
});

test("a test every caller gave up on is stopped and not recorded; one still awaited is", async () => {
  const log = [];
  const entry = target({ command: "server" }, { name: "abandoned" });
  const first = new AbortController();
  const second = new AbortController();
  const running = Promise.all([
    testMcpServer(entry, internals, { connect: recordingConnect(log, 5_000), signal: first.signal }),
    testMcpServer(entry, internals, { connect: recordingConnect(log, 5_000), signal: second.signal }),
  ]);
  await delay(20);
  first.abort();
  await delay(20);
  assert.deepEqual(log, ["start abandoned"], "one caller still waits");
  second.abort();
  const [result] = await running;
  assert.equal(result.timedOut, true);
  assert.deepEqual(log, ["start abandoned", "end abandoned"]);
  assert.equal(readMcpStatus(entry, entry.configKey), undefined);

  // A caller that keeps waiting gets a recorded result even if another leaves.
  const kept = target({ command: "server" }, { name: "kept" });
  const leaving = new AbortController();
  const both = Promise.all([
    testMcpServer(kept, internals, { connect: recordingConnect([], 40), signal: leaving.signal }),
    testMcpServer(kept, internals, { connect: recordingConnect([], 40), signal: new AbortController().signal }),
  ]);
  leaving.abort();
  assert.equal((await both)[1].state, "connected");
  assert.equal(readMcpStatus(kept, kept.configKey).state, "connected");
});

test("a deadline that passes is recorded as no answer; a queue that holds a test past it never starts that test", async () => {
  const log = [];
  const slow = target({ command: "server", env: { T: "!x" } }, { name: "slow" });
  const queued = target({ command: "server", env: { T: "!y" } }, { name: "queued" });
  const [timedOut, neverRan] = await Promise.all([
    testMcpServer(slow, internals, { connect: recordingConnect(log, 5_000), deadlineMs: 200 }),
    testMcpServer(queued, internals, { connect: recordingConnect(log, 5_000), deadlineMs: 80 }),
  ]);
  assert.equal(timedOut.timedOut, true);
  assert.equal(readMcpStatus(slow, slow.configKey).timedOut, true);
  assert.equal(neverRan.queueTimedOut, true);
  assert.equal(neverRan.state, "failed");
  assert.ok(neverRan.queuedMs >= 70);
  assert.deepEqual(log, ["start slow", "end slow"], "the queued test never connected");
  assert.equal(readMcpStatus(queued, queued.configKey), undefined, "a test that never ran says nothing about the server");
});

test("a connect that ignores the deadline still ends the test shortly after it", async () => {
  const started = Date.now();
  const result = await testMcpServer(target({ command: "server" }), internals, {
    connect: () => new Promise(() => {}),
    deadlineMs: 100,
    closeWaitMs: 100,
  });
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - started < 1_500);
});

test("an aborted signal connects nothing", async (t) => {
  const controller = new AbortController();
  controller.abort();
  const pidFile = join(root, "never.pid");
  t.after(() => killFixture(pidFile));
  const result = await connectForTest(
    target({ command: process.execPath, args: [HANG_FIXTURE], env: { PI_WEB_FIXTURE_PID_FILE: pidFile } }),
    internals,
    controller.signal,
  );
  assert.equal(result.timedOut, true);
  await delay(100);
  assert.equal(existsSync(pidFile), false);
});
