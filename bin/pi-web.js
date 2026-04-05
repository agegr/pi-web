#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");

const pkgDir = path.join(__dirname, "..");
const isWindows = process.platform === "win32";
const nextBin = path.join(pkgDir, "node_modules", ".bin", isWindows ? "next.cmd" : "next");
const nextDir = path.join(pkgDir, ".next");
const port = process.env.PORT || "3030";

if (!fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Please report this issue.");
  process.exit(1);
}

const child = spawn(nextBin, ["start", "-p", port], {
  cwd: pkgDir,
  stdio: "inherit",
  env: { ...process.env },
  shell: isWindows,
});

child.on("exit", (code) => process.exit(code ?? 0));
