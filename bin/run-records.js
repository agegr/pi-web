"use strict";

// Records of running pi-web servers: one ~/.pi-web/run/<port>.json per server,
// written by the launcher once Next.js is ready and removed when it exits.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("os");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");

function getRunDir(home = os.homedir()) {
  return path.join(home, ".pi-web", "run");
}

// The address a browser on this machine can open: wildcard binds become
// loopback, and IPv6 literals get brackets.
function getOpenUrl(hostname, port) {
  let host = hostname;
  if (host === "0.0.0.0") host = "127.0.0.1";
  else if (host === "::" || host === "[::]") host = "::1";
  if (host.includes(":") && !host.startsWith("[")) host = `[${host}]`;
  return `http://${host}:${port}`;
}

function isProcessAlive(pid, kill = process.kill) {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error.code === "EPERM";
  }
}

function recordPath(dir, port) {
  return path.join(dir, `${port}.json`);
}

function writeRunRecord(dir, record) {
  fs.mkdirSync(dir, { recursive: true });
  const file = recordPath(dir, record.port);
  const temp = `${file}.${record.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function removeRunRecord(dir, port, pid) {
  const file = recordPath(dir, port);
  try {
    if (JSON.parse(fs.readFileSync(file, "utf8")).pid === pid) fs.rmSync(file, { force: true });
  } catch {
    // Already gone or unreadable: nothing of ours to remove.
  }
}

// Live records sorted by port; records of dead or unreadable launchers are deleted.
function listRunRecords(dir, isAlive = isProcessAlive) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const records = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    let record;
    try {
      record = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      record = null;
    }
    if (record && Number.isSafeInteger(record.pid) && record.pid > 0 && isAlive(record.pid)) {
      records.push(record);
    } else {
      fs.rmSync(file, { force: true });
    }
  }
  return records.sort((a, b) => a.port - b.port);
}

// The --port rule shared by stop and open.
function selectRunRecord(records, port) {
  if (port !== undefined) {
    const match = records.find((record) => String(record.port) === String(port));
    return match ? { record: match } : { error: `No pi-web server is running on port ${port}.` };
  }
  if (records.length === 0) return { error: "No pi-web server is running." };
  if (records.length === 1) return { record: records[0] };
  return {
    error: `Several pi-web servers are running:\n${records.map(formatRunRecord).join("\n")}\nPass --port <port> to choose one.`,
  };
}

function formatRunRecord(record) {
  return `  ${record.url}  pid ${record.pid}  v${record.version}  started ${record.startedAt}`;
}

// Writes the record once the server is ready and removes it when the launcher
// exits. A failed write only warns: the server keeps running without a record.
// `dir` may be a function, so a failing home lookup is caught here too.
function createRunRecordTracker({ dir, record, parentProcess = process, warn = console.warn }) {
  let written = false;
  return {
    markReady() {
      if (written) return;
      written = true;
      let runDir;
      try {
        runDir = typeof dir === "function" ? dir() : dir;
        writeRunRecord(runDir, record);
      } catch (error) {
        warn(`[pi-web] could not write the run record (pi-web status/stop/open will not see this server): ${error.message}`);
        return;
      }
      parentProcess.once("exit", () => removeRunRecord(runDir, record.port, record.pid));
    },
  };
}

module.exports = {
  createRunRecordTracker,
  formatRunRecord,
  getOpenUrl,
  getRunDir,
  isProcessAlive,
  listRunRecords,
  removeRunRecord,
  selectRunRecord,
  writeRunRecord,
};
