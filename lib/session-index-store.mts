import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type {
  IndexedSessionMetadata,
  SessionFileFingerprint,
  SessionIndexEntry,
} from "./session-index-core.mts";

const SESSION_INDEX_SCHEMA_VERSION = 1;
export const SESSION_INDEX_MAX_ENTRIES = 50_000;
export const SESSION_INDEX_MAX_BYTES = 32 * 1024 * 1024;

interface PersistedSessionIndex {
  schemaVersion: number;
  projectionVersion: string;
  complete: true;
  writtenAt: string;
  payloadSha256: string;
  entries: Array<[string, SessionIndexEntry]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validFingerprint(value: unknown): value is SessionFileFingerprint {
  return isRecord(value)
    && ["size", "mtimeNs", "ctimeNs", "dev", "ino"].every(
      (field) => typeof value[field] === "string",
    );
}

function validMetadata(value: unknown): value is IndexedSessionMetadata {
  if (!isRecord(value)) return false;
  return typeof value.path === "string"
    && typeof value.id === "string"
    && typeof value.cwd === "string"
    && (value.name === undefined || typeof value.name === "string")
    && typeof value.created === "string"
    && typeof value.modified === "string"
    && typeof value.messageCount === "number"
    && Number.isSafeInteger(value.messageCount)
    && value.messageCount >= 0
    && typeof value.firstMessage === "string"
    && (value.parentSessionPath === undefined || typeof value.parentSessionPath === "string")
    && (value.subagent === undefined || (isRecord(value.subagent)
      && typeof value.subagent.parentSessionId === "string"
      && typeof value.subagent.profile === "string"
      && typeof value.subagent.description === "string"
      && ["completed", "failed", "aborted", "interrupted"].includes(value.subagent.status as string)));
}

function validEntry(value: unknown): value is SessionIndexEntry {
  return isRecord(value)
    && validFingerprint(value.fingerprint)
    && (value.metadata === null || validMetadata(value.metadata));
}

function payloadJson(entries: Array<[string, SessionIndexEntry]>): string {
  return JSON.stringify(entries);
}

function payloadDigest(payload: string): string {
  return createHash("sha256").update(payload).digest("base64url");
}

function isPrivateMode(mode: number): boolean {
  return process.platform === "win32" || (mode & 0o077) === 0;
}

export function loadSessionIndex(
  filePath: string,
  projectionVersion: string,
): Map<string, SessionIndexEntry> | null {
  try {
    const fileStat = lstatSync(filePath);
    if (!fileStat.isFile() || fileStat.size > SESSION_INDEX_MAX_BYTES || !isPrivateMode(fileStat.mode)) {
      return null;
    }
    const raw = readFileSync(filePath, "utf8");
    if (Buffer.byteLength(raw) > SESSION_INDEX_MAX_BYTES) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)
      || parsed.schemaVersion !== SESSION_INDEX_SCHEMA_VERSION
      || parsed.projectionVersion !== projectionVersion
      || parsed.complete !== true
      || typeof parsed.payloadSha256 !== "string"
      || !Array.isArray(parsed.entries)
      || parsed.entries.length > SESSION_INDEX_MAX_ENTRIES) {
      return null;
    }

    const entries: Array<[string, SessionIndexEntry]> = [];
    for (const item of parsed.entries) {
      if (!Array.isArray(item)
        || item.length !== 2
        || typeof item[0] !== "string"
        || !validEntry(item[1])) return null;
      entries.push([item[0], item[1]]);
    }
    if (payloadDigest(payloadJson(entries)) !== parsed.payloadSha256) return null;
    return new Map(entries);
  } catch {
    return null;
  }
}

export function persistSessionIndex(
  filePath: string,
  projectionVersion: string,
  sourceEntries: ReadonlyMap<string, SessionIndexEntry>,
): void {
  if (sourceEntries.size > SESSION_INDEX_MAX_ENTRIES) {
    throw new Error(`Session index exceeds ${SESSION_INDEX_MAX_ENTRIES} entries`);
  }
  const entries = [...sourceEntries.entries()];
  const payload = payloadJson(entries);
  const envelope: PersistedSessionIndex = {
    schemaVersion: SESSION_INDEX_SCHEMA_VERSION,
    projectionVersion,
    complete: true,
    writtenAt: new Date().toISOString(),
    payloadSha256: payloadDigest(payload),
    entries,
  };
  const serialized = `${JSON.stringify(envelope)}\n`;
  if (Buffer.byteLength(serialized) > SESSION_INDEX_MAX_BYTES) {
    throw new Error(`Session index exceeds ${SESSION_INDEX_MAX_BYTES} bytes`);
  }

  const directory = dirname(filePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(directory, 0o700);
  const temporaryPath = join(directory, `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporaryPath, filePath);
    if (process.platform !== "win32") chmodSync(filePath, 0o600);
    try {
      const directoryDescriptor = openSync(directory, "r");
      try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
    } catch {
      // Some platforms do not permit fsync on a directory.
    }
  } catch (error) {
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch { /* ignore */ }
    }
    try { unlinkSync(temporaryPath); } catch { /* ignore */ }
    throw error;
  }
}

export function defaultSessionIndexPath(agentDir: string): string {
  return join(agentDir, "cache", "pi-web", `session-index-v${SESSION_INDEX_SCHEMA_VERSION}.json`);
}

export function sessionIndexFileMode(filePath: string): number | null {
  try {
    return statSync(filePath).mode & 0o777;
  } catch {
    return null;
  }
}
