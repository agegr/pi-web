import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHttp2Gateway, readTlsFiles } from "../bin/http2-gateway.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-gateway-test-"));
const certFile = path.join(dir, "cert.pem");
const keyFile = path.join(dir, "key.pem");
const generated = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", keyFile, "-out", certFile], { stdio: "ignore" });
assert.equal(generated.status, 0, "openssl generates temporary test-only PEMs");
const tls = readTlsFiles(certFile, keyFile);
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

async function fixture(t, handler) {
  const backend = http.createServer(handler);
  const sockets = new Set();
  backend.on("connection", (s) => { sockets.add(s); s.once("close", () => sockets.delete(s)); });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const backendPort = backend.address().port;
  const gateway = createHttp2Gateway({ backendPort, ...tls });
  gateway.server.listen(0, "127.0.0.1");
  await once(gateway.server, "listening");
  const port = gateway.server.address().port;
  t.after(async () => { await gateway.close(); for (const s of sockets) s.destroy(); await new Promise((r) => backend.close(r)); });
  return { gateway, backend, backendPort, port, url: `https://127.0.0.1:${port}` };
}

function h2(t, url) {
  const client = http2.connect(url, { ca: tls.cert });
  client.on("error", () => {});
  t.after(() => client.destroy());
  return client;
}

async function request(client, headers = {}, body) {
  const stream = client.request({ ":path": "/", ...headers });
  const chunks = [];
  let response;
  stream.on("response", (h) => { response = h; });
  stream.on("data", (chunk) => chunks.push(chunk));
  const ended = once(stream, "end");
  stream.end(body);
  await ended;
  return { headers: response, body: Buffer.concat(chunks) };
}

