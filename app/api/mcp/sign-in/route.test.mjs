import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test, { after, beforeEach } from "node:test";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
import { approveSignIn, startFakeOAuthServer } from "../../../../lib/__fixtures__/mcp-oauth-server.mjs";

// /api/mcp/sign-in connects and writes mcp-auth.json, so every case runs
// against a PI_CODING_AGENT_DIR in a temporary folder and a fake OAuth server
// on 127.0.0.1, never ~/.pi/agent or a real server.
const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-web-mcp-sign-in-route-")));
const agentDir = join(root, "agent");
const cwd = join(root, "project");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousDisable = process.env.PI_WEB_DISABLE_MCP;
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.PI_WEB_DISABLE_MCP;
await mkdir(agentDir, { recursive: true });
await mkdir(join(cwd, ".pi"), { recursive: true });

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { clearMcpStatuses } = await jiti.import("../../../../lib/mcp-status.ts");
const { clearMcpSignIns, mcpSignInUrlKey } = await jiti.import("../../../../lib/mcp-sign-in.ts");
const { POST: START } = await jiti.import("./route.ts");
const flowRoute = await jiti.import("./[flowId]/route.ts");
const mcpRoute = await jiti.import("../route.ts");
allowFileRoot(cwd);

const fake = await startFakeOAuthServer();

after(async () => {
  clearMcpSignIns();
  await fake.close();
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousDisable === undefined) delete process.env.PI_WEB_DISABLE_MCP;
  else process.env.PI_WEB_DISABLE_MCP = previousDisable;
  await rm(root, { recursive: true, force: true });
});

const globalPath = join(agentDir, "mcp.json");
const projectPath = join(cwd, ".pi", "mcp.json");
const authPath = join(agentDir, "mcp-auth.json");
const marker = join(root, "command-ran");
const store = new ProjectTrustStore(agentDir);

beforeEach(async () => {
  delete process.env.PI_WEB_DISABLE_MCP;
  clearMcpSignIns();
  clearMcpStatuses();
  fake.issued.access.clear();
  await rm(authPath, { force: true });
  await rm(marker, { force: true });
  await writeFile(globalPath, `${JSON.stringify({
    mcpServers: {
      oauth: { url: fake.url },
      alias: { url: fake.url, exposure: "direct" },
      keyed: { url: "http://127.0.0.1:9/mcp", headers: { Authorization: "Bearer literal" } },
      lint: { command: process.execPath, args: ["--version"] },
      pw: { url: "https://pw.example.com/mcp", headers: { "X-Key": "${PI_WEB_PASSWORD}" } },
      sse: { type: "sse", url: "https://old.example.com/sse" },
      junk: "not an object",
    },
  }, null, 2)}\n`);
  await writeFile(projectPath, `${JSON.stringify({
    mcpServers: { repo: { url: fake.url, headers: { "X-Probe": `!touch ${marker} && echo probe` } } },
  }, null, 2)}\n`);
  store.set(cwd, null);
});

const json = { host: "localhost", "Content-Type": "application/json" };

async function answer(response) {
  return { status: response.status, body: await response.json() };
}

