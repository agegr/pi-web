#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { updateFromSource } = require("./source-update");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { reloadService } = require("./mac-service");

const [sourceDir, statePath, lockPath] = process.argv.slice(2);
const writeState = (status, error) => fs.writeFileSync(statePath, JSON.stringify({
  status,
  sourceDir,
  updatedAt: new Date().toISOString(),
  ...(error ? { error } : {}),
}));

let ownsLock = false;
try {
  fs.writeFileSync(lockPath, String(process.pid), { flag: "wx", mode: 0o600 });
  ownsLock = true;
  writeState("running");
  updateFromSource(sourceDir);
  writeState("reloading");
  fs.rmSync(lockPath, { force: true });
  ownsLock = false;
  reloadService();
  writeState("succeeded");
} catch (error) {
  if (ownsLock) {
    fs.rmSync(lockPath, { force: true });
    writeState("failed", error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}
