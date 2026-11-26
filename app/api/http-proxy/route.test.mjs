import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(join(tmpdir(), "pi-web-http-proxy-route-"));
const settingsPath = join(agentDir, "settings.json");
const proxyKeys = ["http_proxy", "https_proxy", "no_proxy", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"];
const originalEnv = new Map(["PI_CODING_AGENT_DIR", ...proxyKeys].map((key) => [key, process.env[key]]));
for (const key of proxyKeys) delete process.env[key];
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(async () => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(agentDir, { recursive: true, force: true });
});

const { GET, PUT } = await createJiti(import.meta.url, { alias: { "@": process.cwd() } }).import("./route.ts");

function put(body, headers = { host: "localhost", "Content-Type": "application/json" }) {
  return PUT(new Request("http://localhost/api/http-proxy", {
    method: "PUT", headers, body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

test("reads hand edits and reports each protocol's source without exposing credentials", async (t) => {
  const off = await put({ enabled: false });
  assert.deepEqual(await off.json(), { enabled: false, displayAddress: null, sources: { http: "direct", https: "direct" } });
  await assert.rejects(readFile(settingsPath), { code: "ENOENT" });

  process.env.HTTP_PROXY = "http://env-user:password@environment.example";
  t.after(() => {
    delete process.env.HTTP_PROXY;
    delete process.env.https_proxy;
  });
  assert.deepEqual(await (await GET()).json(), {
    enabled: false, displayAddress: null, sources: { http: "HTTP_PROXY", https: "HTTP_PROXY" },
  });
  await writeFile(settingsPath, JSON.stringify({ httpProxy: "http://user:password@file.example:8080" }));
  const response = await GET();
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    enabled: true, displayAddress: "http://file.example:8080", sources: { http: "HTTP_PROXY", https: "settings" },
  });
  delete process.env.HTTP_PROXY;
  process.env.https_proxy = "http://https-env.example";
  assert.deepEqual((await (await GET()).json()).sources, {
    http: "settings", https: process.platform === "win32" ? "HTTPS_PROXY" : "https_proxy",
  });
  await writeFile(settingsPath, JSON.stringify({ httpProxy: "broken" }));
  assert.equal((await (await GET()).json()).enabled, false);
});

async function listen(t, server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${server.address().port}`;
}

test("saving and clearing the proxy changes the next fetch and preserves other settings", async (t) => {
  await writeFile(settingsPath, JSON.stringify({ theme: "dark" }));
  const origin = createServer((_req, res) => res.writeHead(200, { Connection: "close" }).end("ok"));
  const originUrl = await listen(t, origin);
  const targets = [];
  const proxy = createServer();
  proxy.on("connect", (req, socket) => {
    targets.push(req.url);
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    origin.emit("connection", socket);
  });
  const proxyUrl = await listen(t, proxy);
  const on = await put({ enabled: true, httpProxy: ` ${proxyUrl} ` });
  assert.equal(on.status, 200);
  assert.deepEqual(await on.json(), { enabled: true, displayAddress: proxyUrl, sources: { http: "settings", https: "settings" } });
  for (const [address, reason] of [[undefined, "proxy-required"], [" ", "proxy-required"], ["broken", "invalid-proxy"]]) {
    const refused = await put({ enabled: true, httpProxy: address });
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).reason, reason);
  }
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { theme: "dark", httpProxy: proxyUrl });
  const request = async () => assert.equal(await (await fetch(originUrl, { signal: AbortSignal.timeout(2_000) })).text(), "ok");
  await request();
  assert.deepEqual(targets, [new URL(originUrl).host]);

  const off = await put({ enabled: false });
  assert.equal(off.status, 200);
  assert.equal((await off.json()).enabled, false);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { theme: "dark" });
  await request();
  assert.equal(targets.length, 1, "the request after disabling goes direct");
});

test("rejects malformed requests and leaves a broken settings file untouched", async () => {
  await writeFile(settingsPath, "{ not json");
  assert.equal((await put({ enabled: "yes" })).status, 400);
  assert.equal((await put("{")).status, 400);
  assert.equal((await put({ enabled: false }, { host: "localhost", "Content-Type": "text/plain" })).status, 415);
  assert.equal((await put({ enabled: false }, { host: "localhost", origin: "https://other.example", "Content-Type": "application/json" })).status, 403);
  assert.equal((await GET()).status, 500);
  assert.equal((await put({ enabled: false })).status, 500);
  assert.equal(await readFile(settingsPath, "utf8"), "{ not json");
});