function start(body, headers = {}) {
  return START(new Request("http://localhost/api/mcp/sign-in", {
    method: "POST",
    headers: { ...json, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })).then(answer);
}

const context = (flowId) => ({ params: Promise.resolve({ flowId }) });

function poll(flowId, headers = {}) {
  return flowRoute.GET(new Request(`http://localhost/api/mcp/sign-in/${flowId}`, { headers: { host: "localhost", ...headers } }), context(flowId)).then(answer);
}

function paste(flowId, body, headers = {}) {
  return flowRoute.POST(new Request(`http://localhost/api/mcp/sign-in/${flowId}`, {
    method: "POST",
    headers: { ...json, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), context(flowId)).then(answer);
}

function cancel(flowId, headers = {}) {
  return flowRoute.DELETE(new Request(`http://localhost/api/mcp/sign-in/${flowId}`, { method: "DELETE", headers: { host: "localhost", ...headers } }), context(flowId)).then(answer);
}

function action(body) {
  return mcpRoute.POST(new Request("http://localhost/api/mcp", { method: "POST", headers: json, body: JSON.stringify(body) })).then(answer);
}

async function listed(query = "") {
  const response = await mcpRoute.GET(new Request(`http://localhost/api/mcp${query}`, { headers: { host: "localhost" } }));
  return (await response.json()).servers;
}

const ENDED = new Set(["done", "failed", "cancelled", "expired"]);

async function until(flowId, predicate, ms = 15_000) {
  for (const started = Date.now(); Date.now() - started < ms;) {
    const { status, body } = await poll(flowId);
    assert.equal(status, 200, JSON.stringify(body));
    if (predicate(body)) return body;
    await delay(20);
  }
  assert.fail(`timed out; last ${JSON.stringify((await poll(flowId)).body)}`);
}

test("a sign-in is started, polled, finished with a pasted address, and the listing shows it", async () => {
  const started = await start({ scope: "global", name: "oauth" });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.phase, "connecting");
  assert.equal(started.body.name, "oauth");
  assert.equal(started.body.joined, undefined);
  const { flowId } = started.body;

  const waiting = await until(flowId, (flow) => flow.phase === "authorize" || ENDED.has(flow.phase));
  assert.equal(waiting.phase, "authorize", waiting.error);
  // Another entry of the same URL joins the sign-in under way instead of starting a second one.
  const joined = await start({ scope: "global", name: "alias" });
  assert.deepEqual([joined.body.flowId, joined.body.joined, joined.body.name], [flowId, true, "oauth"]);

  const landed = await approveSignIn(waiting.authorizationUrl);
  // A bad paste is a 400 with a reason, and the sign-in keeps waiting.
  assert.deepEqual(await paste(flowId, { redirectUrl: "not a url" }), {
    status: 400,
    body: { error: "Expected the full redirected address from the browser's address bar", reason: "redirect-invalid" },
  });
  assert.equal((await paste(flowId, { redirectUrl: landed.replace(/code=[^&]+/, "") })).body.reason, "redirect-no-code");
  assert.equal((await poll(flowId)).body.phase, "authorize");
  const accepted = await paste(flowId, { redirectUrl: landed });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));

  const done = await until(flowId, (flow) => ENDED.has(flow.phase));
  assert.equal(done.phase, "done", done.error);
  assert.equal(done.result.state, "connected", done.result.error);
  const auth = JSON.parse(readFileSync(authPath, "utf8"));
  assert.ok(fake.issued.access.has(auth[mcpSignInUrlKey(fake.url)].tokens.access_token));
  // The listing reads mcp-auth.json raw: signed in, with the reconnect as the status.
  const servers = await listed();
  const oauth = servers.find((server) => server.name === "oauth");
  assert.equal(oauth.signedIn, true);
  assert.equal(oauth.status.state, "connected");
  assert.equal(oauth.status.afterSignIn, true);
  // The tokens serve every entry of the URL; the status is the entry's that signed in.
  assert.equal(servers.find((server) => server.name === "alias").signedIn, true);
});

test("a cancel ends the sign-in, and a flow nobody knows is a 404", async () => {
  const { body } = await start({ scope: "global", name: "oauth" });
  await until(body.flowId, (flow) => flow.phase === "authorize" || ENDED.has(flow.phase));
  const cancelled = await cancel(body.flowId);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.phase, "cancelled");
  assert.equal((await paste(body.flowId, { redirectUrl: "http://127.0.0.1:1/callback?code=c&state=s" })).body.reason, "sign-in-not-waiting");

  const unknown = { status: 404, body: { error: "No sign-in has that id: it ended over a minute ago, or Pi Web restarted", reason: "sign-in-unknown" } };
  assert.deepEqual(await poll("no-such-flow"), unknown);
  assert.deepEqual(await cancel("no-such-flow"), unknown);
  assert.equal((await paste("no-such-flow", { redirectUrl: "http://x/?code=c&state=s" })).status, 404);
});

