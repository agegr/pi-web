import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";

// The sign-in registry against a stub of the SDK's connection and
// signInMcpServer: nothing here connects anywhere or reads mcp-auth.json,
// except signOutMcpServer, which runs against a temporary agent dir.
const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-web-mcp-sign-in-")));
const agentDir = join(root, "agent");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
await mkdir(agentDir, { recursive: true });

const jiti = createJiti(import.meta.url);
const {
  McpSignedOutError,
  cancelMcpSignIn,
  clearMcpSignIns,
  guardedCredentialStore,
  mcpOAuthUrl,
  mcpSignInKey,
  openMcpSignInConnection,
  pasteMcpSignInRedirect,
  readMcpSignIn,
  signOutMcpServer,
  startMcpSignIn,
} = await jiti.import("./mcp-sign-in.ts");
const { clearMcpStatuses, readMcpStatus } = await jiti.import("./mcp-status.ts");
const { loadPiSdkInternals } = await jiti.import("./pi-sdk-internals.ts");

after(async () => {
  clearMcpSignIns();
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  clearMcpSignIns();
  clearMcpStatuses();
});

class Cancelled extends Error {
  constructor() {
    super("Sign-in cancelled");
    this.name = "McpSignInCancelledError";
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const run = (state, extra = {}) => ({ state, tools: [], toolCount: 0, durationMs: 5, ...extra });

let counter = 0;
function target(overrides = {}) {
  counter += 1;
  return {
    scope: "global",
    name: `server-${counter}`,
    sourcePath: join(agentDir, "mcp.json"),
    configKey: `key-${counter}`,
    config: { url: `https://mcp${counter}.example/mcp` },
    cwd: root,
    url: `https://mcp${counter}.example/mcp`,
    ...overrides,
  };
}

const STATE = "state-from-the-store";
const REDIRECT = "http://127.0.0.1:53682/callback";
const PAGE = `https://auth.example/authorize?client_id=pi&state=${STATE}&redirect_uri=${encodeURIComponent(REDIRECT)}`;

/**
 * Stub deps. `first` and `after` are what the connection's connect and
 * reconnect answer (a value, or a deferred to settle later); `signIn` replaces
 * the SDK's, by default one that stores a state, shows the page and waits for
 * the prompt like signInMcpServer does.
 */
function stubDeps({ first = run("needs-auth"), after = run("connected", { toolCount: 2, tools: [] }), signIn, settings, redact } = {}) {
  const calls = { open: 0, connect: 0, reconnect: 0, signIn: 0, closed: 0, signInOptions: [] };
  const saved = [];
  const deps = {
    open() {
      calls.open += 1;
      return {
        async connect(signal) {
          calls.connect += 1;
          const value = typeof first === "function" ? first(signal) : first;
          return value?.promise ?? value;
        },
        challenge: { scope: "read" },
        oauthSettings() {
          if (settings instanceof Error) throw settings;
          return settings ?? {};
        },
        async reconnect(signal) {
          calls.reconnect += 1;
          const value = typeof after === "function" ? after(signal) : after;
          return value?.promise ?? value;
        },
        redact: redact ?? ((text) => text.replaceAll("s3cret-value", "•••")),
        async close() {
          calls.closed += 1;
        },
      };
    },
    async signIn(options) {
      calls.signIn += 1;
      calls.signInOptions.push(options);
      if (signIn) return signIn(options);
      await options.store.save({ serverUrl: options.serverUrl, oauthState: STATE });
      await options.store.load();
      options.prompt.showAuthorizationUrl(new URL(PAGE));
      const input = await options.prompt.promptForRedirectUrl(new AbortController().signal);
      if (!input?.trim()) throw new Cancelled();
    },
    store() {
      let state;
      return {
        load: () => state,
        save: (next) => {
          state = next;
          saved.push(next);
        },
      };
    },
    isCancelled: (error) => error instanceof Cancelled,
  };
  return { deps, calls, saved };
}

async function until(read, predicate, ms = 2_000) {
  for (const started = Date.now(); Date.now() - started < ms;) {
    const value = read();
    if (predicate(value)) return value;
    await delay(5);
  }
  const value = read();
  assert.ok(predicate(value), `timed out; last value ${JSON.stringify(value)}`);
  return value;
}

const phaseOf = (flowId) => () => readMcpSignIn(flowId)?.phase;

test("a sign-in connects, shows the page, takes a pasted address, reconnects and records what it found", async () => {
  const entry = target();
  const { deps, calls } = stubDeps();
  const { flow, joined } = startMcpSignIn(entry, deps);
  assert.equal(joined, false);
  assert.equal(flow.phase, "connecting");
  assert.ok(flow.expiresInMs > 4 * 60_000 && flow.expiresInMs <= 5 * 60_000);
  assert.deepEqual([flow.scope, flow.name, flow.configKey], ["global", entry.name, entry.configKey]);

  const waiting = await until(() => readMcpSignIn(flow.flowId), (info) => info?.phase === "authorize");
  assert.equal(waiting.authorizationUrl, PAGE);
  assert.equal(waiting.redirectUrl, REDIRECT);
  // The SDK got the connection's challenge and resolved settings, for the entry's URL.
  assert.equal(calls.signInOptions[0].serverUrl, entry.url);
  assert.deepEqual(calls.signInOptions[0].challenge, { scope: "read" });
  // The first connect asked for a sign-in, which is the entry's status meanwhile.
  assert.equal(readMcpStatus(entry, entry.configKey).state, "needs-auth");

  const pasted = pasteMcpSignInRedirect(flow.flowId, `  ${REDIRECT}?code=the-code&state=${STATE}  `);
  assert.equal(pasted.ok, true);
  assert.equal(pasted.flow.phase, "finishing");
  const done = await until(() => readMcpSignIn(flow.flowId), (info) => info?.phase === "done");
  assert.equal(done.result.state, "connected");
  assert.equal(done.result.afterSignIn, true);
  assert.equal(done.refreshed, undefined);
  assert.equal(done.authorizationUrl, undefined, "the page is shown only while it waits");
  assert.equal(done.expiresInMs, 0);
  assert.equal(calls.reconnect, 1);
  // The reconnect is the entry's status now, marked as a sign-in's.
  const status = readMcpStatus(entry, entry.configKey);
  assert.equal(status.origin, "test");
  assert.equal(status.afterSignIn, true);
  assert.equal(status.toolCount, 2);
  await until(() => calls.closed, (closed) => closed === 1);
});

test("a pasted address is checked before the SDK sees it, and a bad one leaves the sign-in waiting", async () => {
  const { deps } = stubDeps();
  const { flow } = startMcpSignIn(target(), deps);
  // Not waiting yet: nothing to paste into.
  const early = pasteMcpSignInRedirect(flow.flowId, `${REDIRECT}?code=c&state=${STATE}`);
  assert.equal(early.ok || early.reason, "sign-in-not-waiting");
  assert.equal(early.status, 409);
  await until(phaseOf(flow.flowId), (phase) => phase === "authorize");

  const refused = (input) => {
    const result = pasteMcpSignInRedirect(flow.flowId, input);
    assert.equal(result.ok, false, input);
    return { status: result.status, reason: result.reason, error: result.error };
  };
  assert.deepEqual(refused("not a url").reason, "redirect-invalid");
  assert.deepEqual(refused(`${REDIRECT}?code=c&state=another-sign-in`).reason, "redirect-state-mismatch");
  assert.deepEqual(refused(`${REDIRECT}?code=c`).reason, "redirect-state-mismatch");
  assert.deepEqual(refused(`${REDIRECT}?state=${STATE}`).reason, "redirect-no-code");
  assert.deepEqual(
    refused(`${REDIRECT}?state=${STATE}&error=access_denied&error_description=The+user+said+no`),
    { status: 400, reason: "redirect-denied", error: "The user said no" },
  );
  assert.equal(refused("   ").reason, "invalid-request");
  assert.equal(refused(42).reason, "invalid-request");
  assert.equal(refused(`${REDIRECT}?${"x".repeat(20_000)}`).reason, "invalid-request");
  // Every refusal left the flow waiting for the right address.
  assert.equal(readMcpSignIn(flow.flowId).phase, "authorize");
  assert.equal(pasteMcpSignInRedirect(flow.flowId, `${REDIRECT}?code=c&state=${STATE}`).ok, true);
  await until(phaseOf(flow.flowId), (phase) => phase === "done");
  // Once it moved on, another paste has nothing to answer.
  assert.equal(pasteMcpSignInRedirect(flow.flowId, `${REDIRECT}?code=c&state=${STATE}`).reason, "sign-in-not-waiting");
  assert.deepEqual(
    (({ ok, status, reason }) => ({ ok, status, reason }))(pasteMcpSignInRedirect("no-such-flow", "x")),
    { ok: false, status: 404, reason: "sign-in-unknown" },
  );
});

test("the state a paste must carry is the one the SDK stored, which it checks against", async () => {
  // A page whose URL carries no state: the stored one still decides.
  const { deps } = stubDeps({
    signIn: async (options) => {
      await options.store.save({ serverUrl: options.serverUrl, oauthState: "only-in-the-store" });
      options.prompt.showAuthorizationUrl(new URL("https://auth.example/authorize"));
      const input = await options.prompt.promptForRedirectUrl(new AbortController().signal);
      if (new URL(input).searchParams.get("state") !== "only-in-the-store") throw new Error("wrong state");
    },
  });
  const { flow } = startMcpSignIn(target(), deps);
  await until(phaseOf(flow.flowId), (phase) => phase === "authorize");
  assert.equal(pasteMcpSignInRedirect(flow.flowId, `${REDIRECT}?code=c&state=${STATE}`).reason, "redirect-state-mismatch");
  assert.equal(pasteMcpSignInRedirect(flow.flowId, `${REDIRECT}?code=c&state=only-in-the-store`).ok, true);
  await until(phaseOf(flow.flowId), (phase) => phase === "done");
});

test("the loopback callback finishes the sign-in without a paste", async () => {
  const callback = new AbortController();
  const { deps } = stubDeps({
    signIn: async (options) => {
      await options.store.save({ serverUrl: options.serverUrl, oauthState: STATE });
      options.prompt.showAuthorizationUrl(new URL(PAGE));
      const prompt = options.prompt.promptForRedirectUrl(callback.signal);
      // The browser reached the loopback listener: the SDK aborts the prompt and goes on with the code.
      await delay(20);
      callback.abort();
      assert.equal(await prompt, undefined);
    },
  });
  const { flow } = startMcpSignIn(target(), deps);
  await until(phaseOf(flow.flowId), (phase) => phase === "authorize");
  await until(phaseOf(flow.flowId), (phase) => phase === "finishing" || phase === "done");
  assert.equal((await until(() => readMcpSignIn(flow.flowId), (info) => info.phase === "done")).result.state, "connected");
});

test("a stored refresh token finishes with no page at all", async () => {
  const { deps, calls } = stubDeps({ signIn: async () => {} });
  const { flow } = startMcpSignIn(target(), deps);
  const done = await until(() => readMcpSignIn(flow.flowId), (info) => info?.phase === "done");
  assert.equal(done.refreshed, true);
  assert.equal(done.result.state, "connected");
  assert.equal(calls.reconnect, 1);
});

test("a server that is already signed in, or does not connect, needs no sign-in", async () => {
  const signedIn = target();
  const connected = stubDeps({ first: run("connected", { toolCount: 3 }) });
  const { flow } = startMcpSignIn(signedIn, connected.deps);
  const done = await until(() => readMcpSignIn(flow.flowId), (info) => info?.phase === "done");
  assert.equal(done.alreadySignedIn, true);
  assert.equal(done.result.toolCount, 3);
  assert.equal(connected.calls.signIn, 0);
  assert.equal(readMcpStatus(signedIn, signedIn.configKey).toolCount, 3);
  assert.equal(readMcpStatus(signedIn, signedIn.configKey).afterSignIn, undefined, "a plain connection, as a test makes");

  const broken = target();
  const failing = stubDeps({ first: run("failed", { error: "ECONNREFUSED" }) });
  const failed = startMcpSignIn(broken, failing.deps).flow;
  const ended = await until(() => readMcpSignIn(failed.flowId), (info) => info?.phase === "failed");
  assert.equal(ended.failure, "connect-failed");
  assert.equal(ended.result.error, "ECONNREFUSED");
  assert.equal(readMcpStatus(broken, broken.configKey).state, "failed");
  assert.equal(failing.calls.signIn, 0);

  const queued = stubDeps({ first: run("failed", { queueTimedOut: true }) });
  const queuedFlow = startMcpSignIn(target(), queued.deps).flow;
  assert.equal((await until(() => readMcpSignIn(queuedFlow.flowId), (info) => info?.phase === "failed")).failure, "queue-timed-out");
});

test("a failing sign-in ends failed with the SDK's words, masked", async () => {
  const { deps } = stubDeps({ signIn: async () => { throw new Error("registration failed: client_secret=s3cret-value"); } });
  const { flow } = startMcpSignIn(target(), deps);
  const failed = await until(() => readMcpSignIn(flow.flowId), (info) => info?.phase === "failed");
  assert.equal(failed.failure, "sign-in-failed");
  assert.equal(failed.error, "registration failed: client_secret=•••");

  const secret = stubDeps({ settings: new Error("Failed to resolve oauth.clientSecret from shell command: s3cret-value") });
  const second = startMcpSignIn(target(), secret.deps).flow;
  const ended = await until(() => readMcpSignIn(second.flowId), (info) => info?.phase === "failed");
  assert.equal(ended.failure, "sign-in-failed");
  assert.doesNotMatch(ended.error, /s3cret-value/);
  assert.equal(secret.calls.signIn, 0);
});

test("a cancel before the sign-in started stops it there; the SDK is never called", async () => {
  const connect = deferred();
  const { deps, calls } = stubDeps({ first: () => connect });
  const { flow } = startMcpSignIn(target(), deps);
  await until(() => calls.connect, (count) => count === 1);
  assert.equal(cancelMcpSignIn(flow.flowId).phase, "cancelled");
  connect.resolve(run("needs-auth"));
  await until(() => calls.closed, (closed) => closed === 1);
  assert.equal(calls.signIn, 0);
  assert.equal(readMcpSignIn(flow.flowId).phase, "cancelled");
});

test("a cancel before the page is shown is applied the moment the SDK asks for the address", async () => {
  const gate = deferred();
  let answered;
  const { deps, calls } = stubDeps({
    signIn: async (options) => {
      await gate.promise;
      options.prompt.showAuthorizationUrl(new URL(PAGE));
      answered = await options.prompt.promptForRedirectUrl(new AbortController().signal);
      if (!answered?.trim()) throw new Cancelled();
    },
  });
  const { flow } = startMcpSignIn(target(), deps);
  await until(phaseOf(flow.flowId), (phase) => phase === "starting");
  assert.equal(cancelMcpSignIn(flow.flowId).phase, "cancelled");
  gate.resolve();
  await until(() => calls.closed, (closed) => closed === 1);
  assert.equal(answered, "");
  // The page shown afterwards does not bring the flow back.
  const info = readMcpSignIn(flow.flowId);
  assert.equal(info.phase, "cancelled");
  assert.equal(info.authorizationUrl, undefined);
  assert.equal(calls.reconnect, 0);
});

test("a cancel while the page is shown answers the SDK's prompt with an empty value", async () => {
  const { deps, calls } = stubDeps();
  const { flow } = startMcpSignIn(target(), deps);
  await until(phaseOf(flow.flowId), (phase) => phase === "authorize");
  assert.equal(cancelMcpSignIn(flow.flowId).phase, "cancelled");
  await until(() => calls.closed, (closed) => closed === 1);
  assert.equal(readMcpSignIn(flow.flowId).phase, "cancelled");
  assert.equal(calls.reconnect, 0);
  // Cancelling again, or a flow nobody knows, changes nothing.
  assert.equal(cancelMcpSignIn(flow.flowId).phase, "cancelled");
  assert.equal(cancelMcpSignIn("no-such-flow"), undefined);
});

test("the time limit ends a waiting sign-in, which is forgotten a while after", async () => {
  const { deps, calls } = stubDeps();
  const { flow } = startMcpSignIn(target(), deps, { ttlMs: 150, keepMs: 100 });
  await until(phaseOf(flow.flowId), (phase) => phase === "authorize");
  await until(phaseOf(flow.flowId), (phase) => phase === "expired", 1_000);
  await until(() => calls.closed, (closed) => closed === 1);
  assert.equal(calls.reconnect, 0);
  assert.equal(pasteMcpSignInRedirect(flow.flowId, `${REDIRECT}?code=c&state=${STATE}`).reason, "sign-in-not-waiting");
  await until(() => readMcpSignIn(flow.flowId), (info) => info === undefined, 1_000);
});

test("a second start for the same server joins the sign-in under way; once it ended, a start begins anew", async () => {
  const first = target();
  // The project's entry of the same name and URL shares the global one's credentials.
  const sameServer = target({ scope: "project", name: first.name, url: first.url, config: first.config });
  const { deps, calls } = stubDeps();
  const started = startMcpSignIn(first, deps).flow;
  const joined = startMcpSignIn(sameServer, deps);
  assert.equal(joined.joined, true);
  assert.equal(joined.flow.flowId, started.flowId);
  // The flow names the entry that started it.
  assert.equal(joined.flow.scope, "global");
  // The URL as the SDK keys it: a trailing slash or case in the host makes no second flow.
  assert.equal(startMcpSignIn(target({ name: first.name, url: first.url.replace("https://", "HTTPS://") }), deps).flow.flowId, started.flowId);
  await until(phaseOf(started.flowId), (phase) => phase === "authorize");
  assert.equal(calls.open, 1);
  // Another name at the same URL keeps its own account, so it signs in on its own.
  const otherName = startMcpSignIn(target({ url: first.url, config: first.config }), deps);
  assert.equal(otherName.joined, false);
  cancelMcpSignIn(otherName.flow.flowId);
  cancelMcpSignIn(started.flowId);
  const again = startMcpSignIn(first, deps);
  assert.equal(again.joined, false);
  assert.notEqual(again.flow.flowId, started.flowId);
});

test("a new sign-in of a URL waits until the previous one has unwound", async () => {
  const gate = deferred();
  const first = target();
  const blocked = stubDeps({
    signIn: async (options) => {
      // Stuck before it asks for anything, as discovery waiting on a slow server is.
      await gate.promise;
      const input = await options.prompt.promptForRedirectUrl(new AbortController().signal);
      if (!input?.trim()) throw new Cancelled();
    },
  });
  const old = startMcpSignIn(first, blocked.deps).flow;
  await until(phaseOf(old.flowId), (phase) => phase === "starting");
  cancelMcpSignIn(old.flowId);
  const next = stubDeps();
  const fresh = startMcpSignIn(first, next.deps).flow;
  assert.notEqual(fresh.flowId, old.flowId);
  await delay(50);
  // The old run still holds mcp-auth.json's state for the URL: the new one has not connected.
  assert.equal(next.calls.connect, 0);
  assert.equal(readMcpSignIn(fresh.flowId).phase, "connecting");
  gate.resolve();
  await until(phaseOf(fresh.flowId), (phase) => phase === "authorize");
  assert.equal(next.calls.connect, 1);
});

test("a sign-in nobody polls goes on by itself", async () => {
  const { deps } = stubDeps();
  const { flow } = startMcpSignIn(target(), deps);
  // No request is waiting on it; it reaches the page and waits there.
  await delay(50);
  assert.equal(pasteMcpSignInRedirect(flow.flowId, `${REDIRECT}?code=c&state=${STATE}`).ok, true);
  await until(phaseOf(flow.flowId), (phase) => phase === "done");
});

test("a sign-in whose entry may no longer connect ends signed in, without connecting again", async () => {
  let allowed = true;
  const { deps, calls } = stubDeps();
  const { flow } = startMcpSignIn(target({ mayConnect: () => allowed }), deps);
  await until(phaseOf(flow.flowId), (phase) => phase === "authorize");
  allowed = false;
  pasteMcpSignInRedirect(flow.flowId, `${REDIRECT}?code=c&state=${STATE}`);
  const done = await until(() => readMcpSignIn(flow.flowId), (info) => info?.phase === "done");
  assert.equal(done.result, undefined);
  assert.equal(calls.reconnect, 0);
});

test("a sign-in masks the oauth.clientSecret it resolved wherever a message quotes it", async (t) => {
  // A `${VAR}` or `!command` secret is not literal in the entry, so the test redactor's other rules
  // cannot see what it resolved to; the value the connection read is the only mask.
  const sdk = await loadPiSdkInternals();
  assert.equal(sdk.ok, true, sdk.reason);
  const value = "probe-client-secret-value-123";
  const previous = process.env.PROBE_CLIENT_SECRET;
  process.env.PROBE_CLIENT_SECRET = value;
  t.after(() => {
    if (previous === undefined) delete process.env.PROBE_CLIENT_SECRET;
    else process.env.PROBE_CLIENT_SECRET = previous;
  });
  const config = sdk.validateMcpServerConfig("x", { url: "http://127.0.0.1:9/mcp", oauth: { clientId: "id", clientSecret: "${PROBE_CLIENT_SECRET}" } });
  assert.notEqual(typeof config, "string", config);
  const connection = openMcpSignInConnection(
    { scope: "global", name: "x", sourcePath: join(agentDir, "mcp.json"), configKey: "k", config, cwd: tmpdir(), url: "http://127.0.0.1:9/mcp" },
    sdk,
  );
  try {
    assert.equal(connection.oauthSettings().clientSecret, value);
    const redacted = connection.redact(`invalid_client: client_secret=${value}`);
    assert.ok(!redacted.includes(value), redacted);
  } finally {
    await connection.close();
  }
});

test("mcpOAuthUrl follows the SDK: an HTTP entry without an Authorization header, in any case", () => {
  assert.equal(mcpOAuthUrl({ url: "https://a.example/mcp" }), "https://a.example/mcp");
  assert.equal(mcpOAuthUrl({ url: "https://a.example/mcp", headers: { "X-Api": "v" } }), "https://a.example/mcp");
  assert.equal(mcpOAuthUrl({ url: "https://a.example/mcp", headers: { authorization: "Bearer x" } }), undefined);
  assert.equal(mcpOAuthUrl({ url: "https://a.example/mcp", headers: { AUTHORIZATION: "Bearer x" } }), undefined);
  // A pi provider's token instead of OAuth.
  assert.equal(mcpOAuthUrl({ url: "https://a.example/mcp", auth: { provider: "radius" } }), undefined);
  assert.equal(mcpOAuthUrl({ command: "node" }), undefined);
});

test("signing out deletes the server's credentials, cancels its sign-in, and never creates mcp-auth.json", async () => {
  const internals = await loadPiSdkInternals();
  assert.equal(internals.ok, true, internals.reason);
  const authPath = join(agentDir, "mcp-auth.json");
  await rm(authPath, { force: true });
  assert.equal(signOutMcpServer("a", "https://a.example/mcp", agentDir, internals), false);
  assert.equal(existsSync(authPath), false, "nothing to sign out of creates nothing");

  const url = String(new URL("https://a.example/mcp"));
  const key = mcpSignInKey("a-server", url);
  const sameUrl = mcpSignInKey("other", url);
  const other = mcpSignInKey("a-server", "https://b.example/mcp");
  await writeFile(authPath, `${JSON.stringify({
    [key]: { serverUrl: url, tokens: { access_token: "a" } },
    [sameUrl]: { serverUrl: url, tokens: { access_token: "o" } },
    [other]: { serverUrl: "https://b.example/mcp" },
  }, null, 2)}\n`);
  assert.equal(key, "mcp__a_server|https://a.example/mcp", "the SDK's key: the namespace, `-` as `_`, and the URL");
  const entry = target({ name: "a-server", url, config: { url } });
  const { deps } = stubDeps();
  const { flow } = startMcpSignIn(entry, deps);
  await until(phaseOf(flow.flowId), (phase) => phase === "authorize");
  assert.equal(signOutMcpServer("a-server", url, agentDir, internals), true);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(authPath, "utf8"))), [sameUrl, other], "another server of the URL keeps its account");
  assert.equal(readMcpSignIn(flow.flowId).phase, "cancelled");
  assert.equal(signOutMcpServer("a-server", url, agentDir, internals), false);

