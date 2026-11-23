// Proof for slice 2 of docs/adr/0008-agent-process-boundary.md: with
// PI_WEB_AGENT_PROCESS=1, a session survives the death of the process that
// started it, and the next process adopts it.
//
//   node e2e/agent-process-flag.mjs
//
// The driver runs two child processes. The first starts a session through
// lib/rpc-manager.ts and then exits hard, the way a crashed or restarted web
// server does. The second starts the same session again and must adopt the host
// the first one left behind, not create a new one.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: false, tsconfigPaths: true });
const { readAgentRecord, sweepStaleAgentRecords } = await jiti.import("../lib/agent-registry.ts");

// The phases run as separate processes, so the driver hands them the scratch
// directory and its state file through the environment.
const workdir = process.env.PI_WEB_AGENT_WORKDIR ?? mkdtempSync(join(tmpdir(), "pi-web-agent-flag-"));
const stateFile = process.env.PI_WEB_AGENT_STATE ?? join(workdir, "state.json");
const sessionId = process.env.PI_WEB_AGENT_SESSION ?? `agent-flag-${Date.now()}`;
const marker = "flag-path-survived";
const flagEnv = {
  ...process.env,
  PI_WEB_AGENT_PROCESS: "1",
  PI_WEB_AGENT_WORKDIR: workdir,
  PI_WEB_AGENT_STATE: stateFile,
  PI_WEB_AGENT_SESSION: sessionId,
};
const phase = process.argv[2];

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (phase === "start") {
  const { startRpcSession } = await jiti.import("../lib/rpc-manager.ts");
  const { session } = await startRpcSession(sessionId, null, workdir);
  const stateBefore = await session.send({ type: "get_state" });
  assert.equal(stateBefore.isBashRunning, false, "a fresh session should be idle");
  // Seed the session file so the second phase has something to open, the way a
  // session that already has history would.
  await session.send({ type: "bash", command: "echo seed" });
  // Deliberately not awaited: the answer belongs to a process that is about to
  // die, exactly like a prompt in flight when the server restarts.
  void session.send({ type: "bash", command: `sleep 12 && echo ${marker}` }).catch(() => {});
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const state = await session.send({ type: "get_state" });
    if (state?.isBashRunning) break;
    await delay(100);
  }
  const record = readAgentRecord(session.sessionId) ?? readAgentRecord(sessionId);
  assert.ok(record, "host did not announce itself");
  emit({ sessionId: session.sessionId, pid: record.pid, sessionFile: session.sessionFile, socketPath: record.socketPath });
  // Crash, do not clean up: the host has to outlive this process.
  process.exit(9);
}

if (phase === "resume") {
  const before = JSON.parse(readFileSync(stateFile, "utf8"));
  const { startRpcSession } = await jiti.import("../lib/rpc-manager.ts");
  const started = Date.now();
  const { session, realSessionId } = await startRpcSession(sessionId, before.sessionFile, workdir);
  const attachMs = Date.now() - started;
  const adopted = readAgentRecord(realSessionId ?? sessionId);
  const runningOnAdopt = session.isRunning();
  let finished = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await session.send({ type: "get_state" });
    if (state && state.isBashRunning === false) {
      finished = true;
      break;
    }
    await delay(500);
  }
  const contents = readFileSync(before.sessionFile, "utf8");
  emit({
    pid: adopted?.pid ?? null,
    expectedPid: before.pid,
    runningOnAdopt,
    finished,
    attachMs,
    statePresent: session.state !== null,
    stateKeys: session.state ? Object.keys(session.state).slice(0, 3) : [],
    sessionFile: before.sessionFile,
    markerFound: contents.includes(marker),
  });
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------
try {
  console.log(`[1/4] start a session with PI_WEB_AGENT_PROCESS=1 and crash the owner`);
  const startOut = (() => {
    // The phase exits 9 on purpose, which execFileSync reports as a failure.
    try {
      return execFileSync(process.execPath, [new URL(import.meta.url).pathname, "start"], {
        env: flagEnv,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      });
    } catch (error) {
      assert.equal(error.status, 9, `the start phase should crash on purpose, got ${error.status}`);
      return String(error.stdout ?? "");
    }
  })();
  const started = JSON.parse(startOut.trim().split("\n").at(-1));
  writeFileSync(stateFile, JSON.stringify(started));
  console.log(`      session ${started.sessionId} host pid=${started.pid}`);
  assert.ok(existsSync(started.sessionFile), "the session file should exist after the first run");
  assert.ok(existsSync(started.socketPath), `the host socket should outlive the owner: ${started.socketPath}`);

  console.log(`[2/4] the owner is gone (exit 9), its host is not`);
  await delay(500);

  console.log(`[3/4] a new server starts the same session`);
  const resumeOut = execFileSync(process.execPath, [new URL(import.meta.url).pathname, "resume"], {
    env: flagEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const resumed = JSON.parse(resumeOut.trim().split("\n").at(-1));
  console.log(`      attached in ${resumed.attachMs}ms, running=${resumed.runningOnAdopt}, snapshot=${resumed.statePresent}`);

  console.log(`[4/4] checking it adopted rather than recreated`);
  assert.equal(resumed.pid, resumed.expectedPid, "a new host process was created instead of adopting the old one");
  assert.equal(resumed.runningOnAdopt, true, "the adopted session should still be running the command");
  assert.equal(resumed.finished, true, "the command never finished");
  assert.equal(resumed.markerFound, true, "the adopted host did not persist the command output");

  console.log("");
  console.log("PASS — a session outlived the process that started it:");
  console.log(`  host pid:   ${resumed.pid} (unchanged across the restart)`);
  console.log(`  attach:     ${resumed.attachMs}ms (a fresh host would need seconds)`);
  console.log(`  persisted:  ${resumed.sessionFile}`);
} finally {
  const record = readAgentRecord(sessionId);
  const pids = [record?.pid].filter((pid) => typeof pid === "number");
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  await delay(500);
  sweepStaleAgentRecords();
  const sessionFile = (() => {
    try {
      return JSON.parse(readFileSync(stateFile, "utf8")).sessionFile;
    } catch {
      return null;
    }
  })();
  if (sessionFile) {
    rmSync(sessionFile, { force: true });
    rmSync(join(sessionFile, ".."), { recursive: true, force: true });
  }
  rmSync(workdir, { recursive: true, force: true });
}
