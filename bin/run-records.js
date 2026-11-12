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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tls = require("node:tls");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isIP } = require("node:net");

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
function getOpenUrl(hostname, port, scheme = "http") {
  let host = hostname;
  if (host === "0.0.0.0") host = "127.0.0.1";
  else if (host === "::" || host === "[::]") host = "::1";
  if (host.includes(":") && !host.startsWith("[")) host = `[${host}]`;
  return `${scheme}://${host}:${port}`;
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

// Any HTTP answer counts (a password-protected server answers 401). Only the
// status matters, so the body is dropped: its connection is released now
// instead of being left mid-response when the CLI exits (#1174).
// A launcher-owned HTTPS listener may use a user-supplied certificate absent
// from Node's CA store. Probe only the recorded bind address, pinning the
// public certificate fingerprint BEFORE sending a credential-free request.
// This neither changes system trust nor disables TLS checks for other fetches.
function isHttpsServerAnswering(record) {
  if (!Number.isInteger(record.port) || record.port < 1 || record.port > 65535
    || typeof record.hostname !== "string"
    || !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(record.certFingerprint256 || "")
    || record.url !== getOpenUrl(record.hostname, record.port, "https")) return Promise.resolve(false);
  return new Promise((resolve) => {
    let socket;
    let settled = false;
    const finish = (answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket?.destroy();
      resolve(answer);
    };
    // A wall-clock deadline includes DNS, TLS negotiation and a peer that
    // continuously trickles bytes (an idle socket timeout does not).
    const deadline = setTimeout(() => finish(false), 2_000);
    try {
      const host = new URL(record.url).hostname.replace(/^\[|\]$/g, "");
      socket = tls.connect({ host, port: record.port, servername: isIP(host) ? undefined : host,
        rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] }, () => {
        if (socket.getPeerCertificate().fingerprint256 !== record.certFingerprint256) return finish(false);
        socket.write(`GET / HTTP/1.1\r\nHost: ${new URL(record.url).host}\r\nConnection: close\r\n\r\n`);
      });
      let statusLine = "";
      socket.on("data", (chunk) => {
        statusLine += chunk.toString();
        if (statusLine.includes("\r\n")) finish(/^HTTP\/1\.[01] \d{3} /.test(statusLine));
        else if (statusLine.length > 1024) finish(false);
      });
      socket.on("error", () => finish(false));
      socket.on("close", () => finish(false));
    } catch { finish(false); }
  });
}

async function isServerAnswering(url, fetchImpl = fetch, record) {
  if (record?.scheme === "https") return isHttpsServerAnswering(record);
  let response;
  try {
    response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
  } catch {
    return false;
  }
  await response.body?.cancel().catch(() => {});
  return true;
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
  const answering = await Promise.all(candidates.map((record) => (
    // A dead HTTPS launcher leaves no public listener, but its private Next
    // child must remain visible to status/stop rather than becoming unkillable.
    record.scheme === "https" && record.orphaned
      ? (Number.isInteger(record.backendPort) && record.backendPort > 0 && record.backendPort <= 65535
        ? isAnswering(`http://127.0.0.1:${record.backendPort}/`, undefined) : false)
      : isAnswering(record.url, undefined, record)
  )));
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
  const pid = record.orphaned
    ? `Next.js pid ${record.stopPid} (launcher gone${record.scheme === "https" ? "; HTTPS entry gone, private backend remains" : ""})`
    : `pid ${record.pid}`;
  return `  ${record.url}  ${pid}  v${record.version}  started ${record.startedAt}`;
}

// Writes the record once the server is ready and removes it when the launcher
// exits. A failed write only warns: the server keeps running without a record.
// `dir` may be a function, so a failing home lookup is caught here too.
function createRunRecordTracker({ dir, record, parentProcess = process, warn = console.warn }) {
  let written = false;
  let runDir;
  function remove() {
    if (!runDir) return;
    // Never remove a newer launcher's replacement record with the same pid.
    try {
      const current = JSON.parse(fs.readFileSync(recordPath(runDir, record.pid), "utf8"));
      if (current.instanceId === record.instanceId && current.startedAt === record.startedAt) removeRunRecord(runDir, record.pid);
    } catch { /* Missing record, or cleanup cannot access its directory. */ }
  }
  return {
    remove,
    markReady() {
      if (written) return;
      written = true;
      try {
        runDir = typeof dir === "function" ? dir() : dir;
        writeRunRecord(runDir, record);
      } catch (error) {
        warn(`[pi-web] could not write the run record (pi-web status/stop/open will not see this server): ${error.message}`);
        return;
      }
      parentProcess.once("exit", remove);
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
  isHttpsServerAnswering,
  isServerAnswering,
  listRunRecords,
  readProcessCommand,
  removeRunRecord,
  selectRunRecord,
  writeRunRecord,
};
