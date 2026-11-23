/**
 * Where a running agent host announces itself so a restarted web server can
 * find it again. See docs/adr/0008-agent-process-boundary.md.
 *
 * One record per session, plus one Unix socket per session. The record lives
 * with the rest of the agent state; the socket lives in the temp directory so
 * the path stays inside the platform's socket path limit.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { AGENT_HOST_PROTOCOL_VERSION } from "./agent-host-protocol";

export const AGENT_RECORD_VERSION = 1;

export interface AgentRecord {
  version: number;
  protocol: number;
  sessionId: string;
  pid: number;
  socketPath: string;
  sessionFile: string | null;
  cwd: string;
  startedAt: number;
}

export function agentStateDir(): string {
  return join(getAgentDir(), "pi-web", "agents");
}

export function agentSocketDir(): string {
  return join(tmpdir(), "pi-web-agents");
}

export function agentSocketPath(sessionId: string): string {
  return join(agentSocketDir(), `${sessionId}.sock`);
}

function agentRecordPath(sessionId: string): string {
  return join(agentStateDir(), `${sessionId}.json`);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Validate an on-disk record. A file written by another build must not be trusted. */
export function parseAgentRecord(value: unknown): AgentRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const sessionId = nonEmptyString(record.sessionId);
  const socketPath = nonEmptyString(record.socketPath);
  const cwd = nonEmptyString(record.cwd);
  if (!sessionId || !socketPath || !cwd) return null;
  if (typeof record.pid !== "number" || !Number.isInteger(record.pid) || record.pid <= 0) return null;
  return {
    version: typeof record.version === "number" ? record.version : AGENT_RECORD_VERSION,
    protocol: typeof record.protocol === "number" ? record.protocol : 0,
    sessionId,
    pid: record.pid,
    socketPath,
    sessionFile: nonEmptyString(record.sessionFile),
    cwd,
    startedAt: typeof record.startedAt === "number" ? record.startedAt : 0,
  };
}

export function readAgentRecord(sessionId: string): AgentRecord | null {
  try {
    return parseAgentRecord(JSON.parse(readFileSync(agentRecordPath(sessionId), "utf8")));
  } catch {
    return null;
  }
}

export function writeAgentRecord(record: AgentRecord): void {
  mkdirSync(agentStateDir(), { recursive: true });
  writeFileSync(agentRecordPath(record.sessionId), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export function removeAgentRecord(sessionId: string): void {
  rmSync(agentRecordPath(sessionId), { force: true });
}

/** Remove a socket file, ignoring an already-gone one. */
export function removeAgentSocket(socketPath: string): void {
  try {
    unlinkSync(socketPath);
  } catch {
    // Nothing to remove.
  }
}

export function listAgentRecords(): AgentRecord[] {
  let names: string[];
  try {
    names = readdirSync(agentStateDir());
  } catch {
    return [];
  }
  const records: AgentRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const record = readAgentRecord(name.slice(0, -".json".length));
    if (record) records.push(record);
  }
  return records;
}

/** `kill(pid, 0)` — true when the process exists and this user may signal it. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else; for our own
    // agents that cannot happen, and treating it as alive is the safe direction.
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

/**
 * A record whose process is gone, or that speaks a protocol this build does not
 * know, is not adoptable. Pure so it can be tested without spawning anything.
 */
export function isAgentRecordStale(
  record: AgentRecord,
  options: { alive?: (pid: number) => boolean; protocol?: number } = {},
): boolean {
  const alive = options.alive ?? isProcessAlive;
  const protocol = options.protocol ?? AGENT_HOST_PROTOCOL_VERSION;
  if (record.protocol !== protocol) return true;
  return !alive(record.pid);
}

/**
 * Drop every record this build cannot adopt, so a later scan does not keep
 * retrying a dead socket path. Returns the ids that were removed.
 */
export function sweepStaleAgentRecords(): string[] {
  const removed: string[] = [];
  for (const record of listAgentRecords()) {
    if (!isAgentRecordStale(record)) continue;
    removeAgentRecord(record.sessionId);
    removeAgentSocket(record.socketPath);
    removed.push(record.sessionId);
  }
  return removed;
}
