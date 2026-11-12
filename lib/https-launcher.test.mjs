import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import nodeTls from "node:tls";
import { X509Certificate } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startHttpsServer } from "../bin/https-launcher.js";
import { readTlsFiles } from "../bin/http2-gateway.js";
import records from "../bin/run-records.js";
import { runCommand } from "../bin/pi-web-commands.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-https-launcher-test-"));
const certFile = path.join(root, "cert.pem");
const keyFile = path.join(root, "key.pem");
assert.equal(spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", keyFile, "-out", certFile], { stdio: "ignore" }).status, 0);
const tls = readTlsFiles(certFile, keyFile);
const nextBin = path.join(root, "fake-next.js");
// A real child and HTTP backend, NOT a Next/SDK/application acceptance test.
fs.writeFileSync(nextBin, `
const http = require('node:http');
const args = process.argv;
const port = Number(args[args.indexOf('-p') + 1]);
const host = args[args.indexOf('-H') + 1];
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(307, { Location: 'https://127.0.0.1:' + port + '/login' }); res.end(); return; }
  if (req.url === '/login') { res.write('first page'); setTimeout(() => res.end(' rendered'), 100); return; }
  if (req.url === '/events') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: open\\n\\n'); return; }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => res.end(JSON.stringify({ host: req.headers.host, proto: req.headers['x-forwarded-proto'], configuredHost: process.env.PI_WEB_HOSTNAME, bind: server.address().address, body: Buffer.concat(chunks).toString() })));
});
server.on('error', e => { console.error(e.code); process.exit(1); });
server.listen(port, host, () => {
  console.log('Network: http://127.0.0.1:' + port);
  process.stdout.write('Re');
  setTimeout(() => { console.log('ady'); console.log('synthetic runtime diagnostic'); }, 20);
});
`);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function temp(t) {
  const dir = fs.mkdtempSync(path.join(root, "case-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function parent() { const p = new EventEmitter(); p.pid = process.pid; return p; }
const options = { port: "0", hostname: "127.0.0.1", openBrowser: false, ...tls, nextBin, pkgDir: root, version: "test" };
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { ca: tls.cert, agent: false }, (res) => {
      res.resume(); res.on("end", () => resolve(res.statusCode)); res.on("error", reject);
    }).on("error", reject);
  });
}
async function waitUntil(fn, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = fn(); if (value) return value; await new Promise((r) => setTimeout(r, 20)); }
  assert.fail("timed out waiting for test fixture");
}

test("HTTPS launcher gates public traffic until owned child Ready + redirected full page; records/opens only public URL and keeps runtime stdout", async (t) => {
  const dir = temp(t);
  const opened = [];
  const output = [];
  let captured;
  let beforeUrl;
  const p = parent();
  const started = Date.now();
  const running = await startHttpsServer({ ...options, hostname: "localhost", openBrowser: true }, {
    parentProcess: p, runDir: dir, log: () => {}, error: () => {}, stdout: (s) => output.push(s), open: (url) => opened.push(url),
    spawnImpl: (cmd, args, init) => { captured = { args, init }; return spawn(cmd, args, init); },
    beforeSpawn: async ({ url }) => { beforeUrl = url; assert.equal(await get(url), 503); assert.deepEqual(fs.readdirSync(dir), []); },
  });
  t.after(() => running.close());
  assert.ok(Date.now() - started >= 100, "full redirected body, not Ready/headers alone");
  assert.equal(running.record.url, beforeUrl);
  assert.deepEqual(opened, [beforeUrl]);
  assert.match(beforeUrl, /^https:\/\/localhost:\d+$/);
  assert.equal(captured.args.at(-1), "127.0.0.1");
  assert.equal(captured.init.env.PI_WEB_HOSTNAME, "localhost");
  assert.ok(!captured.args.includes(keyFile));
  assert.ok(!Object.values(captured.init.env).includes(tls.key));
  assert.ok(!JSON.stringify(running.record).includes(keyFile));
  assert.match(output.join(""), /synthetic runtime diagnostic/);
  assert.ok(!output.join("").includes(`http://127.0.0.1:${captured.init.env.PORT}`));
  assert.match(output.join(""), /Network: https:\/\/localhost:/);
  const listed = await records.listRunRecords(dir, { isOurs: () => true });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].url, beforeUrl, "self-signed synthetic cert is pinned for credential-free status");
  const messages = [];
  assert.equal(await runCommand({ command: "status" }, { runDir: dir, isOurs: () => true, log: (s) => messages.push(s) }), 0);
  assert.ok(messages[0].includes(beforeUrl));
  assert.equal(await runCommand({ command: "open" }, { runDir: dir, isOurs: () => true, log: () => {}, open: (s) => opened.push(s) }), 0);
  assert.equal(opened.at(-1), beforeUrl);
  assert.equal(await records.isHttpsServerAnswering({ ...running.record, certFingerprint256: "00:".repeat(31) + "00" }), false);
  await running.close();
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(p.listenerCount("SIGTERM"), 0);
  await assert.rejects(get(beforeUrl));
});