function http1(url, options = {}, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { ca: tls.cert, ...options }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("error", reject);
      res.on("end", () => resolve({ headers: res.headers, status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("TLS preflight rejects missing, invalid, encrypted and mismatched PEMs without quoting key input", () => {
  assert.throws(() => readTlsFiles("missing", keyFile), /Could not read/);
  const invalid = path.join(dir, "invalid.pem");
  fs.writeFileSync(invalid, "SECRET-TEST-NOT-A-KEY");
  assert.throws(() => readTlsFiles(certFile, invalid), (e) => /Invalid/.test(e.message) && !e.message.includes("SECRET-TEST"));
  const other = path.join(dir, "other.pem");
  assert.equal(spawnSync("openssl", ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", other], { stdio: "ignore" }).status, 0);
  assert.throws(() => readTlsFiles(certFile, other), /matching unencrypted/);
  const encrypted = path.join(dir, "encrypted.pem");
  assert.equal(spawnSync("openssl", ["pkey", "-in", keyFile, "-aes256", "-passout", "pass:synthetic-test-only", "-out", encrypted], { stdio: "ignore" }).status, 0);
  assert.throws(() => readTlsFiles(certFile, encrypted), /matching unencrypted/);
  assert.throws(() => createHttp2Gateway({ backendPort: 1, cert: "invalid", key: "invalid" }), /invalid TLS/);
});

test("H2 preserves public authority, Origin, body, Range and Set-Cookie; replaces forwarded and filters transport headers", async (t) => {
  let received;
  const f = await fixture(t, (req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received = { headers: req.headers, url: req.url, body: Buffer.concat(chunks) };
      res.writeHead(206, { "Set-Cookie": ["a=1; HttpOnly", "b=2; Secure"], "Content-Range": "bytes 0-3/8", "Connection": "keep-alive, x-backend-hop", "X-Backend-Hop": "remove" });
      res.end("part");
    });
  });
  const client = h2(t, f.url);
  const body = Buffer.alloc(1024 * 1024, 42);
  const out = await request(client, { ":method": "POST", ":path": "/api/files/a?type=upload", ":authority": `localhost:${f.port}`, host: `localhost:${f.port}`, origin: `https://localhost:${f.port}`, cookie: "test=1", range: "bytes=0-3", forwarded: "for=evil;proto=http", "x-forwarded-proto": "http", "x-forwarded-for": "evil", "x-forwarded-host": "evil" }, body);
  assert.equal(out.headers[":status"], 206);
  assert.deepEqual(out.headers["set-cookie"], ["a=1; HttpOnly", "b=2; Secure"]);
  assert.equal(out.headers["content-range"], "bytes 0-3/8");
  assert.equal(out.headers["x-backend-hop"], undefined);
  assert.equal(received.headers.host, `localhost:${f.port}`);
  assert.equal(received.headers.origin, `https://localhost:${f.port}`);
  assert.equal(received.headers["x-forwarded-proto"], "https");
  assert.equal(received.headers["x-forwarded-host"], `localhost:${f.port}`);
  assert.equal(received.headers["x-forwarded-for"], "127.0.0.1");
  assert.equal(received.headers.forwarded, undefined);
  assert.equal(received.headers.cookie, "test=1");
  assert.equal(received.headers.range, "bytes=0-3");
  assert.ok(!Object.keys(received.headers).some((h) => h.startsWith(":")));
  assert.deepEqual(received.body, body);
});

test("maps only fixed-backend Location, leaving relative and legitimate external redirects alone", async (t) => {
  const f = await fixture(t, (req, res) => {
    const values = { "/private": `https://127.0.0.1:${f.backendPort}/login?next=%2F#part`, "/external": "https://example.invalid/login", "/relative": "/login" };
    res.writeHead(307, { Location: values[req.url] }); res.end();
  });
  const client = h2(t, f.url);
  assert.equal((await request(client, { ":path": "/private" })).headers.location, `${f.url}/login?next=%2F#part`);
  assert.equal((await request(client, { ":path": "/external" })).headers.location, "https://example.invalid/login");
  assert.equal((await request(client, { ":path": "/relative" })).headers.location, "/login");
});

test("rejects conflicting Host/authority, absolute-form and H2 wrong scheme before reaching backend", async (t) => {
  let count = 0;
  const f = await fixture(t, (_req, res) => { count++; res.end(); });
  const client = h2(t, f.url);
  const rejected = async (headers) => {
    try { assert.equal((await request(client, headers)).headers[":status"], 400); }
    catch (error) { assert.equal(error.code, "ERR_HTTP2_STREAM_ERROR", "nghttp2 may reject malformed pseudoheaders before the compatibility handler"); }
  };
  await rejected({ ":authority": new URL(f.url).host, host: "other.invalid" });
  await rejected({ ":path": "http://example.invalid/" });
  await rejected({ ":scheme": "http" });
  assert.equal(count, 0);
});

test("real HTTPS/HTTP1 responses reuse the backend keep-alive socket after normal response close", async (t) => {
  let connections = 0;
  const f = await fixture(t, (_req, res) => res.end("ok"));
  f.backend.on("connection", () => connections++);
  const agent = new https.Agent({ keepAlive: true, ca: tls.cert });
  t.after(() => agent.destroy());
  for (let i = 0; i < 30; i++) {
    const out = await http1(f.url, { agent, headers: { "Connection": "keep-alive, x-client-hop", "X-Client-Hop": "remove" } });
    assert.equal(out.body.toString(), "ok");
  }
  assert.equal(connections, 1, "normal close must not destroy a returned/reused private socket");
});

test("SSE streams before completion; cancellation before headers and after data leaves other H2 streams alive", async (t) => {
  const active = new Map();
  const f = await fixture(t, (req, res) => {
    active.set(req.url, res);
    if (req.url === "/delayed") {
      const timer = setTimeout(() => { if (!res.destroyed) res.end("late"); }, 150);
      res.on("close", () => clearTimeout(timer));
    } else { res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write("data: first\n\n"); }
    res.on("close", () => active.delete(req.url));
  });
  const client = h2(t, f.url);
  const a = client.request({ ":path": "/a" }); a.end();
  const b = client.request({ ":path": "/b" }); b.end();
  const delayed = client.request({ ":path": "/delayed" }); delayed.on("error", () => {}); delayed.end();
  await Promise.all([once(a, "data"), once(b, "data")]);
  delayed.close(http2.constants.NGHTTP2_CANCEL);
  a.close(http2.constants.NGHTTP2_CANCEL);
  const next = once(b, "data");
  active.get("/b").write("data: second\n\n");
  assert.equal((await next)[0].toString(), "data: second\n\n");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(active.has("/a"), false);
  assert.equal(active.has("/delayed"), false);
  assert.equal(active.has("/b"), true);
  b.close();
});

test("slow H2 download is backpressured rather than fully buffered; another request completes", async (t) => {
  let written = 0;
  const f = await fixture(t, (req, res) => {
    if (req.url !== "/large") { res.end("short"); return; }
    const chunk = Buffer.alloc(64 * 1024, 7);
    const pump = () => {
      while (!res.destroyed && written < 64 * 1024 * 1024) {
        written += chunk.length;
        if (!res.write(chunk)) { res.once("drain", pump); return; }
      }
      if (!res.destroyed) res.end();
    };
    pump();
  });
  const client = h2(t, f.url);
  const slow = client.request({ ":path": "/large" }); slow.end();
  await once(slow, "response");
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(written < 16 * 1024 * 1024, `only ${written} bytes reached transport buffers`);
  assert.equal((await request(client)).body.toString(), "short");
  slow.close(http2.constants.NGHTTP2_CANCEL);
});

test("512 private requests and 256 streams/session are bounded; close cancels all active H1/H2 traffic and is idempotent", { timeout: 20_000 }, async (t) => {
  let count = 0;
  const f = await fixture(t, (_req, res) => { count++; res.writeHead(200, { "content-type": "text/event-stream" }); res.write("data: open\n\n"); });
  const clients = [h2(t, f.url), h2(t, f.url), h2(t, f.url)];
  const allSettings = await Promise.all(clients.map((client) => once(client, "remoteSettings")));
  for (const [settings] of allSettings) {
    assert.equal(settings.maxConcurrentStreams, 256);
  }
  const opened = [];
  for (const [index, amount] of [200, 200, 112].entries()) {
    for (let n = 0; n < amount; n++) {
      const s = clients[index].request({ ":path": "/events" }); s.on("error", () => {}); s.end();
      opened.push(once(s, "response"));
    }
  }
  await Promise.all(opened);
  assert.equal(count, 512);
  assert.equal((await request(clients[2])).headers[":status"], 503);
  const started = Date.now();
  const closing = f.gateway.close();
  assert.equal(f.gateway.close(), closing);
  await closing;
  assert.ok(Date.now() - started < 2000);
});

test("HTTP1 hop-by-hop nominations cannot erase Origin/auth security checks", async (t) => {
  let reached = false;
  const f = await fixture(t, (_req, res) => { reached = true; res.end(); });
  const result = await http1(f.url, { headers: { Origin: "https://foreign.invalid", Connection: "origin, sec-fetch-site", "Sec-Fetch-Site": "cross-site" } });
  assert.equal(result.status, 400);
  assert.equal(reached, false);
});

test("close cancels mixed live HTTP1 and H2 responses without leaving TLS sockets", async (t) => {
  const f = await fixture(t, (_req, res) => { res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write("data: open\n\n"); });
  const response1 = await new Promise((resolve, reject) => {
    https.get(f.url, { ca: tls.cert, agent: false }, resolve).on("error", reject);
  });
  response1.on("error", () => {}); response1.resume();
  const h1Closed = new Promise((r) => response1.once("close", r));
  const client = h2(t, f.url);
  const stream = client.request({ ":path": "/events" }); stream.on("error", () => {}); stream.end();
  await once(stream, "data");
  const h2Closed = once(client, "close");
  await f.gateway.close();
  await Promise.all([h1Closed, h2Closed]);
});

test("close resolves before listen and after bind failure; unavailable backend is an explicit 502", async (t) => {
  const neverListened = createHttp2Gateway({ backendPort: 1, ...tls });
  await neverListened.close();
  await neverListened.close();
  const f = await fixture(t, (_req, res) => res.end());
  const conflict = createHttp2Gateway({ backendPort: f.backendPort, ...tls });
  conflict.server.listen(f.port, "127.0.0.1");
  const [e] = await once(conflict.server, "error");
  assert.equal(e.code, "EADDRINUSE");
  await conflict.close();
  await new Promise((r) => f.backend.close(r));
  assert.equal((await request(h2(t, f.url))).headers[":status"], 502);
});
