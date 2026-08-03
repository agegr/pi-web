import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  normalizeWindowsProxyOverride,
  parseWindowsInternetSettings,
  parseWindowsProxyServer,
} = await jiti.import("./windows-system-proxy.ts");

test("parses a shared Windows proxy endpoint", () => {
  assert.deepEqual(parseWindowsProxyServer("proxy.company:8080"), {
    httpProxy: "http://proxy.company:8080",
    httpsProxy: "http://proxy.company:8080",
  });
});

test("parses per-protocol Windows proxy endpoints", () => {
  assert.deepEqual(parseWindowsProxyServer("http=http-proxy:8080;https=https-proxy:8443;socks=socks-proxy:1080"), {
    httpProxy: "http://http-proxy:8080",
    httpsProxy: "http://https-proxy:8443",
  });
});

test("normalizes Windows proxy bypass values", () => {
  assert.equal(normalizeWindowsProxyOverride("<local>;localhost;*.company.internal"), "<local>,localhost,*.company.internal");
});

test("parses fixed proxy, PAC, and WPAD registry output", () => {
  const parsed = parseWindowsInternetSettings(`
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    http=proxy-a:8080;https=proxy-b:8443
    ProxyOverride    REG_SZ    <local>;localhost;*.company.internal
    AutoConfigURL    REG_SZ    http://wpad.company/proxy.pac
    AutoDetect    REG_DWORD    0x1
`);
  assert.equal(parsed.proxyEnabled, true);
  assert.equal(parsed.httpProxy, "http://proxy-a:8080");
  assert.equal(parsed.httpsProxy, "http://proxy-b:8443");
  assert.equal(parsed.noProxy, "<local>,localhost,*.company.internal");
  assert.equal(parsed.autoConfigUrl, "http://wpad.company/proxy.pac");
  assert.equal(parsed.autoDetect, true);
});

test("does not apply ProxyServer while ProxyEnable is disabled", () => {
  const parsed = parseWindowsInternetSettings(`
    ProxyEnable    REG_DWORD    0x0
    ProxyServer    REG_SZ    proxy.company:8080
    AutoDetect    REG_DWORD    0x1
`);
  assert.equal(parsed.proxyEnabled, false);
  assert.equal(parsed.httpProxy, undefined);
  assert.equal(parsed.httpsProxy, undefined);
  assert.equal(parsed.autoDetect, true);
});
