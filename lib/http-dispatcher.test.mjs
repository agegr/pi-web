import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { configureHttpDispatcher, isBunRuntime } = await jiti.import("./http-dispatcher.ts");

/**
 * A CONNECT-capable HTTP proxy that records what it was asked to reach.
 *
 * Plain `http://` requests arrive as absolute-URI forwards (recorded, answered
 * 204); `https://` arrives as CONNECT. Both shapes are recorded because Bun and
 * undici pick different ones for plain HTTP.
 */
async function startRecordingProxy(t) {
  const connectTargets = [];
  const forwardedRequests = [];
  const tunneledRequests = [];
  const proxy = createServer((req, res) => {
    forwardedRequests.push(`${req.method} ${req.url}`);
    res.writeHead(204, { Connection: "close" });
    res.end();
  });
  proxy.on("connect", (req, socket) => {
    connectTargets.push(req.url);
    if (req.url?.endsWith(":80")) {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      socket.once("data", (chunk) => {
        tunneledRequests.push(chunk.toString("utf8").split("\r\n", 1)[0]);
        socket.end("HTTP/1.1 204 No Content\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      });
      return;
    }
    socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  t.after(() => new Promise((resolve, reject) => {
    proxy.close((error) => error ? reject(error) : resolve());
  }));

  const address = proxy.address();
  assert.ok(address && typeof address === "object");
  return { url: `http://127.0.0.1:${address.port}`, connectTargets, forwardedRequests, tunneledRequests };
}

test("rejects an invalid idle timeout and configures at most once", () => {
  assert.throws(() => configureHttpDispatcher(-1), /Invalid HTTP idle timeout/);
  assert.throws(() => configureHttpDispatcher("nope"), /Invalid HTTP idle timeout/);
  configureHttpDispatcher(2_000);
  configureHttpDispatcher(5_000);
});

const bunOnly = isBunRuntime() ? test : test.skip;
const nodeOnly = isBunRuntime() ? test.skip : test;

// Bun reads the proxy environment once at process start, so proxying can only
// be observed from a child process launched with the variables already set.
bunOnly("Bun's fetch routes remote hosts through HTTP_PROXY and reaches loopback directly", async (t) => {
  const proxy = await startRecordingProxy(t);
  const direct = createServer((_req, res) => {
    res.writeHead(200, { Connection: "close" });
    res.end("direct");
  });
  direct.listen(0, "127.0.0.1");
  await once(direct, "listening");
  t.after(() => new Promise((resolve, reject) => {
    direct.close((error) => error ? reject(error) : resolve());
  }));
  const directPort = direct.address().port;

  const script = `
    try {
      const res = await fetch("http://target.invalid/through-http-proxy", { signal: AbortSignal.timeout(5000) });
      console.log("proxied:" + res.status);
    } catch (error) { console.log("proxied-error:" + error.message); }
    try {
      const res = await fetch("http://127.0.0.1:${directPort}/local", { signal: AbortSignal.timeout(5000) });
      console.log("loopback:" + (await res.text()));
    } catch (error) { console.log("loopback-error:" + error.message); }
  `;

  const child = spawn(process.execPath, ["-e", script], {
    env: { ...process.env, HTTP_PROXY: proxy.url, HTTPS_PROXY: proxy.url },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  const [code] = await once(child, "exit");

  assert.equal(code, 0, output);
  assert.match(output, /proxied:204/);
  // Bun forwards plain HTTP as an absolute-URI request rather than CONNECT.
  assert.deepEqual(proxy.forwardedRequests, ["GET http://target.invalid:80/through-http-proxy"]);
  // Local providers (ollama, lm-studio, llama.cpp) must not be proxied.
  assert.match(output, /loopback:direct/);
  assert.equal(proxy.forwardedRequests.length + proxy.connectTargets.length, 1);
});

// On Node the same coverage runs in-process through undici's proxy agent.
nodeOnly("undici's global dispatcher proxies fetch on Node", async (t) => {
  const proxy = await startRecordingProxy(t);
  process.env.HTTP_PROXY = proxy.url;
  process.env.HTTPS_PROXY = proxy.url;
  process.env.NO_PROXY = "bypass.invalid";
  t.after(() => {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.NO_PROXY;
  });

  const { configureHttpDispatcher: configure } = await createJiti(import.meta.url).import("./http-dispatcher.ts");
  await configure(2_000);

  const httpResponse = await fetch("http://target.invalid/through-http-proxy", {
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(httpResponse.status, 204);
  assert.deepEqual(proxy.connectTargets, ["target.invalid:80"]);
  assert.deepEqual(proxy.tunneledRequests, ["GET /through-http-proxy HTTP/1.1"]);

  await assert.rejects(fetch("http://bypass.invalid:9/no-proxy", { signal: AbortSignal.timeout(2_000) }));
  assert.deepEqual(proxy.connectTargets, ["target.invalid:80"]);
});
