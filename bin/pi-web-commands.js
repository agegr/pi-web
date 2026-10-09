"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { openInBrowser } = require("./browser-opener");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runUpdate } = require("./pi-web-update");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const records = require("./run-records");

const STOP_TIMEOUT_MS = 10_000;
const STOP_POLL_MS = 200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getPackageVersion(pkgDir = path.join(__dirname, "..")) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(pkgDir, "package.json")).version;
}

async function stopServer(record, {
  kill = process.kill,
  isAlive = records.isProcessAlive,
  wait = sleep,
  timeoutMs = STOP_TIMEOUT_MS,
  log = console.log,
  error = console.error,
} = {}) {
  try {
    // The launcher forwards SIGTERM to Next.js and exits after it. On Windows
    // process.kill() terminates the launcher outright instead; acceptable.
    kill(record.pid, "SIGTERM");
  } catch (killError) {
    if (killError.code !== "ESRCH") {
      error(`Could not stop pi-web (pid ${record.pid}): ${killError.message}`);
      return 1;
    }
  }
  for (let waited = 0; isAlive(record.pid); waited += STOP_POLL_MS) {
    if (waited >= timeoutMs) {
      error(`pi-web on ${record.url} (pid ${record.pid}) is still running after ${timeoutMs / 1000} s.`);
      return 1;
    }
    await wait(STOP_POLL_MS);
  }
  log(`Stopped pi-web on ${record.url} (pid ${record.pid}).`);
  return 0;
}

async function runCommand(options, {
  runDir = records.getRunDir(),
  pkgDir = path.join(__dirname, ".."),
  open = openInBrowser,
  log = console.log,
  error = console.error,
} = {}) {
  const list = () => records.listRunRecords(runDir);
  switch (options.command) {
    case "version":
      log(getPackageVersion(pkgDir));
      return 0;
    case "status": {
      const running = list();
      log(running.length === 0
        ? "No pi-web server is running."
        : `Running pi-web servers:\n${running.map(records.formatRunRecord).join("\n")}`);
      return 0;
    }
    case "stop":
    case "open": {
      const selected = records.selectRunRecord(list(), options.port);
      if (!selected.record) {
        error(selected.error);
        return 1;
      }
      if (options.command === "stop") {
        const code = await stopServer(selected.record, { log, error });
        if (code === 0) records.removeRunRecord(runDir, selected.record.port, selected.record.pid);
        return code;
      }
      log(`Opening ${selected.record.url}`);
      open(selected.record.url);
      return 0;
    }
    case "update":
      return runUpdate({
        check: options.check,
        currentVersion: getPackageVersion(pkgDir),
        pkgDir,
        listRecords: list,
        formatRecord: records.formatRunRecord,
        log,
        error,
      });
    default:
      error(`Unknown command: ${options.command}`);
      return 1;
  }
}

module.exports = { getPackageVersion, runCommand, stopServer };
