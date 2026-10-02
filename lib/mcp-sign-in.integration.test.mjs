import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";
import { approveSignIn, startFakeOAuthServer } from "./__fixtures__/mcp-oauth-server.mjs";

// The sign-in with the SDK's own connection, signInMcpServer and credential
// store, against a local fake MCP server and authorization server on
// 127.0.0.1. mcp-auth.json lives in a temporary agent dir, never ~/.pi/agent.
const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-web-mcp-sign-in-int-")));
const agentDir = join(root, "agent");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
await mkdir(agentDir, { recursive: true });

const jiti = createJiti(import.meta.url);
const { loadPiSdkInternals } = await jiti.import("./pi-sdk-internals.ts");
const {
  cancelMcpSignIn,
  clearMcpSignIns,
  createMcpSignInDeps,
  mcpOAuthUrl,
  mcpSignInUrlKey,
  pasteMcpSignInRedirect,
  readMcpSignIn,
  signOutMcpServer,
  startMcpSignIn,
} = await jiti.import("./mcp-sign-in.ts");
const { clearMcpStatuses, readMcpStatus } = await jiti.import("./mcp-status.ts");
const { testMcpServer } = await jiti.import("./mcp-test.ts");

const internals = await loadPiSdkInternals();
assert.equal(internals.ok, true, internals.reason);
const deps = createMcpSignInDeps(internals);
const authPath = join(agentDir, "mcp-auth.json");

after(async () => {
  clearMcpSignIns();
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  clearMcpSignIns();
  clearMcpStatuses();
  await rm(authPath, { force: true });
});

/** The fake MCP and authorization server (lib/__fixtures__/mcp-oauth-server.mjs), closed after the test. */
async function fakeOAuthServer(t) {
  const fake = await startFakeOAuthServer();
  t.after(() => fake.close());
  return fake;
}

let counter = 0;
function entryFor(url) {
  counter += 1;
  const config = internals.validateMcpServerConfig("oauth", { url });
  assert.notEqual(typeof config, "string", config);
  return { scope: "global", name: `oauth-${counter}`, sourcePath: join(agentDir, "mcp.json"), configKey: `key-${counter}`, config, cwd: root, url };
}

const ENDED = new Set(["done", "failed", "cancelled", "expired"]);

async function until(flowId, predicate, ms = 15_000) {
  for (const started = Date.now(); Date.now() - started < ms;) {
    const info = readMcpSignIn(flowId);
    if (info && predicate(info)) return info;
    await delay(20);
  }
  assert.fail(`timed out; last ${JSON.stringify(readMcpSignIn(flowId))}`);
}

const waiting = (flowId) => until(flowId, (info) => info.phase === "authorize" || ENDED.has(info.phase));
const ended = (flowId) => until(flowId, (info) => ENDED.has(info.phase));

const approve = approveSignIn;

function storedTokens(url) {
  if (!existsSync(authPath)) return undefined;
  return JSON.parse(readFileSync(authPath, "utf8"))[mcpSignInUrlKey(url)]?.tokens;
}

