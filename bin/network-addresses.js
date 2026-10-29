"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("os");

const WILDCARD_HOSTNAMES = new Set(["0.0.0.0", "::", "[::]"]);

function isWildcardHostname(hostname) {
  return WILDCARD_HOSTNAMES.has(hostname);
}

// An IPv6 wildcard listens dual-stack (Node's default, and Next passes no
// ipv6Only), so it answers on every IPv4 address too.
function addressFamilies(hostname) {
  return hostname.includes(":") ? ["IPv4", "IPv6"] : ["IPv4"];
}

// Addresses another machine can open when the server binds a wildcard address:
// the wildcard itself routes nowhere, so list this host's interfaces instead.
function getReachableAddresses(hostname, { interfaces = os.networkInterfaces() } = {}) {
  if (!isWildcardHostname(hostname)) return [];
  const addresses = [];
  for (const family of addressFamilies(hostname)) {
    for (const [name, entries] of Object.entries(interfaces)) {
      for (const entry of entries ?? []) {
        // `internal` covers loopback; a scoped IPv6 address (fe80::/10) needs a
        // zone id, so it cannot be pasted into another machine's browser.
        if (entry.family !== family || entry.internal || entry.scopeid) continue;
        addresses.push({ name, address: entry.address });
      }
    }
  }
  return addresses;
}

function formatUrl(address, port) {
  const host = address.includes(":") ? `[${address}]` : address;
  return `http://${host}:${port}`;
}

// The startup block that names each interface and the URL it serves. Empty when
// there is nothing to add: a concrete bind address, port 0 (the OS picks one we
// never learn), or no address of the bound family.
function formatReachableAddresses(hostname, port, options) {
  if (String(port) === "0") return "";
  const addresses = getReachableAddresses(hostname, options);
  if (addresses.length === 0) return "";
  const width = Math.max(...addresses.map(({ name }) => name.length));
  return [
    "Reachable at:",
    ...addresses.map(
      ({ name, address }) => `  ${name.padEnd(width)}  ${formatUrl(address, port)}`,
    ),
  ].join("\n");
}

module.exports = {
  formatReachableAddresses,
  formatUrl,
  getReachableAddresses,
  isWildcardHostname,
};
