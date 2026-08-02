import assert from "node:assert/strict";
import { createServer } from "node:http";
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

test("configures HTTP_PROXY, HTTPS_PROXY, and NO_PROXY for global fetch", async (t) => {
  const originalEnv = new Map(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of PROXY_ENV_KEYS) delete process.env[key];

  const connectTargets = [];
  const tunneledRequests = [];
  const proxy = createServer((req, res) => {
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

  t.after(async () => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise((resolve, reject) => {
      proxy.close((error) => (error ? reject(error) : resolve()));
    });
  });

  const address = proxy.address();
  assert.ok(address && typeof address === "object");
  const proxyUrl = `http://127.0.0.1:${address.port}`;
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

  const httpResponse = await fetch("http://target.invalid/through-http-proxy", {
    signal: AbortSignal.timeout(2_000),
  });
  assert.equal(httpResponse.status, 204);
  assert.deepEqual(connectTargets, ["target.invalid:80"]);
  assert.deepEqual(tunneledRequests, ["GET /through-http-proxy HTTP/1.1"]);

  await assert.rejects(
    fetch("https://target.invalid/through-https-proxy", {
      signal: AbortSignal.timeout(2_000),
    }),
  );
  assert.deepEqual(connectTargets, ["target.invalid:80", "target.invalid:443"]);

  const proxiedRequestCount = connectTargets.length;
  await assert.rejects(
    fetch("http://bypass.invalid:9/no-proxy", {
      signal: AbortSignal.timeout(2_000),
    }),
  );
  assert.equal(connectTargets.length, proxiedRequestCount);
});
