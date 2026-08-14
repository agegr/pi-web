// E2E fixture: creates an isolated PI_CODING_AGENT_DIR with one session file
// plus a matching trajectory sidecar (and a child session for subagent
// expansion). The real user agent dir is never touched.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface TrajectoryFixture {
  agentDir: string;
  sessionId: string;
  childSessionId: string;
  leafEntryId: string;
  port: number;
  appUrl: string;
}

function record(sequence: number, kind: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    type: "record",
    sequence,
    id: `rec-${sequence}`,
    kind,
    timestamp: 1000 + sequence * 250,
    ...overrides,
  };
}

function writeSessionFile(agentDir: string, messageContent: string) {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  // SessionManager.listAll scans subdirectories of <agentDir>/sessions
  // (one directory per cwd), so the file lives in a nested dir.
  const sessionSubdir = join(agentDir, "sessions", "workdir");
  mkdirSync(sessionSubdir, { recursive: true });
  const filePath = join(sessionSubdir, `${Date.now()}_${id}.jsonl`);
  const entryId = `entry-${id}`;
  const lines = [
    JSON.stringify({ type: "session", version: 3, id, timestamp, cwd: agentDir }),
    JSON.stringify({
      type: "message",
      id: entryId,
      parentId: null,
      timestamp,
      message: { role: "user", content: messageContent },
    }),
  ];
  writeFileSync(filePath, lines.join("\n") + "\n");
  return { id, entryId };
}

function writeSidecar(agentDir: string, sessionId: string, leafEntryId: string, isChild = false) {
  const lines = [JSON.stringify({ schemaVersion: 1, type: "header", sessionId, createdAt: 1000 })];
  if (!isChild) {
    lines.push(
      JSON.stringify(record(1, "session_start", { leafId: null })),
      JSON.stringify(record(2, "turn_start", { turnId: "turn-0", leafId: leafEntryId })),
      JSON.stringify(record(3, "request_start", {
        requestId: "req-1",
        leafId: leafEntryId,
        data: { model: "gpt-5.6-sol", provider: "openai", summary: "request gpt-5.6-sol" },
      })),
      JSON.stringify(record(4, "request_first_token", { requestId: "req-1", leafId: leafEntryId, timestamp: 1800 })),
      JSON.stringify(record(5, "request_end", {
        requestId: "req-1",
        leafId: leafEntryId,
        status: "complete",
        endTimestamp: 4200,
        data: { usage: { input: 120, output: 80, cacheRead: 0, cacheWrite: 0, total: 200 }, summary: "request complete" },
      })),
      JSON.stringify(record(6, "tool_start", {
        stepId: "tc-1",
        leafId: leafEntryId,
        data: { toolName: "read", summary: "read · AGENTS.md" },
      })),
      JSON.stringify(record(7, "tool_end", {
        stepId: "tc-1",
        leafId: leafEntryId,
        status: "complete",
        endTimestamp: 4600,
        data: { toolName: "read", summary: "read complete" },
      })),
      JSON.stringify(record(8, "compaction_start", { leafId: leafEntryId, data: { reason: "threshold", summary: "compaction started" } })),
      JSON.stringify(record(9, "compaction_end", { leafId: leafEntryId, status: "complete", endTimestamp: 5200, data: { reason: "threshold", summary: "compaction complete" } })),
      JSON.stringify(record(10, "subagent_link", {
        leafId: leafEntryId,
        data: { childSessionId: process.env.E2E_CHILD_SESSION_ID ?? "", agent: "reviewer", summary: "subagent reviewer" },
      })),
    );
  } else {
    lines.push(
      JSON.stringify(record(1, "session_start", { leafId: null })),
      JSON.stringify(record(2, "request_start", {
        requestId: "c1",
        leafId: leafEntryId,
        data: { model: "gpt-5.6-lite", summary: "request gpt-5.6-lite" },
      })),
      JSON.stringify(record(3, "request_end", {
        requestId: "c1",
        leafId: leafEntryId,
        status: "complete",
        endTimestamp: 2600,
        data: { usage: { input: 40, output: 20, cacheRead: 0, cacheWrite: 0, total: 60 }, summary: "request complete" },
      })),
    );
  }
  writeFileSync(join(agentDir, "trajectories", `${sessionId}.jsonl`), lines.join("\n") + "\n");
}

export function createTrajectoryFixture(): TrajectoryFixture {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-trajectory-e2e-"));
  mkdirSync(join(agentDir, "sessions"), { recursive: true });
  mkdirSync(join(agentDir, "trajectories"), { recursive: true });

  const session = writeSessionFile(agentDir, "hello trajectory e2e");
  const child = writeSessionFile(agentDir, "child session");
  process.env.E2E_CHILD_SESSION_ID = child.id;
  writeSidecar(agentDir, session.id, session.entryId, false);
  writeSidecar(agentDir, child.id, child.entryId, true);

  const port = 33141;
  return {
    agentDir,
    sessionId: session.id,
    childSessionId: child.id,
    leafEntryId: session.entryId,
    port,
    appUrl: `http://127.0.0.1:${port}`,
  };
}
