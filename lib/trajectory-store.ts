// Append-only JSONL sidecar storage for trajectory records.
// The original Pi session JSONL is never written by this module.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  TrajectoryHeader,
  TrajectoryReadResult,
  TrajectoryRecord,
} from "./trajectory-types";

const SCHEMA_VERSION = 1;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function trajectoryPath(agentDir: string, sessionId: string): string {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new TypeError(`Invalid session id: ${sessionId}`);
  }
  return join(agentDir, "trajectories", `${sessionId}.jsonl`);
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parse sidecar text. A malformed complete line becomes a warning; the final
 * line is treated as an incomplete tail only when the file has no trailing
 * newline and the line fails to parse (an in-progress append).
 */
export function readTrajectoryText(text: string): TrajectoryReadResult {
  let header: TrajectoryHeader | null = null;
  const records: TrajectoryRecord[] = [];
  const warnings: string[] = [];
  let incompleteTail = false;

  if (text.length === 0) return { header, records, warnings, incompleteTail };

  const hasTrailingNewline = text.endsWith("\n");
  let lines = text.split("\n");
  if (hasTrailingNewline) lines = lines.slice(0, -1);

  lines.forEach((line, index) => {
    const trimmed = line.replace(/\r$/, "");
    if (trimmed.trim() === "") return;
    const isFinal = index === lines.length - 1 && !hasTrailingNewline;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      if (isFinal) {
        incompleteTail = true;
      } else {
        warnings.push(`Malformed trajectory line ${index + 1}`);
      }
      return;
    }
    if (!isRecordLike(parsed) || parsed.type !== "record") {
      if (isRecordLike(parsed) && parsed.type === "header") {
        if (!header) header = parsed as unknown as TrajectoryHeader;
        return;
      }
      warnings.push(`Unknown trajectory line ${index + 1}`);
      return;
    }
    records.push(parsed as unknown as TrajectoryRecord);
  });

  return { header, records, warnings, incompleteTail };
}

/**
 * Ensure the sidecar exists and its header line is written. Safe to call
 * concurrently: the header write uses an exclusive-create flag.
 */
export async function ensureTrajectoryStore(
  agentDir: string,
  sessionId: string,
  now: number = Date.now(),
): Promise<void> {
  await mkdir(join(agentDir, "trajectories"), { recursive: true });
  const path = trajectoryPath(agentDir, sessionId);
  const header: TrajectoryHeader = {
    schemaVersion: SCHEMA_VERSION,
    type: "header",
    sessionId,
    createdAt: now,
  };
  try {
    await appendFile(path, JSON.stringify(header) + "\n", {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

export async function appendTrajectoryRecord(
  agentDir: string,
  sessionId: string,
  record: TrajectoryRecord,
): Promise<void> {
  await ensureTrajectoryStore(agentDir, sessionId);
  const path = trajectoryPath(agentDir, sessionId);
  await appendFile(path, JSON.stringify(record) + "\n", "utf8");
}

export async function readTrajectoryFile(
  agentDir: string,
  sessionId: string,
): Promise<TrajectoryReadResult | null> {
  const path = trajectoryPath(agentDir, sessionId);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return readTrajectoryText(text);
}