  // A record older versions kept under the URL alone is the one a server without its own reads, and removes.
  await writeFile(authPath, `${JSON.stringify({ [url]: { serverUrl: url, tokens: { access_token: "legacy" } } }, null, 2)}\n`);
  assert.equal(signOutMcpServer("a-server", url, agentDir, internals), true);
  assert.deepEqual(JSON.parse(readFileSync(authPath, "utf8")), {});
});

/** mcp-auth.json as the SDK's store writes it, holding `states`. */
async function writeAuthFile(states) {
  await writeFile(join(agentDir, "mcp-auth.json"), `${JSON.stringify(states, null, 2)}\n`);
}

function storedAuth() {
  return JSON.parse(readFileSync(join(agentDir, "mcp-auth.json"), "utf8"));
}

test("signing out stops a code exchange already on its way from storing its tokens", async () => {
  const internals = await loadPiSdkInternals();
  assert.equal(internals.ok, true, internals.reason);
  const url = "https://exchange.example/mcp";
  const entry = target({ url, config: { url } });
  const key = mcpSignInKey(entry.name, url);
  await writeAuthFile({ [key]: { serverUrl: url, tokens: { access_token: "old", token_type: "Bearer" } } });
  const exchange = deferred();
  let outcome;
  const { deps } = stubDeps({
    signIn: async (options) => {
      await options.store.save({ ...(await options.store.load()), oauthState: STATE });
      options.prompt.showAuthorizationUrl(new URL(PAGE));
      const input = await options.prompt.promptForRedirectUrl(new AbortController().signal);
      if (!input?.trim()) throw new Cancelled();
      // The token request, still on its way when Sign out is pressed; a cancel cannot reach it.
      await exchange.promise;
      try {
        await options.store.save({ ...(await options.store.load()), tokens: { access_token: "new", token_type: "Bearer" } });
        outcome = "stored";
      } catch (error) {
        outcome = error.name;
        throw error;
      }
    },
  });
  // The SDK's own store, over the temporary mcp-auth.json.
  deps.store = (name, serverUrl) => new internals.McpOAuthCredentialStore().forServer(name, serverUrl);
  const { flow } = startMcpSignIn(entry, deps);
  await until(phaseOf(flow.flowId), (phase) => phase === "authorize");
  assert.equal(pasteMcpSignInRedirect(flow.flowId, `${REDIRECT}?code=c&state=${STATE}`).ok, true);
  assert.equal(signOutMcpServer(entry.name, url, agentDir, internals), true);
  assert.equal(key in storedAuth(), false);
  exchange.resolve();
  await until(() => outcome, Boolean);
  assert.equal(outcome, "McpSignedOutError");
  assert.equal(key in storedAuth(), false, "the exchange that answered after the sign-out stored nothing");
  assert.equal(readMcpSignIn(flow.flowId).phase, "cancelled");
});