test("a pasted redirected address signs in through the SDK, and the reconnect lists the tools", async (t) => {
  const fake = await fakeOAuthServer(t);
  const entry = entryFor(fake.url);
  const { flow } = startMcpSignIn(entry, deps);
  const shown = await waiting(flow.flowId);
  assert.equal(shown.phase, "authorize", shown.error);
  const page = new URL(shown.authorizationUrl);
  assert.equal(`${page.origin}${page.pathname}`, `${fake.origin}/authorize`);
  assert.equal(page.searchParams.get("client_id"), "client-1");
  // The browser is sent back to the SDK's loopback listener on this computer.
  assert.equal(shown.redirectUrl, page.searchParams.get("redirect_uri"));
  assert.match(shown.redirectUrl, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  // Before that, the first connect read needs-auth, which is the entry's status meanwhile.
  assert.equal(readMcpStatus(entry, entry.configKey).state, "needs-auth");

  const landed = await approve(page);
  // A typo, or another sign-in's address, leaves the sign-in waiting.
  assert.equal(pasteMcpSignInRedirect(flow.flowId, landed.replace(/state=[^&]+/, "state=forged")).reason, "redirect-state-mismatch");
  assert.equal(readMcpSignIn(flow.flowId).phase, "authorize");
  assert.equal(pasteMcpSignInRedirect(flow.flowId, landed).ok, true);

  const done = await ended(flow.flowId);
  assert.equal(done.phase, "done", done.error);
  assert.equal(done.result.state, "connected", done.result.error);
  assert.equal(done.result.afterSignIn, true);
  assert.deepEqual(done.result.tools.map((tool) => tool.name), ["whoami"]);
  assert.deepEqual(fake.issued.grants, ["authorization_code"]);
  assert.ok(fake.issued.access.has(storedTokens(fake.url)?.access_token), "mcp-auth.json holds the token the server issued");
  const status = readMcpStatus(entry, entry.configKey);
  assert.equal(status.state, "connected");
  assert.equal(status.afterSignIn, true);
  // The loopback listener is gone once the sign-in ended.
  await assert.rejects(fetch(shown.redirectUrl));
});

test("a browser on this computer finishes the sign-in through the loopback listener, with no paste", async (t) => {
  const fake = await fakeOAuthServer(t);
  const { flow } = startMcpSignIn(entryFor(fake.url), deps);
  const shown = await waiting(flow.flowId);
  assert.equal(shown.phase, "authorize", shown.error);
  const landed = await approve(shown.authorizationUrl);
  // The browser follows the redirect to 127.0.0.1, where the SDK listens.
  const page = await fetch(landed);
  assert.equal(page.status, 200);
  const done = await ended(flow.flowId);
  assert.equal(done.phase, "done", done.error);
  assert.equal(done.result.state, "connected");
  // A paste now has nothing to answer.
  assert.equal(pasteMcpSignInRedirect(flow.flowId, landed).reason, "sign-in-not-waiting");
});

test("once signed in, a sign-in needs no browser, and an expired token is refreshed by the connection itself", async (t) => {
  const fake = await fakeOAuthServer(t);
  const first = startMcpSignIn(entryFor(fake.url), deps).flow;
  const shown = await waiting(first.flowId);
  assert.equal(pasteMcpSignInRedirect(first.flowId, await approve(shown.authorizationUrl)).ok, true);
  assert.equal((await ended(first.flowId)).phase, "done");

  const again = startMcpSignIn(entryFor(fake.url), deps).flow;
  const already = await ended(again.flowId);
  assert.equal(already.phase, "done", already.error);
  assert.equal(already.alreadySignedIn, true);
  assert.equal(already.result.state, "connected");

  // The server forgets its access tokens: the connection refreshes with the stored refresh token.
  fake.issued.access.clear();
  const refreshed = await ended(startMcpSignIn(entryFor(fake.url), deps).flow.flowId);
  assert.equal(refreshed.phase, "done", refreshed.error);
  assert.equal(refreshed.alreadySignedIn, true);
  assert.deepEqual(fake.issued.grants, ["authorization_code", "refresh_token"]);
});

/** Signs in to the fake server with a pasted address, until the flow is done. */
async function signIn(fake) {
  const { flow } = startMcpSignIn(entryFor(fake.url), deps);
  const shown = await waiting(flow.flowId);
  assert.equal(shown.phase, "authorize", shown.error);
  assert.equal(pasteMcpSignInRedirect(flow.flowId, await approve(shown.authorizationUrl)).ok, true);
  assert.equal((await ended(flow.flowId)).phase, "done");
}

/** Holds the next refresh at the token endpoint: `reached` once it arrived, `release()` lets it answer, `answered` after. */
function holdRefresh(fake) {
  let reached;
  let release;
  let answered;
  const hold = {
    reached: new Promise((resolve) => {
      reached = resolve;
    }),
    answered: new Promise((resolve) => {
      answered = resolve;
    }),
  };
  const held = new Promise((resolve) => {
    release = resolve;
  });
  hold.release = release;
  fake.hooks.beforeRefresh = async () => {
    fake.hooks.beforeRefresh = undefined;
    reached();
    await held;
    setTimeout(answered, 0);
  };
  return hold;
}

test("a refresh a sign-in's connection has on its way when the URL is signed out stores nothing", async (t) => {
  const fake = await fakeOAuthServer(t);
  await signIn(fake);
  // The server forgets its access tokens, so the next connect refreshes through the connection's store.
  fake.issued.access.clear();
  const refresh = holdRefresh(fake);
  t.after(() => refresh.release());
  const { flow } = startMcpSignIn(entryFor(fake.url), deps);
  await refresh.reached;
  assert.equal(signOutMcpServer(fake.url, agentDir, internals), true);
  refresh.release();
  await refresh.answered;
  assert.equal((await ended(flow.flowId)).phase, "cancelled");
  // Long enough for a save the guard did not stop to land.
  await delay(300);
  assert.equal(storedTokens(fake.url), undefined, "the renewed tokens were not written back");
});

test("a refresh a Test has on its way when the URL is signed out stores nothing, and the Test records nothing", async (t) => {
  const fake = await fakeOAuthServer(t);
  await signIn(fake);
  fake.issued.access.clear();
  const refresh = holdRefresh(fake);
  t.after(() => refresh.release());
  const entry = entryFor(fake.url);
  const testing = testMcpServer(entry, internals);
  await refresh.reached;
  assert.equal(signOutMcpServer(fake.url, agentDir, internals), true);
  refresh.release();
  await refresh.answered;
  const result = await testing;
  assert.notEqual(result.state, "connected", "the renewed tokens were refused, so the server was not reached with them");
  await delay(300);
  assert.equal(storedTokens(fake.url), undefined, "the renewed tokens were not written back");
  assert.equal(readMcpStatus(entry, entry.configKey), undefined, "nothing reads as signed in again");
});

test("cancelling a waiting sign-in ends it, and closes the loopback listener", async (t) => {
  const fake = await fakeOAuthServer(t);
  const { flow } = startMcpSignIn(entryFor(fake.url), deps);
  const shown = await waiting(flow.flowId);
  assert.equal(shown.phase, "authorize", shown.error);
  assert.equal(cancelMcpSignIn(flow.flowId).phase, "cancelled");
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(shown.redirectUrl);
      await delay(20);
    } catch {
      break;
    }
  }
  await assert.rejects(fetch(shown.redirectUrl), "nothing listens once the SDK gave up");
  assert.equal(storedTokens(fake.url), undefined);
});

