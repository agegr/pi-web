import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  formatReachableAddresses,
  formatUrl,
  getReachableAddresses,
  isWildcardHostname,
} = require("../bin/network-addresses.js");

const interfaces = {
  lo: [
    { address: "127.0.0.1", family: "IPv4", internal: true, scopeid: 0 },
    { address: "::1", family: "IPv6", internal: true, scopeid: 0 },
  ],
  eth0: [
    { address: "192.168.1.20", family: "IPv4", internal: false, scopeid: 0 },
    { address: "fe80::1c2b:3aff:fe4d:5e6f", family: "IPv6", internal: false, scopeid: 2 },
    { address: "2001:db8::20", family: "IPv6", internal: false, scopeid: 0 },
  ],
  wlan0: [
    { address: "10.0.0.7", family: "IPv4", internal: false, scopeid: 0 },
  ],
};

test("a concrete bind address needs no extra lines", () => {
  assert.equal(isWildcardHostname("192.168.1.20"), false);
  assert.deepEqual(getReachableAddresses("192.168.1.20", { interfaces }), []);
  assert.equal(formatReachableAddresses("192.168.1.20", "30141", { interfaces }), "");
});

test("IPv4 wildcard lists each non-internal interface name and address", () => {
  assert.equal(isWildcardHostname("0.0.0.0"), true);
  assert.deepEqual(getReachableAddresses("0.0.0.0", { interfaces }), [
    { name: "eth0", address: "192.168.1.20" },
    { name: "wlan0", address: "10.0.0.7" },
  ]);
});

test("IPv6 wildcard also lists IPv4, and skips loopback and scoped link-local addresses", () => {
  assert.equal(isWildcardHostname("::"), true);
  const expected = [
    { name: "eth0", address: "192.168.1.20" },
    { name: "wlan0", address: "10.0.0.7" },
    { name: "eth0", address: "2001:db8::20" },
  ];
  assert.deepEqual(getReachableAddresses("::", { interfaces }), expected);
  assert.deepEqual(getReachableAddresses("[::]", { interfaces }), expected);
  assert.equal(formatUrl("2001:db8::20", "30141"), "http://[2001:db8::20]:30141");
});

test("formats one aligned line per interface", () => {
  assert.equal(
    formatReachableAddresses("0.0.0.0", "30141", { interfaces }),
    [
      "Reachable at:",
      "  eth0   http://192.168.1.20:30141",
      "  wlan0  http://10.0.0.7:30141",
    ].join("\n"),
  );
});

test("prints nothing for port 0 or when no interface qualifies", () => {
  assert.equal(formatReachableAddresses("0.0.0.0", "0", { interfaces }), "");
  assert.equal(formatReachableAddresses("0.0.0.0", "30141", { interfaces: { lo: interfaces.lo } }), "");
});