test("signing out also bars a cancelled run that is still refreshing, but not a sign-in started after it", async () => {
  const internals = await loadPiSdkInternals();
  assert.equal(internals.ok, true, internals.reason);
  const url = "https://refresh.example/mcp";
  const name = "refreshing";
  const key = mcpSignInKey(name, url);
  await writeAuthFile({ [key]: { serverUrl: url, tokens: { access_token: "old", refresh_token: "r", token_type: "Bearer" } } });
  const sdkStore = (storeName, serverUrl) => new internals.McpOAuthCredentialStore().forServer(storeName, serverUrl);
  const refresh = deferred();
  let outcome;
  const stuck = stubDeps({
    signIn: async (options) => {
      // A stored refresh token being renewed: no page and no prompt, nothing a cancel can answer.
      await refresh.promise;
      try {
        await options.store.save({ ...(await options.store.load()), tokens: { access_token: "renewed", token_type: "Bearer" } });
        outcome = "stored";
      } catch (error) {
        outcome = error.name;
        throw error;
      }
    },
  });
  stuck.deps.store = sdkStore;
  const old = startMcpSignIn(target({ name, url, config: { url } }), stuck.deps).flow;
  await until(phaseOf(old.flowId), (phase) => phase === "starting");
  // Cancelled first: the flow has ended, but its refresh is still out.
  assert.equal(cancelMcpSignIn(old.flowId).phase, "cancelled");
  assert.equal(signOutMcpServer(name, url, agentDir, internals), true);

  // A sign-in started after the sign-out waits for the old run, then stores what it gets.
  const next = stubDeps({
    signIn: async (options) => {
      await options.store.save({ serverUrl: url, tokens: { access_token: "fresh", token_type: "Bearer" } });
    },
  });
  next.deps.store = sdkStore;
  const fresh = startMcpSignIn(target({ name, url, config: { url } }), next.deps).flow;
  refresh.resolve();
  await until(() => outcome, Boolean);
  assert.equal(outcome, "McpSignedOutError");
  const done = await until(() => readMcpSignIn(fresh.flowId), (info) => info?.phase === "done");
  assert.equal(done.refreshed, true);
  assert.equal(storedAuth()[key].tokens.access_token, "fresh");
});

