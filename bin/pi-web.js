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

// Pick the address to advertise in the QR code. If the operator bound to
// 0.0.0.0 (all interfaces), we look up the Tailscale IP of this machine so
// the phone can dial it. If `tailscale` isn't installed or the lookup
// fails, we fall back to 127.0.0.1 (the modal will show a warning).
function resolveQrHost(boundHost) {
  if (boundHost && boundHost !== "0.0.0.0") return boundHost;
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
  env: { ...process.env, PI_WEB_HOSTNAME: qrHost },
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