#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const pkgDir = path.join(__dirname, "..");
const nextBin = path.join(pkgDir, "node_modules", ".bin", "next");
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
});

child.on("exit", (code) => process.exit(code ?? 0));
