#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const pkgDir = __dirname;

// Resolve next CLI
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

const port = process.argv.includes("-p")
  ? process.argv[process.argv.indexOf("-p") + 1]
  : "8090";

const nextDir = path.join(pkgDir, ".next");
if (!fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Run 'npm run build' in the PR repo first.");
  process.exit(1);
}

const child = spawn(process.execPath, [nextBin, "start", "-p", port], {
  cwd: pkgDir,
  stdio: ["inherit", "pipe", "inherit"],
  env: { ...process.env },
});

let browserOpened = false;
const url = `http://localhost:${port}`;

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (!browserOpened && text.includes("Ready")) {
    browserOpened = true;
    const isWindows = process.platform === "win32";
    const openCmd = isWindows ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
    spawn(openCmd, [url], { shell: isWindows, stdio: "ignore", detached: true }).unref();
  }
});

child.on("exit", (code) => process.exit(code ?? 0));
