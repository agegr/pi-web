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
const { parseLaunchOptions } = require("./pi-web-options");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveAndPersist } = require("./host-info");

const pkgDir = path.join(__dirname, "..");
const { port, hostname, openBrowser } = parseLaunchOptions();

// Single source of truth for QR URL + PI_WEB_HOSTNAME — also used by
// scripts/with-clean-home.js so `npm run dev` / `npm run dev:lan` pick
// up the same tailscale-serve detection as `npm start`.
const { qrHost, envHostname, source } = resolveAndPersist({ pkgDir, boundHost: hostname });
if (source === "tailscale-serve") {
  console.log(`Tailscale HTTPS ready: ${qrHost}`);
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