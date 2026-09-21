#!/usr/bin/env node
"use strict";

// Global `pi-web-deploy` entry: runs deploy-piweb.sh from the installed
// package directory, passing through arguments and the calling environment.
// The script itself requires bash, so this shim exists to give Windows
// installs a Node-based bin target; in the Linux container scenario the
// script executes unchanged either way.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");

const scriptPath = path.join(__dirname, "..", "deploy-piweb.sh");
const child = spawn("bash", [scriptPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

function fail(message) {
  console.error(`[pi-web-deploy] ${message}`);
  process.exit(1);
}

child.on("error", (error) => {
  fail(`could not run deploy-piweb.sh: ${error.message}`);
});

for (const forwardableSignal of ["SIGINT", "SIGTERM"]) {
  process.on(forwardableSignal, () => {
    child.kill(forwardableSignal);
  });
}

child.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
