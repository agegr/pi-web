import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  envFirst,
  hostBypassesProxy,
  resolveHttpsProxyUrl,
  resolveNoProxy,
} = await jiti.import("./transport.ts");

test("resolves HTTPS proxy settings without changing global fetch", () => {
  const env = {
    HTTPS_PROXY: "http://secure-proxy.invalid:8443",
    HTTP_PROXY: "http://fallback.invalid:8080",
    NO_PROXY: "localhost,.cursor.sh",
  };
  assert.equal(envFirst(env, ["MISSING", "HTTP_PROXY"]), env.HTTP_PROXY);
  assert.equal(resolveHttpsProxyUrl(env), "http://secure-proxy.invalid:8443/");
  assert.equal(resolveNoProxy(env), env.NO_PROXY);
});

test("NO_PROXY matches exact hosts, suffixes, ports, and wildcard", () => {
  assert.equal(hostBypassesProxy("localhost", "localhost"), true);
  assert.equal(hostBypassesProxy("api2.cursor.sh", ".cursor.sh"), true);
  assert.equal(hostBypassesProxy("api2.cursor.sh", "cursor.sh:443"), true);
  assert.equal(hostBypassesProxy("notcursor.sh", ".cursor.sh"), false);
  assert.equal(hostBypassesProxy("anything.invalid", "*"), true);
});

test("ignores unsupported and malformed proxy URLs", () => {
  assert.equal(resolveHttpsProxyUrl({ HTTPS_PROXY: "socks5://proxy.invalid" }), "");
  assert.equal(resolveHttpsProxyUrl({ HTTPS_PROXY: "://" }), "");
  assert.equal(resolveHttpsProxyUrl({}), "");
});

test("bounds proxy TLS handshakes and sends the Connect protocol header", async () => {
  const source = await readFile(new URL("./transport.ts", import.meta.url), "utf8");
  assert.match(source, /Proxy TLS handshake timed out/);
  assert.match(source, /"connect-protocol-version": "1"/);
  assert.doesNotMatch(source, /child_process|process\.exit/);
});