test("a sign-in's connection gets the guard its credential store calls before writing", async () => {
  const internals = await loadPiSdkInternals();
  assert.equal(internals.ok, true, internals.reason);
  let guard;
  const { deps } = stubDeps();
  const open = deps.open;
  deps.open = (entry, given) => {
    guard = given;
    return open(entry, given);
  };
  const entry = target();
  const { flow } = startMcpSignIn(entry, deps);
  await until(phaseOf(flow.flowId), (phase) => phase === "authorize");
  assert.doesNotThrow(() => guard());
  signOutMcpServer(entry.name, entry.url, agentDir, internals);
  assert.throws(() => guard(), McpSignedOutError);
  assert.equal(readMcpSignIn(flow.flowId).phase, "cancelled");
  // Another server's sign-out moves nothing for a run of this one, even at the same URL.
  const other = target();
  let otherGuard;
  const second = stubDeps();
  const openOther = second.deps.open;
  second.deps.open = (value, given) => {
    otherGuard = given;
    return openOther(value, given);
  };
  startMcpSignIn(other, second.deps);
  await until(() => otherGuard, Boolean);
  const elsewhere = target();
  signOutMcpServer(elsewhere.name, elsewhere.url, agentDir, internals);
  signOutMcpServer("another-name", other.url, agentDir, internals);
  assert.doesNotThrow(() => otherGuard());
});

