#!/usr/bin/env node
"use strict";

// Thin launcher around `next start`. We invoke the JS entry directly via
// `node` rather than going through the `.cmd` shim to avoid DEP0190 and
// path-with-spaces issues on Windows.
//
// All flag handling (port, hostname, browser-open) lives in
// bin/pi-web-options.js. The operator passes `-H <address>`. If the
// launcher is bound to `0.0.0.0` (all interfaces), we still need a single
// address to advertise in the QR code — the Tailscale IP of this machine,
// or the loopback as a last resort.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getUnsupportedNodeVersionMessage, isNodeVersionSupported } = require("./node-version");

if (!isNodeVersionSupported(process.versions.node)) {
  console.error(getUnsupportedNodeVersionMessage(process.versions.node));
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn, execFileSync } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { writeFileSync } = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseLaunchOptions } = require("./pi-web-options");

const pkgDir = path.join(__dirname, "..");
const { port, hostname, openBrowser } = parseLaunchOptions();

// Read the HTTPS URL `tailscale serve` is publishing, when configured. We
// prefer this over the bare Tailscale IPv4 address because only HTTPS
// counts as a secure context for the browser — and a secure context is
// the prerequisite for installing this app as a real PWA in standalone
// mode (no browser UI). Returns `null` when `tailscale serve` is not
// installed, not configured, or status output is unparseable.
function resolveTailscaleHttpsUrl() {
  try {
    const out = execFileSync("tailscale", ["serve", "status"], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Capture protocol + hostname + optional port; drop the trailing slash
    // tailscale prints. Matches look like:
    //   "https://duoji.taildee88d.ts.net/"      -> "https://duoji.taildee88d.ts.net"
    //   "https://duoji.taildee88d.ts.net:8443/" -> "https://duoji.taildee88d.ts.net:8443"
    const match = out.match(/(https:\/\/[^\s]+?ts\.net(?::\d+)?)\/?/);
    return match ? match[1] : null;
  } catch {
    /* `tailscale serve` not installed / not configured / failed — fall through */
    return null;
  }
}

// Pick the address to advertise in the QR code. If the operator bound to
// 0.0.0.0 (all interfaces), we look up the Tailscale HTTPS URL first
// (preferred — gives the phone a secure context so PWA install works in
// standalone mode), then fall back to the bare Tailscale IPv4, then to
// 127.0.0.1 (the modal will show a warning if we end up here).
function resolveQrHost(boundHost) {
  if (boundHost && boundHost !== "0.0.0.0") return boundHost;

  const tsHttps = resolveTailscaleHttpsUrl();
  if (tsHttps) return tsHttps;

  try {
    const out = execFileSync("tailscale", ["ip", "-4"], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out && /\d+\.\d+\.\d+\.\d+/.test(out)) return out.split("\n")[0].trim();
  } catch {
    /* tailscale not installed or not running — fall through */
  }
  return "127.0.0.1";
}

const qrHost = resolveQrHost(hostname);

// `PI_WEB_HOSTNAME` is consumed by `lib/request-security.ts` via
// `hostnameFromAuthority`, which rejects anything containing '/' (it
// expects an `authority` form, not a full URL). When `qrHost` is a full
// HTTPS URL we hand the security check the bare hostname — that matches
// what the Host header carries on the wire (`duoji.taildee88d.ts.net`,
// no protocol, no port). The full URL still flows into `.pi-web-hostname`
// so the QR route can emit a working HTTPS pair URL.
let envHostname = qrHost;
try {
  envHostname = new URL(qrHost).hostname;
} catch {
  /* qrHost is already a bare host or IP — leave it untouched */
}

// The QR-encoding route reads this file because Next.js route workers don't
// always inherit the parent environment. We write the addressable hostname
// (not the bind address) so the QR works whether the server is bound to
// 0.0.0.0 or to a specific IP.
try {
  writeFileSync(path.join(pkgDir, ".pi-web-hostname"), qrHost + "\n", {
    encoding: "utf8",
    mode: 0o644,
  });
} catch (error) {
  console.warn(`Could not write runtime hostname file: ${error.message}`);
}

const nextArgs = ["start", pkgDir, "-p", port, "-H", hostname];

const child = spawn(process.execPath, [require.resolve("next/dist/bin/next", { paths: [pkgDir] }), ...nextArgs], {
  stdio: ["inherit", "pipe", "inherit"],
  env: { ...process.env, PI_WEB_HOSTNAME: envHostname },
});

let browserOpened = false;
const url = `http://${hostname}:${port}`;

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (openBrowser && !browserOpened && text.includes("Ready")) {
    browserOpened = true;
    openBrowserWindow(url);
  }
});

child.on("exit", (code) => process.exit(code ?? 0));

function openBrowserWindow(target) {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";
  let opener;
  if (isWindows) {
    opener = spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", "", target], {
      stdio: "ignore",
      detached: true,
    });
  } else if (isMac) {
    opener = spawn("open", [target], { stdio: "ignore", detached: true });
  } else {
    opener = spawn("xdg-open", [target], { stdio: "ignore", detached: true });
  }
  opener.on("error", () => { /* ignore — user can open manually */ });
  opener.unref();
}