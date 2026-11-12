import assert from "node:assert/strict";
import test from "node:test";
import { parseCommandLine, parseLaunchOptions, getHelpText } from "../bin/pi-web-options.js";
import { getOpenUrl } from "../bin/run-records.js";
import { formatReachableAddresses } from "../bin/network-addresses.js";

test("TLS CLI options are paired paths, production launch only, and have no implicit env provisioning", () => {
  const parsed = parseLaunchOptions(["--https-cert", "chain with spaces.pem", "--https-key", "key with spaces.pem"], {});
  assert.equal(parsed.httpsCert, "chain with spaces.pem");
  assert.equal(parsed.httpsKey, "key with spaces.pem");
  for (const args of [["--https-cert", "cert.pem"], ["--https-key", "key.pem"], ["--https-cert", "", "--https-key", "key.pem"], ["--https-cert", "cert.pem", "--https-key", " "]]) {
    assert.throws(() => parseLaunchOptions(args, {}), /supplied together/);
  }
  assert.equal(parseLaunchOptions([], { PI_WEB_HTTPS_CERT: "unused", PI_WEB_HTTPS_KEY: "unused" }).httpsCert, undefined);
  assert.throws(() => parseCommandLine(["status", "--https-key", "key.pem"], {}), /Use --help/);
  assert.match(getHelpText(), /--https-cert/);
  assert.match(getHelpText(), /--https-key/);
});

test("public HTTPS URL/address formatting preserves scheme and wildcard loopback", () => {
  assert.equal(getOpenUrl("0.0.0.0", "8443", "https"), "https://127.0.0.1:8443");
  assert.equal(getOpenUrl("::", "8443", "https"), "https://[::1]:8443");
  assert.equal(getOpenUrl("localhost", "8443"), "http://localhost:8443", "old HTTP default");
  assert.match(formatReachableAddresses("0.0.0.0", "8443", { scheme: "https", interfaces: { eth0: [{ address: "192.0.2.1", family: "IPv4", internal: false }] } }), /https:\/\/192\.0\.2\.1:8443/);
});