test("guardedCredentialStore is the SDK's store over mcp-auth.json, whose writes call the guard first", async () => {
  const internals = await loadPiSdkInternals();
  assert.equal(internals.ok, true, internals.reason);
  const url = "https://guarded.example/mcp";
  const key = mcpSignInKey("guarded", url);
  let allowed = true;
  const credentials = guardedCredentialStore(internals, () => {
    if (!allowed) throw new McpSignedOutError();
  });
  // The connection needs the SDK's class: it is what the SDK's connection was built for.
  assert.ok(credentials instanceof internals.McpOAuthCredentialStore);
  const store = credentials.forServer("guarded", url);
  await store.save({ serverUrl: url, tokens: { access_token: "a", token_type: "Bearer" } });
  assert.equal((await store.load()).tokens.access_token, "a");
  assert.equal(await store.withRefreshLock(async () => 42), 42);
  allowed = false;
  assert.throws(() => store.save({ serverUrl: url, tokens: { access_token: "b", token_type: "Bearer" } }), McpSignedOutError);
  assert.equal(storedAuth()[key].tokens.access_token, "a");
  assert.equal((await store.load()).tokens.access_token, "a", "reading still works");
  assert.equal(credentials.remove("guarded", url), true);
});

test("a sign-in that has its code when the limit comes gets one grace period to finish", async () => {
  const reconnect = deferred();
  const { deps } = stubDeps({ after: () => reconnect });
  const { flow } = startMcpSignIn(target(), deps, { ttlMs: 150, finishGraceMs: 150 });
  await until(phaseOf(flow.flowId), (phase) => phase === "authorize");
  pasteMcpSignInRedirect(flow.flowId, `${REDIRECT}?code=c&state=${STATE}`);
  await delay(200);
  // Past the limit, still finishing: the SDK exchanges the code whatever Pi Web does.
  assert.equal(readMcpSignIn(flow.flowId).phase, "finishing");
  assert.ok(readMcpSignIn(flow.flowId).expiresInMs > 0);
  // The grace runs out once; the flow then expires, and the late answer changes nothing.
  await until(phaseOf(flow.flowId), (phase) => phase === "expired", 1_000);
  reconnect.resolve(run("connected"));
  await delay(20);
  assert.equal(readMcpSignIn(flow.flowId).phase, "expired");
});