test("requests from another page, or not sent as JSON, are refused on every route", async () => {
  const foreign = { origin: "https://evil.example", "sec-fetch-site": "cross-site" };
  const denied = { status: 403, body: { error: "Untrusted API request", reason: "request-denied" } };
  assert.deepEqual(await start({ scope: "global", name: "oauth" }, foreign), denied);
  assert.deepEqual(await poll("any", foreign), denied);
  assert.deepEqual(await paste("any", { redirectUrl: "x" }, foreign), denied);
  assert.deepEqual(await cancel("any", foreign), denied);
  const notJson = { status: 415, body: { error: "Content-Type must be application/json", reason: "content-type" } };
  assert.deepEqual(await start({ scope: "global", name: "oauth" }, { "Content-Type": "text/plain" }), notJson);
  assert.deepEqual(await paste("any", { redirectUrl: "x" }, { "Content-Type": "text/plain" }), notJson);
  for (const body of ["{ nope", [], { scope: "elsewhere", name: "oauth" }, { scope: "global" }, { scope: "project", name: "repo" }]) {
    const refused = await start(body);
    assert.equal(refused.status, 400, JSON.stringify(body));
    assert.equal(refused.body.reason, "invalid-request", JSON.stringify(body));
  }
  assert.equal((await paste("any", "{ nope")).body.reason, "invalid-request");
});

test("only an OAuth server Pi Web would connect signs in", async () => {
  assert.deepEqual(await start({ scope: "global", name: "lint" }), {
    status: 409,
    body: { error: "MCP server \"lint\" does not use OAuth: only an HTTP server without an Authorization header does", reason: "sign-in-not-oauth", name: "lint" },
  });
  assert.equal((await start({ scope: "global", name: "keyed" })).body.reason, "sign-in-not-oauth");
  assert.equal((await start({ scope: "global", name: "pw" })).body.reason, "web-password");
  assert.equal((await start({ scope: "global", name: "sse" })).body.reason, "server-invalid");
  assert.equal((await start({ scope: "global", name: "junk" })).body.reason, "entry-not-object");
  assert.equal((await start({ scope: "global", name: "missing" })).body.reason, "server-missing");
  process.env.PI_WEB_DISABLE_MCP = "1";
  assert.deepEqual(await start({ scope: "global", name: "oauth" }), {
    status: 409,
    body: { error: "PI_WEB_DISABLE_MCP is set, so Pi Web connects no MCP server", reason: "mcp-off" },
  });
});

test("an untrusted project's server is never contacted; a trusted one's is", async () => {
  const denied = await start({ scope: "project", name: "repo", cwd });
  assert.deepEqual(denied, {
    status: 403,
    body: { error: "The project is not trusted, so Pi Web does not start its MCP servers", reason: "project-untrusted" },
  });
  store.set(cwd, false);
  assert.equal((await start({ scope: "project", name: "repo", cwd })).status, 403);
  // A folder outside the allowed roots is refused like any cwd.
  assert.equal((await start({ scope: "project", name: "repo", cwd: join(root, "elsewhere") })).body.reason, "cwd-denied");
  assert.equal(existsSync(marker), false, "the project's !command header never ran");

  store.set(cwd, true);
  const started = await start({ scope: "project", name: "repo", cwd });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const waiting = await until(started.body.flowId, (flow) => flow.phase === "authorize" || ENDED.has(flow.phase));
  assert.equal(waiting.phase, "authorize", waiting.error);
  assert.equal(existsSync(marker), true, "trusted, its !command runs as it would in a session");
  await cancel(started.body.flowId);
});

