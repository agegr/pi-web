// Proof for docs/adr/0008-agent-process-boundary.md: an agent host outlives the
// client that started its work, and a new client can adopt the running session.
//
//   node e2e/agent-process.mjs
//
// Deliberately not part of `npm run test:e2e`: unlike the browser fixtures it
// creates a real AgentSession, so it uses the configured agent directory.
// It only runs a shell command, never a model call.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: false, tsconfigPaths: true });
const { spawnAgentHost, RemoteAgentSession } = await jiti.import("../lib/agent-remote.ts");
const { agentSocketPath, agentStateDir, readAgentRecord, sweepStaleAgentRecords } = await jiti.import("../lib/agent-registry.ts");

const workdir = mkdtempSync(join(tmpdir(), "pi-web-agent-process-"));
const sessionId = `agent-process-${Date.now()}`;
const socketPath = agentSocketPath(sessionId);
const marker = "host-survived-client-death";
const hostLogPath = join(agentStateDir(), `${sessionId}.log`);

let hostPid = null;
let scratchSessionFile = null;
async function cleanup() {
  const recorded = readAgentRecord(sessionId);
  const pids = [hostPid, recorded?.pid].filter((pid) => typeof pid === "number");
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  await delay(500);
  rmSync(workdir, { recursive: true, force: true });
  // The proof creates a real session; do not leave it in the user's list.
  if (scratchSessionFile) rmSync(scratchSessionFile, { force: true });
  rmSync(hostLogPath, { force: true });
}

try {
  console.log(`[1/6] spawning agent host for ${sessionId}`);
  const started = spawnAgentHost({ sessionId, sessionFile: null, cwd: workdir, socketPath });
  hostPid = started.pid;
  console.log(`      host pid=${started.pid} socket=${started.socketPath} log=${started.logPath}`);

  // Wait for the host to announce itself, then attach as the first client.
  let record = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    record = readAgentRecord(sessionId);
    if (record) break;
    if (!existsSync(started.logPath)) throw new Error("host produced no log");
    await delay(100);
  }
  assert.ok(record, "host never wrote a registry record");

  console.log("[2/6] client A attaches");
  const clientA = await RemoteAgentSession.attach(record, { timeoutMs: 20_000 });
  const eventsA = [];
  clientA.onEvent((event) => eventsA.push(event.type));
  assert.equal(clientA.runningOnAttach, false, "a fresh session should not be running");

  console.log("[3/6] client A starts a 6s shell command");
  const bashPromise = clientA.send({ type: "bash", command: `sleep 6 && echo ${marker}` });
  // Let the command actually start before the client goes away.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await clientA.send({ type: "get_state" });
    if (state && state.isBashRunning) break;
    await delay(100);
  }

  console.log("[4/6] client A dies (this is the web server restarting)");
  clientA.close();
  // The command's answer was addressed to the dead client; nothing may hang on it.
  void bashPromise.catch(() => {});
  await delay(300);
  assert.ok(record.pid === hostPid, "host pid changed");

  console.log("[5/6] client B attaches to the session A left behind");
  const clientB = await RemoteAgentSession.attach(record, { timeoutMs: 10_000 });
  const eventsB = [];
  clientB.onEvent((event) => eventsB.push(event.type));
  assert.equal(clientB.runningOnAttach, true, "the shell command should still be running after the client died");
  assert.equal(clientB.state?.isBashRunning, true, "the snapshot should report the running command");
  assert.equal(clientB.sessionFile, clientA.sessionFile, "both clients should describe the same session file");

  console.log("[6/6] client B waits for the command the dead client started");
  let finished = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const state = await clientB.send({ type: "get_state" });
    if (state && state.isBashRunning === false) {
      finished = true;
      break;
    }
    await delay(500);
  }
  assert.ok(finished, "the shell command never finished");
  assert.ok(eventsB.length > 0, `client B saw no events, only ${JSON.stringify(eventsA)}`);

  const sessionFile = clientB.sessionFile;
  scratchSessionFile = sessionFile;
  assert.ok(sessionFile && existsSync(sessionFile), `session file missing: ${sessionFile}`);
  const contents = readFileSync(sessionFile, "utf8");
  assert.ok(contents.includes(marker), "the surviving host did not persist the command output");

  console.log("");
  console.log("PASS — the host outlived its client and finished the work:");
  console.log(`  client A events: ${eventsA.length} (${[...new Set(eventsA)].slice(0, 4).join(", ")})`);
  console.log(`  client B events: ${eventsB.length} (${[...new Set(eventsB)].slice(0, 4).join(", ")})`);
  console.log(`  persisted:       ${sessionFile}`);
  clientB.close();
} finally {
  sweepStaleAgentRecords();
  await cleanup();
}