test("private-port race: no public request reaches competing listener, startup fails and clears entry/record/child", async (t) => {
  const dir = temp(t);
  const competitor = http.createServer((_req, res) => { reached++; res.end("wrong owner"); });
  let reached = 0;
  let url;
  t.after(() => new Promise((r) => competitor.close(r)));
  await assert.rejects(startHttpsServer(options, {
    parentProcess: parent(), runDir: dir, log: () => {}, error: () => {}, stdout: () => {},
    beforeSpawn: async (target) => {
      url = target.url;
      competitor.listen(target.backendPort, "127.0.0.1"); await once(competitor, "listening");
      assert.equal(await get(url), 503);
      assert.equal(reached, 0, "startup gate must not proxy into the race winner");
    },
  }), /backend exited|cancelled/);
  assert.equal(reached, 0);
  assert.deepEqual(fs.readdirSync(dir), []);
  await assert.rejects(get(url));
});

test("public port conflict fails before spawning; missing child and non-Ready backend time out with cleanup", async (t) => {
  const dir = temp(t);
  const busy = net.createServer(); busy.listen(0, "127.0.0.1"); await once(busy, "listening");
  t.after(() => new Promise((r) => busy.close(r)));
  await assert.rejects(startHttpsServer({ ...options, port: String(busy.address().port) }, {
    parentProcess: parent(), runDir: dir, spawnImpl: () => assert.fail("must not spawn on public port conflict"),
  }), { code: "EADDRINUSE" });
  await assert.rejects(startHttpsServer(options, {
    parentProcess: parent(), runDir: dir, log: () => {}, error: () => {}, stdout: () => {},
    spawnImpl: (_cmd, _args, init) => spawn(path.join(root, "missing-node"), [], init),
  }), /Could not run|cancelled/);
  let child;
  let url;
  await assert.rejects(startHttpsServer(options, {
    parentProcess: parent(), runDir: dir, log: () => {}, error: () => {}, stdout: () => {}, startupTimeoutMs: 150,
    beforeSpawn: async (target) => { url = target.url; },
    spawnImpl: (cmd, _args, init) => { child = spawn(cmd, ["-e", "setInterval(() => {}, 1000)"], init); return child; },
  }), /timed out/);
  assert.notEqual(child.exitCode ?? child.signalCode, null);
  assert.deepEqual(fs.readdirSync(dir), []);
  await assert.rejects(get(url));
});

test("SIGTERM closes live SSE/H2 sessions, private child and run record", async (t) => {
  const dir = temp(t);
  const p = parent();
  const running = await startHttpsServer(options, { parentProcess: p, runDir: dir, log: () => {}, error: () => {}, stdout: () => {} });
  const client = http2.connect(running.record.url, { ca: tls.cert }); client.on("error", () => {});
  t.after(() => client.destroy());
  const stream = client.request({ ":path": "/events" }); stream.on("error", () => {}); stream.end();
  await once(stream, "data");
  const gone = once(client, "close");
  p.emit("SIGTERM");
  await running.close();
  await gone;
  assert.equal(p.exitCode, 143);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.notEqual(running.child.exitCode ?? running.child.signalCode, null);
});

test("HTTPS orphan remains guarded by process identity + fixed-loopback response; open refuses a gone public entry and cleanup respects instance ownership", async (t) => {
  const dir = temp(t);
  const backend = http.createServer((_req, res) => res.end("synthetic private backend"));
  backend.listen(0, "127.0.0.1"); await once(backend, "listening");
  t.after(() => new Promise((r) => backend.close(r)));
  const record = { pid: 10, nextPid: process.pid, backendPort: backend.address().port, scheme: "https", hostname: "localhost", port: 12345, url: "https://localhost:12345", version: "test", startedAt: "now", instanceId: "old" };
  records.writeRunRecord(dir, record);
  const [orphan] = await records.listRunRecords(dir, { isAlive: (pid) => pid === process.pid, isOurs: () => true });
  assert.equal(orphan.stopPid, process.pid);
  assert.match(records.formatRunRecord(orphan), /HTTPS entry gone, private backend remains/);
  const tracker = records.createRunRecordTracker({ dir, record, parentProcess: new EventEmitter() }); tracker.markReady();
  records.writeRunRecord(dir, { ...record, instanceId: "replacement" }); tracker.remove();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "10.json"))).instanceId, "replacement");
  // With launcher pid dead and this real test process as fake child, open must
  // refuse without opening or signalling anything.
  let opened = false;
  assert.equal(await runCommand({ command: "open" }, { runDir: dir, isOurs: () => true, log: () => {}, error: () => {}, open: () => { opened = true; } }), 1);
  assert.equal(opened, false);
  const identity = { isAlive: (pid) => pid === process.pid, isOurs: () => true };
  records.writeRunRecord(dir, { ...record, backendPort: "12345" });
  assert.deepEqual(await records.listRunRecords(dir, { ...identity, isAnswering: () => assert.fail("invalid backend port must not be probed") }), []);
  records.writeRunRecord(dir, record);
  assert.deepEqual(await records.listRunRecords(dir, { ...identity, isAnswering: async () => false }), [], "recycled Next pid without a responding private backend is not stoppable");
  assert.deepEqual(await records.listRunRecords(dir, { ...identity, isOurs: () => false, isAnswering: () => assert.fail("unrelated process is never probed") }), []);
});

