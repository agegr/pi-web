import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "./file-access";
import { getProjectTrustStatus } from "./project-trust";
import { getRpcSession } from "./rpc-manager";
import { getAgentDir, readSessionHeader, resolveSessionPath } from "./session-reader";
import { buildTerminalSpawnConfig } from "./terminal-process";
import { ManagedTerminal, validateDimensions } from "./terminal-session.ts";

export { MAX_INPUT_BYTES } from "./terminal-session.ts";
export type { TerminalDescriptor, TerminalEvent } from "./terminal-session.ts";

import type { TerminalDescriptor } from "./terminal-session.ts";

const MAX_TERMINALS = 8;

declare global {
  var __piTerminals: Map<string, ManagedTerminal> | undefined;
  var __piTerminalBySession: Map<string, string> | undefined;
  var __piTerminalStartLocks: Map<string, Promise<TerminalDescriptor>> | undefined;
  var __piTerminalCanceledStarts: Set<string> | undefined;
  var __piTerminalCleanupInstalled: boolean | undefined;
}

function terminalRegistry(): Map<string, ManagedTerminal> {
  if (!globalThis.__piTerminals) globalThis.__piTerminals = new Map();
  if (!globalThis.__piTerminalBySession) globalThis.__piTerminalBySession = new Map();
  if (!globalThis.__piTerminalStartLocks) globalThis.__piTerminalStartLocks = new Map();
  if (!globalThis.__piTerminalCanceledStarts) globalThis.__piTerminalCanceledStarts = new Set();
  if (!globalThis.__piTerminalCleanupInstalled) {
    globalThis.__piTerminalCleanupInstalled = true;
    const cleanup = () => {
      for (const terminal of globalThis.__piTerminals?.values() ?? []) terminal.close();
    };
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piTerminals;
}

/**
 * node-pty is a native optional dependency: it needs a toolchain on platforms
 * without a prebuild. Loading it lazily keeps a failed install confined to the
 * terminal feature instead of breaking every route that imports this module —
 * session deletion among them.
 */
async function loadPtySpawn(): Promise<typeof import("node-pty").spawn> {
  try {
    return (await import("node-pty")).spawn;
  } catch {
    throw new Error("Interactive terminals need the optional node-pty package, which is not installed");
  }
}

async function resolveTerminalCwd(sessionId: string): Promise<string> {
  const live = getRpcSession(sessionId);
  let cwd = live?.isAlive() ? live.cwd : "";
  if (!cwd) {
    const sessionPath = await resolveSessionPath(sessionId);
    if (!sessionPath) throw new Error("Session not found");
    const header = readSessionHeader(sessionPath);
    if (!header || header.id !== sessionId || !header.cwd) throw new Error("Session has no working directory");
    cwd = header.cwd;
  }

  const canonicalCwd = realpathSync(cwd);
  if (!statSync(canonicalCwd).isDirectory()) throw new Error("Session working directory is unavailable");
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(canonicalCwd, allowedRoots)) throw new Error("Session working directory is not allowed");
  if (!getProjectTrustStatus(canonicalCwd, getAgentDir()).trusted) {
    throw new Error("Trust this project before opening a terminal");
  }
  return canonicalCwd;
}

export async function createTerminal(
  sessionId: string,
  columns = 80,
  rows = 24,
): Promise<TerminalDescriptor> {
  validateDimensions(columns, rows);
  const registry = terminalRegistry();
  const existingId = globalThis.__piTerminalBySession?.get(sessionId);
  const existing = existingId ? registry.get(existingId) : undefined;
  if (existing?.isAlive()) return existing.descriptor;

  const pending = globalThis.__piTerminalStartLocks?.get(sessionId);
  if (pending) return pending;
  if (registry.size + (globalThis.__piTerminalStartLocks?.size ?? 0) >= MAX_TERMINALS) {
    throw new Error(`At most ${MAX_TERMINALS} terminals may be open`);
  }

  const start = (async () => {
    const spawn = await loadPtySpawn();
    const cwd = await resolveTerminalCwd(sessionId);
    if (globalThis.__piTerminalCanceledStarts?.has(sessionId)) {
      throw new Error("Terminal creation was cancelled");
    }
    const terminalId = randomUUID();
    const config = buildTerminalSpawnConfig(cwd, columns, rows);
    const pty = spawn(config.file, config.args, config.options);
    const descriptor = { terminalId, sessionId, cwd, columns, rows };
    const terminal = new ManagedTerminal(pty, descriptor, () => {
      if (registry.get(terminalId) === terminal) registry.delete(terminalId);
      if (globalThis.__piTerminalBySession?.get(sessionId) === terminalId) {
        globalThis.__piTerminalBySession.delete(sessionId);
      }
    });
    registry.set(terminalId, terminal);
    globalThis.__piTerminalBySession?.set(sessionId, terminalId);
    return descriptor;
  })();
  globalThis.__piTerminalStartLocks?.set(sessionId, start);
  try {
    return await start;
  } finally {
    if (globalThis.__piTerminalStartLocks?.get(sessionId) === start) {
      globalThis.__piTerminalStartLocks.delete(sessionId);
      globalThis.__piTerminalCanceledStarts?.delete(sessionId);
    }
  }
}

export function getTerminal(sessionId: string, terminalId: string): ManagedTerminal | undefined {
  const terminal = terminalRegistry().get(terminalId);
  return terminal?.descriptor.sessionId === sessionId ? terminal : undefined;
}

export function closeTerminal(sessionId: string, terminalId: string): boolean {
  const terminal = getTerminal(sessionId, terminalId);
  if (!terminal) return false;
  terminal.close();
  return true;
}

export function closeTerminalsForSession(sessionId: string): void {
  if (globalThis.__piTerminalStartLocks?.has(sessionId)) {
    globalThis.__piTerminalCanceledStarts?.add(sessionId);
  }
  const terminalId = globalThis.__piTerminalBySession?.get(sessionId);
  if (terminalId) closeTerminal(sessionId, terminalId);
}
