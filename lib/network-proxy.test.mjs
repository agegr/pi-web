import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  clearSavedNetworkProxyConfig,
  normalizeNoProxy,
  normalizeProxySettings,
  readSavedNetworkProxyConfig,
  resolveEffectiveNetworkProxy,
  writeSavedNetworkProxyConfig,
} = await jiti.import("./network-proxy.ts");

const PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "ALL_PROXY", "all_proxy"];

function cleanProxyEnvironment(t) {
  const original = new Map(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of PROXY_ENV_KEYS) delete process.env[key];
  t.after(() => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("normalizes proxy URLs and loopback bypasses", () => {
  assert.deepEqual(normalizeProxySettings({ enabled: true, httpsProxy: "proxy.company:8080", noProxy: ".company" }), {
    enabled: true,
    httpProxy: undefined,
    httpsProxy: "http://proxy.company:8080",
    noProxy: "localhost,127.0.0.1,::1,.company",
  });
  assert.equal(normalizeNoProxy("localhost;EXAMPLE.com,example.com"), "localhost,127.0.0.1,::1,EXAMPLE.com");
});

test("rejects unsupported proxy URL protocols", () => {
  assert.throws(() => normalizeProxySettings({ enabled: true, httpsProxy: "socks://proxy:1080" }), /http:\/\/ or https:\/\//);
});

test("persists and clears a private saved override", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-network-"));
  const configPath = path.join(root, "network.json");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  writeSavedNetworkProxyConfig({ enabled: true, httpProxy: "proxy:8080", noProxy: ".company" }, configPath);
  const saved = readSavedNetworkProxyConfig(configPath);
  assert.equal(saved?.httpProxy, "http://proxy:8080");
  if (process.platform !== "win32") assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
  clearSavedNetworkProxyConfig(configPath);
  assert.equal(readSavedNetworkProxyConfig(configPath), null);
});

test("uses environment, saved, Windows, then direct precedence", async (t) => {
  cleanProxyEnvironment(t);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-network-"));
  const configPath = path.join(root, "network.json");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const windows = { available: true, proxyEnabled: true, httpProxy: "http://windows:8080", httpsProxy: "http://windows:8080", autoDetect: false };

  let resolved = await resolveEffectiveNetworkProxy({ configPath, windows });
  assert.equal(resolved.effective.source, "windows-system");

  writeSavedNetworkProxyConfig({ enabled: true, httpsProxy: "http://saved:8080" }, configPath);
  resolved = await resolveEffectiveNetworkProxy({ configPath, windows });
  assert.equal(resolved.effective.source, "saved");

  process.env.HTTPS_PROXY = "http://environment:8080";
  resolved = await resolveEffectiveNetworkProxy({ configPath, windows });
  assert.equal(resolved.effective.source, "environment");
  assert.equal(resolved.effective.environmentLocked, true);

  delete process.env.HTTPS_PROXY;
  clearSavedNetworkProxyConfig(configPath);
  resolved = await resolveEffectiveNetworkProxy({ configPath, windows: { ...windows, proxyEnabled: false } });
  assert.equal(resolved.effective.source, "direct");
});
