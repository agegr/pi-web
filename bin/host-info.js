#!/usr/bin/env node
"use strict";

// Shared hostname / URL resolution for all pi-web startup paths.
//
// Every entry point (`bin/pi-web.js`, `scripts/with-clean-home.js`, and any
// future wrapper) needs the same three pieces of information before it
// spawns the real Next.js server:
//
//   1. The address the *phone* should dial — may be a bare host/IP
//      (`100.75.255.47`, `127.0.0.1`) or a full URL when `tailscale serve`
//      is configured (`https://duoji.taildee88d.ts.net`). Written to
//      `.pi-web-hostname` so the pair-info / pair-tokens routes can emit
//      a working QR/pair URL — including the secure-context HTTPS URL
//      that lets Chrome install the PWA in standalone mode.
//
//   2. The bare hostname to advertise as `PI_WEB_HOSTNAME`. We can't put
//      a full URL in that env var because `lib/request-security.ts`'s
//      `hostnameFromAuthority` rejects anything containing `/`.
//
//   3. A status line telling the operator which path was taken, so
//      failures are debuggable from the launch output.
//
// Resolution order (first non-empty wins):
//   - bound host (operator passed `-H <host>` that isn't `0.0.0.0`)
//   - `tailscale serve status` HTTPS URL (preferred — gives the phone a
//     secure context)
//   - `tailscale ip -4` bare address
//   - `127.0.0.1` (loopback — modal will warn)
//
// All three callers (`bin/pi-web.js`, `scripts/with-clean-home.js`,
// and any future scripts) MUST go through `resolveAndPersist()` so the
// `.pi-web-hostname` file stays consistent regardless of which path the
// operator used to start the server.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execFileSync } = require("node:child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { writeFileSync } = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { networkInterfaces } = require("node:os");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { join } = require("node:path");

function resolveTailscaleHttpsUrl() {
  try {
    const out = execFileSync("tailscale", ["serve", "status"], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Capture protocol + hostname + optional port; drop trailing slash.
    //   "https://duoji.taildee88d.ts.net/"      -> "https://duoji.taildee88d.ts.net"
    //   "https://duoji.taildee88d.ts.net:8443/" -> "https://duoji.taildee88d.ts.net:8443"
    const match = out.match(/(https:\/\/[^\s]+?ts\.net(?::\d+)?)\/?/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function resolveTailscaleIpv4() {
  try {
    const out = execFileSync("tailscale", ["ip", "-4"], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out && /\d+\.\d+\.\d+\.\d+/.test(out)) {
      return out.split("\n")[0].trim();
    }
  } catch {
    /* tailscale not installed or not running */
  }
  return null;
}

// Adapter-name patterns that almost always correspond to virtual or
// non-routable interfaces. Anything matching is skipped so the LAN
// detector picks the host's *real* network adapter.
const VIRTUAL_INTERFACE_PATTERN = /vethernet|hyper-v|vmware|virtualbox|docker|br-|veth|wsl|hambridge|tailscale|loopback|bluetooth|isatap|tunneling|teredo|6to4|webfilter|npcap|winpcap|npf/i;

function isRoutableLanAddress(name, address) {
  if (VIRTUAL_INTERFACE_PATTERN.test(name)) return false;
  if (address.internal) return false;
  if (address.family !== "IPv4") return false;
  if (address.address.startsWith("169.254.")) return false; // link-local
  if (address.address.startsWith("127.")) return false;       // loopback
  if (address.address.startsWith("0.0.0.0")) return false;
  return true;
}

// Prefer the most-likely physical adapter. Common home/office ranges:
//   192.168.0.0/16   -> score 0 (most common consumer router range)
//   10.0.0.0/8       -> score 1 (common corporate / larger networks)
//   172.16-31.0.0/12 -> score 2 (less common; some Docker bridges live
//                       here too, but we already filter those by name)
//   anything else    -> score 3 (least preferred)
function lanScore(address) {
  if (/^192\.168\./.test(address)) return 0;
  if (/^10\./.test(address)) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  return 3;
}

function resolveLanIpv4() {
  const interfaces = networkInterfaces();
  const candidates = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (!isRoutableLanAddress(name, addr)) continue;
      candidates.push({ name, address: addr.address });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => lanScore(a.address) - lanScore(b.address));
  return candidates[0].address;
}

function resolveAddress(boundHost) {
  if (boundHost && boundHost !== "0.0.0.0") {
    return { value: boundHost, source: "bound" };
  }

  const tsHttps = resolveTailscaleHttpsUrl();
  if (tsHttps) {
    return { value: tsHttps, source: "tailscale-serve" };
  }

  const tsIp = resolveTailscaleIpv4();
  if (tsIp) {
    return { value: tsIp, source: "tailscale-ip" };
  }

  const lanIp = resolveLanIpv4();
  if (lanIp) {
    return { value: lanIp, source: "lan" };
  }

  return { value: "127.0.0.1", source: "loopback" };
}

/**
 * Strip protocol/port from a value, returning just the bare hostname.
 * Pass-through when the value is already a bare host or IP literal.
 */
function deriveEnvHostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

/**
 * Resolve the addressable URL/host and persist it to `.pi-web-hostname`.
 * Returns the bare hostname for use as `PI_WEB_HOSTNAME`.
 *
 * @param {{ pkgDir: string, boundHost?: string }} options
 * @returns {{ qrHost: string, envHostname: string, source: string }}
 */
function resolveAndPersist(options) {
  const { pkgDir, boundHost } = options;
  const { value: qrHost, source } = resolveAddress(boundHost);
  const envHostname = deriveEnvHostname(qrHost);

  // The QR route (and any operator who reads the file directly) wants the
  // full URL when serve is configured, the bare host otherwise.
  try {
    writeFileSync(join(pkgDir, ".pi-web-hostname"), qrHost + "\n", {
      encoding: "utf8",
      mode: 0o644,
    });
  } catch (error) {
    console.warn(`Could not write runtime hostname file: ${error.message}`);
  }

  return { qrHost, envHostname, source };
}

module.exports = {
  resolveTailscaleHttpsUrl,
  resolveTailscaleIpv4,
  resolveLanIpv4,
  resolveAddress,
  deriveEnvHostname,
  resolveAndPersist,
};