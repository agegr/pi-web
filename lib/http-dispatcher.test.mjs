import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect as netConnect } from "node:net";
import { once } from "node:events";
import test from "node:test";
import { createJiti } from "jiti";

const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "ALL_PROXY",
  "all_proxy",
];

test("tunnels proxied requests and applies the body timeout to a stalled stream", async (t) => {
  const originalEnv = new Map(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of PROXY_ENV_KEYS) delete process.env[key];

  // An origin that sends a first chunk and then goes quiet, the way a provider
  // streaming a long reasoning turn does.
  const origin = createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Transfer-Encoding": "chunked",
    });
    res.write("data: start\n\n");
    // No terminating chunk: the response only ends when the client goes away.
  });
  origin.listen(0, "127.0.0.1");
  await once(origin, "listening");
  const originAddress = origin.address();
  assert.ok(originAddress && typeof originAddress === "object");
  const originPort = originAddress.port;

  // A proxy that answers absolute-form requests directly and tunnels CONNECT.
  const connectTargets = [];
  const forwardedRequests = [];
  const proxy = createServer((req, res) => {
    forwardedRequests.push(`${req.method} ${req.url}`);
    res.writeHead(204, { Connection: "close" });
    res.end();
  });
  proxy.on("connect", (req, clientSocket, head) => {
    connectTargets.push(req.url);
    const [host, port] = req.url.split(":");
    const upstream = netConnect(Number(port), host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");

  t.after(async () => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise((resolve, reject) => {
      proxy.close((error) => error ? reject(error) : resolve());
    });
    await new Promise((resolve, reject) => {
      origin.close((error) => error ? reject(error) : resolve());
    });
  });

  const proxyAddress = proxy.address();
  assert.ok(proxyAddress && typeof proxyAddress === "object");
  const proxyUrl = `http://127.0.0.1:${proxyAddress.port}`;
  process.env.HTTP_PROXY = proxyUrl;
  process.env.HTTPS_PROXY = proxyUrl;
  process.env.NO_PROXY = "bypass.invalid";

  const jiti = createJiti(import.meta.url);
  const { configureHttpDispatcher } = await jiti.import("./http-dispatcher.ts");
  const { getGlobalDispatcher } = await import("undici");

  assert.throws(() => configureHttpDispatcher(-1), /Invalid HTTP idle timeout/);
  configureHttpDispatcher(2_000);

  const dispatcher = getGlobalDispatcher();
  configureHttpDispatcher(5_000);
  assert.equal(getGlobalDispatcher(), dispatcher, "configuration should be idempotent");

  // HTTP origins must go through a CONNECT tunnel. Undici 8.7 switched them to
  // absolute-form requests instead, and that path ignores bodyTimeout and
  // headersTimeout, so a stalled response is never aborted.
  const startedAt = Date.now();
  const response = await fetch(`http://127.0.0.1:${originPort}/stall`, {
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200);
  await assert.rejects(response.text(), (error) => {
    assert.match(String(error.cause?.message ?? error.message), /Body Timeout Error|terminated/i);
    return true;
  });
  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs < 8_000, `stalled body should be aborted by bodyTimeout, took ${elapsedMs}ms`);
  assert.deepEqual(connectTargets, [`127.0.0.1:${originPort}`], "HTTP origin should be tunneled");
  assert.deepEqual(forwardedRequests, [], "no absolute-form forwarding");

  // HTTPS keeps tunneling too.
  connectTargets.length = 0;
  await assert.rejects(fetch("https://target.invalid/through-https-proxy", {
    signal: AbortSignal.timeout(2_000),
  }));
  assert.deepEqual(connectTargets, ["target.invalid:443"]);

  // NO_PROXY still bypasses the proxy.
  const connectTargetCount = connectTargets.length;
  const forwardedRequestCount = forwardedRequests.length;
  await assert.rejects(fetch("http://bypass.invalid:9/no-proxy", {
    signal: AbortSignal.timeout(2_000),
  }));
  assert.equal(forwardedRequests.length, forwardedRequestCount);
  assert.equal(connectTargets.length, connectTargetCount);
});
