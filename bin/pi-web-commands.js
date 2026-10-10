"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawnSync } = require("child_process");
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

function killWindowsProcessTree(pid) {
  const result = spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `taskkill exited ${result.status}`).trim());
}

async function stopServer(record, {
  kill = process.kill,
  killTree = killWindowsProcessTree,
  platform = process.platform,
  isAlive = records.isProcessAlive,
  wait = sleep,
  timeoutMs = STOP_TIMEOUT_MS,
  log = console.log,
  error = console.error,
} = {}) {
  // The launcher, or the Next.js server a killed launcher left serving.
  const pid = record.stopPid ?? record.pid;
  try {
    // The launcher forwards SIGTERM to Next.js and exits after it. Windows has
    // no SIGTERM: process.kill() would end the launcher alone and leave Next.js
    // serving the port, so end the whole process tree there.
    if (platform === "win32") killTree(pid);
    else kill(pid, "SIGTERM");
  } catch (killError) {
    if (killError.code !== "ESRCH") {
      error(`Could not stop pi-web (pid ${pid}): ${killError.message}`);
      return 1;
    }
  }
  for (let waited = 0; isAlive(pid); waited += STOP_POLL_MS) {
    if (waited >= timeoutMs) {
      error(`pi-web on ${record.url} (pid ${pid}) is still running after ${timeoutMs / 1000} s.`);
      return 1;
    }
    await wait(STOP_POLL_MS);
  }
  log(`Stopped pi-web on ${record.url} (pid ${pid}).`);
  return 0;
}

async function runCommand(options, {
  runDir = records.getRunDir(),
  pkgDir = path.join(__dirname, ".."),
  open = openInBrowser,
  isAnswering = records.isServerAnswering,
  isOurs = records.isRecordProcess,
  log = console.log,
  error = console.error,
} = {}) {
  const list = () => records.listRunRecords(runDir, { isAnswering, isOurs });
  switch (options.command) {
    case "version":
      log(getPackageVersion(pkgDir));
      return 0;
    case "status": {
      const running = await list();
      log(running.length === 0
        ? "No pi-web server is running."
        : `Running pi-web servers:\n${running.map(records.formatRunRecord).join("\n")}`);
      return 0;
    }
    case "stop":
    case "open": {
      const selected = records.selectRunRecord(await list(), options.port);
      if (!selected.record) {
        error(selected.error);
        return 1;
      }
      if (options.command === "stop") {
        const code = await stopServer(selected.record, { log, error });
        if (code === 0) records.removeRunRecord(runDir, selected.record.pid);
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