test("pinned HTTPS status has a 2s wall-clock deadline even when TLS peer trickles an incomplete status", { timeout: 4000 }, async (t) => {
  const server = nodeTls.createServer(tls, (socket) => {
    const drip = setInterval(() => socket.write("H"), 100);
    socket.on("error", () => {});
    socket.once("close", () => clearInterval(drip));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((r) => server.close(r)));
  const port = server.address().port;
  const began = Date.now();
  assert.equal(await records.isHttpsServerAnswering({ hostname: "127.0.0.1", port, url: `https://127.0.0.1:${port}`, certFingerprint256: new X509Certificate(tls.cert).fingerprint256 }), false);
  assert.ok(Date.now() - began < 2500, `wall-clock bound took ${Date.now() - began}ms`);
});

test("real CLI wiring with fake Next: rotates preview secrets, HTTPS status URL and stop clean launcher and child", { timeout: 15_000 }, async (t) => {
  const dir = temp(t);
  const install = path.join(dir, "install"); fs.mkdirSync(install);
  fs.cpSync(fileURLToPath(new URL("../bin", import.meta.url)), path.join(install, "bin"), { recursive: true });
  fs.writeFileSync(path.join(install, "package.json"), JSON.stringify({ name: "pi-web-test", version: "test" }));
  const nextDir = path.join(install, "node_modules", "next", "dist", "bin"); fs.mkdirSync(nextDir, { recursive: true });
  fs.copyFileSync(nextBin, path.join(nextDir, "next.js"));
  fs.mkdirSync(path.join(install, ".next"));
  const manifestFile = path.join(install, ".next", "prerender-manifest.json");
  const manifest = { preview: { previewModeId: "published-test-id", previewModeSigningKey: "a", previewModeEncryptionKey: "b" }, routes: {} };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const cliPath = path.join(install, "bin", "pi-web.js");
  const env = { ...process.env, HOME: dir, PI_CODING_AGENT_DIR: path.join(dir, "agent") };
  const cli = spawn(process.execPath, [cliPath, "-p", "0", "--no-open", "--https-cert", certFile, "--https-key", keyFile], { env });
  const cliClosed = once(cli, "close");
  let output = ""; cli.stdout.on("data", (c) => { output += c; });
  cli.stderr.resume();
  t.after(() => cli.kill());
  const runDir = records.getRunDir(env);
  const file = await waitUntil(() => {
    try { return fs.readdirSync(runDir).find((name) => name.endsWith(".json")); } catch { return null; }
  });
  const record = JSON.parse(fs.readFileSync(path.join(runDir, file), "utf8"));
  assert.notEqual(JSON.parse(fs.readFileSync(manifestFile)).preview.previewModeId, manifest.preview.previewModeId);
  assert.equal(record.scheme, "https");
  assert.equal(record.pid, cli.pid);
  assert.match(output, new RegExp(record.url.replaceAll(".", "\\.")));
  const status = spawn(process.execPath, [cliPath, "status"], { env });
  let statusText = ""; status.stdout.on("data", (c) => { statusText += c; }); status.stderr.resume();
  assert.equal((await once(status, "close"))[0], 0);
  assert.ok(statusText.includes(record.url));
  const stop = spawn(process.execPath, [cliPath, "stop", "--port", String(record.port)], { env }); stop.stdout.resume(); stop.stderr.resume();
  assert.equal((await once(stop, "close"))[0], 0);
  await cliClosed;
  assert.equal(records.isProcessAlive(record.nextPid), false);
  assert.deepEqual(fs.readdirSync(runDir), []);
  await assert.rejects(get(record.url));
  // Invalid TLS preflight must run before mutating the preview manifest.
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const invalid = spawnSync(process.execPath, [cliPath, "--https-cert", certFile, "--https-key", path.join(dir, "missing.pem")], { env, encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Could not read/);
  assert.equal(JSON.parse(fs.readFileSync(manifestFile)).preview.previewModeId, manifest.preview.previewModeId);
});