for (const [label, revoke] of [
  ["trust is revoked", () => store.set(cwd, false)],
  ["PI_WEB_DISABLE_MCP is set", () => {
    process.env.PI_WEB_DISABLE_MCP = "1";
  }],
]) {
  test(`a project sign-in finished after ${label} ends signed in without connecting again`, async () => {
    // The route's checks ran minutes before the reconnect with the new tokens; mayConnect asks again.
    store.set(cwd, true);
    const started = await start({ scope: "project", name: "repo", cwd });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const waiting = await until(started.body.flowId, (flow) => flow.phase === "authorize" || ENDED.has(flow.phase));
    assert.equal(waiting.phase, "authorize", waiting.error);
    // The first connect ran the repository's header; only a reconnect would run it again.
    await rm(marker, { force: true });
    revoke();
    assert.equal((await paste(started.body.flowId, { redirectUrl: await approveSignIn(waiting.authorizationUrl) })).status, 200);
    const done = await until(started.body.flowId, (flow) => ENDED.has(flow.phase));
    assert.equal(done.phase, "done", done.error);
    assert.equal(done.result, undefined, "no reconnect result");
    assert.equal(existsSync(marker), false, "the project's !command header did not run again");
  });
}

test("sign-out deletes the URL's tokens through POST /api/mcp, under the checks of any change", async () => {
  const key = mcpSignInUrlKey(fake.url);
  const other = mcpSignInUrlKey("https://other.example/mcp");
  await writeFile(authPath, `${JSON.stringify({ [key]: { serverUrl: key, tokens: { access_token: "a", token_type: "Bearer" } }, [other]: { serverUrl: other } }, null, 2)}\n`);
  assert.equal((await listed()).find((server) => server.name === "oauth").signedIn, true);

  const signedOut = await action({ action: "sign-out", scope: "global", name: "oauth" });
  assert.equal(signedOut.status, 200, JSON.stringify(signedOut.body));
  assert.deepEqual(signedOut.body.signedOut, { scope: "global", name: "oauth", removed: true });
  assert.equal(signedOut.body.servers.find((server) => server.name === "oauth").signedIn, false);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(authPath, "utf8"))), [other]);
  assert.equal((await action({ action: "sign-out", scope: "global", name: "oauth" })).body.signedOut.removed, false);

  assert.equal((await action({ action: "sign-out", scope: "global", name: "lint" })).body.reason, "sign-in-not-oauth");
  assert.equal((await action({ action: "sign-out", scope: "global", name: "missing" })).body.reason, "server-missing");
  assert.equal((await action({ action: "sign-out", scope: "project", name: "repo", cwd })).status, 403);
  process.env.PI_WEB_DISABLE_MCP = "1";
  assert.equal((await action({ action: "sign-out", scope: "global", name: "oauth" })).body.reason, "mcp-off");
});

test("what a cancelled sign-in left behind without tokens is listed as stored, and Sign out removes it", async () => {
  const key = mcpSignInUrlKey(fake.url);
  // A dynamic registration and the PKCE state, saved before the browser was sent to the page.
  await writeFile(authPath, `${JSON.stringify({ [key]: { serverUrl: key, clientInformation: { client_id: "c" }, codeVerifier: "v", oauthState: "s" } }, null, 2)}\n`);
  const server = (await listed()).find((item) => item.name === "oauth");
  assert.deepEqual([server.signedIn, server.oauthStateStored], [false, true]);
  const signedOut = await action({ action: "sign-out", scope: "global", name: "oauth" });
  assert.equal(signedOut.status, 200, JSON.stringify(signedOut.body));
  assert.deepEqual(signedOut.body.signedOut, { scope: "global", name: "oauth", removed: true });
  const after = signedOut.body.servers.find((item) => item.name === "oauth");
  assert.deepEqual([after.signedIn, after.oauthStateStored], [false, false]);
  assert.deepEqual(JSON.parse(readFileSync(authPath, "utf8")), {});
});

test("signing out cancels a sign-in under way and forgets what connections found", async () => {
  const { body } = await start({ scope: "global", name: "oauth" });
  await until(body.flowId, (flow) => flow.phase === "authorize" || ENDED.has(flow.phase));
  // The first connect recorded needs-auth for the entry.
  assert.equal((await listed()).find((server) => server.name === "oauth").status.state, "needs-auth");
  const signedOut = await action({ action: "sign-out", scope: "global", name: "oauth" });
  assert.equal(signedOut.status, 200, JSON.stringify(signedOut.body));
  assert.equal((await poll(body.flowId)).body.phase, "cancelled");
  assert.equal(signedOut.body.servers.find((server) => server.name === "oauth").status, undefined);
});