test("signing out deletes the tokens, so the next sign-in shows the page again", async (t) => {
  const fake = await fakeOAuthServer(t);
  const { flow } = startMcpSignIn(entryFor(fake.url), deps);
  const shown = await waiting(flow.flowId);
  assert.equal(pasteMcpSignInRedirect(flow.flowId, await approve(shown.authorizationUrl)).ok, true);
  assert.equal((await ended(flow.flowId)).phase, "done");
  assert.ok(storedTokens(fake.url));

  assert.equal(signOutMcpServer(fake.url, agentDir, internals), true);
  assert.equal(storedTokens(fake.url), undefined);
  const next = startMcpSignIn(entryFor(fake.url), deps).flow;
  assert.equal((await waiting(next.flowId)).phase, "authorize");
  cancelMcpSignIn(next.flowId);
});

test("an HTTP server with an Authorization header and a stdio server do not sign in, as the SDK decides", () => {
  const configs = [
    { url: "https://a.example/mcp" },
    { url: "https://a.example/mcp", headers: { Authorization: "Bearer x" } },
    { url: "https://a.example/mcp", headers: { authorization: "Bearer x", "X-Other": "y" } },
    { url: "https://a.example/mcp", headers: { "X-Api-Key": "y" } },
    { command: "node", args: ["server.js"] },
  ];
  for (const raw of configs) {
    const config = internals.validateMcpServerConfig("probe", raw);
    const connection = new internals.McpServerConnection({
      entry: { name: "probe", config, source: "probe" },
      cwd: root,
      createTransport: internals.createDefaultTransport,
      credentials: new internals.McpOAuthCredentialStore(),
      onTools() {},
    });
    assert.equal(mcpOAuthUrl(config), connection.oauthUrl, JSON.stringify(raw));
  }
  // Building connections reads and writes nothing.
  assert.equal(existsSync(authPath), false);
});
