"use strict";

// Records of running pi-web servers: one <agentDir>/pi-web-run/<launcher pid>.json
// per server, written by the launcher once Next.js is ready and removed when it
// exits. pi-web keeps all its state in pi's agent directory, so this does too.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawnSync } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("os");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fileURLToPath } = require("url");

// pi's getAgentDir(): PI_CODING_AGENT_DIR with `~` expanded, else ~/.pi/agent.
function getAgentDir(env = process.env, home = os.homedir()) {
  const configured = env.PI_CODING_AGENT_DIR;
  if (!configured) return path.join(home, ".pi", "agent");
  if (configured === "~") return home;
  if (configured.startsWith("~/") || configured.startsWith("~\\")) return path.join(home, configured.slice(2));
  if (configured.startsWith("file://")) return fileURLToPath(configured);
  return configured;
}

function getRunDir(env = process.env, home = os.homedir()) {
  return path.join(getAgentDir(env, home), "pi-web-run");
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

// What pid is running now: its command line (Windows: its image name), "" when
// no such process exists, null when there is no way to tell.
function readProcessCommand(pid, { platform = process.platform, run = spawnSync, readFile = fs.readFileSync } = {}) {
  if (platform === "linux") {
    try {
      return readFile(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ").trim();
    } catch (error) {
      return error.code === "ENOENT" ? "" : null;
    }
  }
  const result = platform === "win32"
    ? run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 5_000 })
    : run("ps", ["-ww", "-p", String(pid), "-o", "args="], { encoding: "utf8", timeout: 5_000 });
  if (result.error) return null;
  const output = (result.stdout || "").trim();
  if (platform !== "win32") return output;
  // `"node.exe","1234",...`, or an INFO line when nothing matches.
  const match = /^"([^"]*)","(\d+)"/.exec(output);
  return match && match[2] === String(pid) ? match[1] : "";
}

// Whether pid still is the launcher or the Next.js server of a record. After a
// crash or a reboot the pid may belong to an unrelated process, which stop must
// never signal. Next.js renames its process to "next-server (vX)". Windows only
// gives the image name. When nothing can tell, the URL check alone decides.
function isRecordProcess(pid, role, { platform = process.platform, readCommand = readProcessCommand } = {}) {
  const command = readCommand(pid, { platform });
  if (command === null) return true;
  if (platform === "win32") return /^node/i.test(command);
  return role === "launcher" ? command.includes("pi-web") : command.includes("next");
}

function recordPath(dir, pid) {
  return path.join(dir, `${pid}.json`);
}

function writeRunRecord(dir, record) {
  fs.mkdirSync(dir, { recursive: true });
  const file = recordPath(dir, record.pid);
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function removeRunRecord(dir, pid) {
  fs.rmSync(recordPath(dir, pid), { force: true });
}

// Any HTTP answer counts (a password-protected server answers 401).
async function isServerAnswering(url, fetchImpl = fetch) {
  try {
    await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

function isValidPid(pid) {
  return Number.isSafeInteger(pid) && pid > 0;
}

// Running servers sorted by port, each with `stopPid`: the launcher, or the
// Next.js server when the launcher was killed and left it serving (`orphaned`).
// A record none of whose processes is still ours, or that cannot be read, is
// deleted. One whose process is ours but whose URL does not answer is skipped,
// not deleted.
async function listRunRecords(dir, {
  isAlive = isProcessAlive,
  isOurs = isRecordProcess,
  isAnswering = isServerAnswering,
} = {}) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const candidates = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    let record;
    try {
      record = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      record = null;
    }
    const launcherRuns = record && isValidPid(record.pid) && isAlive(record.pid) && isOurs(record.pid, "launcher");
    const nextRuns = !launcherRuns && record && isValidPid(record.nextPid) && isAlive(record.nextPid) && isOurs(record.nextPid, "next");
    if (launcherRuns || nextRuns) {
      candidates.push({ ...record, stopPid: launcherRuns ? record.pid : record.nextPid, orphaned: !launcherRuns });
    } else {
      fs.rmSync(file, { force: true });
    }
  }
  const answering = await Promise.all(candidates.map((record) => isAnswering(record.url)));
  return candidates.filter((_, index) => answering[index]).sort((a, b) => a.port - b.port);
}

// The --port rule shared by stop and open.
function selectRunRecord(records, port) {
  const matching = port === undefined ? records : records.filter((record) => String(record.port) === String(port));
  if (matching.length === 1) return { record: matching[0] };
  if (matching.length === 0) {
    return { error: port === undefined ? "No pi-web server is running." : `No pi-web server is running on port ${port}.` };
  }
  if (port !== undefined) {
    return { error: `Several pi-web servers are running on port ${port}:\n${matching.map(formatRunRecord).join("\n")}` };
  }
  return {
    error: `Several pi-web servers are running:\n${matching.map(formatRunRecord).join("\n")}\nPass --port <port> to choose one.`,
  };
}

function formatRunRecord(record) {
  const pid = record.orphaned ? `Next.js pid ${record.stopPid} (launcher gone)` : `pid ${record.pid}`;
  return `  ${record.url}  ${pid}  v${record.version}  started ${record.startedAt}`;
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
      parentProcess.once("exit", () => removeRunRecord(runDir, record.pid));
    },
  };
}

module.exports = {
  createRunRecordTracker,
  formatRunRecord,
  getAgentDir,
  getOpenUrl,
  getRunDir,
  isProcessAlive,
  isRecordProcess,
  isServerAnswering,
  listRunRecords,
  readProcessCommand,
  removeRunRecord,
  selectRunRecord,
  writeRunRecord,
};
