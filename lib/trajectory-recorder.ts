// TrajectoryRecorder: maps AgentSession lifecycle events and provider stream
// timing into append-only sidecar records. Recording failures are swallowed
// and must never block the agent run.

import { randomUUID } from "node:crypto";
import { fullPayload, summarizePayload } from "./trajectory-privacy";
import { appendTrajectoryRecord, ensureTrajectoryStore } from "./trajectory-store";
import type { TrajectoryRecord, TrajectoryStatus } from "./trajectory-types";

export interface TrajectoryRecorderOptions {
  agentDir: string;
  sessionId: string;
  cwd: string;
  now?: () => number;
  /** Current Pi branch leaf id; every record is anchored to it. */
  getLeafId?: () => string | null;
  onVersion?: (version: number) => void;
}

export class TrajectoryRecorder {
  readonly sessionId: string;
  /** True after the first write failure; recording is disabled from then on. */
  failed = false;

  private readonly agentDir: string;
  private readonly cwd: string;
  private readonly now: () => number;
  private readonly getLeafId: () => string | null;
  private readonly onVersion?: (version: number) => void;
  private sequence = 0;
  private version = 0;
  private writeTail: Promise<void> = Promise.resolve();
  private openRequests = new Set<string>();
  private openTurns = new Set<string>();
  private closed = false;

  constructor(options: TrajectoryRecorderOptions) {
    this.agentDir = options.agentDir;
    this.sessionId = options.sessionId;
    this.cwd = options.cwd;
    this.now = options.now ?? Date.now;
    this.getLeafId = options.getLeafId ?? (() => null);
    this.onVersion = options.onVersion;
  }

  async start(): Promise<void> {
    await ensureTrajectoryStore(this.agentDir, this.sessionId, this.now());
    this.write(this.nextRecord("session_start", { data: { cwd: this.cwd } }));
  }

  private nextRecord(
    kind: TrajectoryRecord["kind"],
    extra: Partial<TrajectoryRecord> = {},
  ): TrajectoryRecord {
    return {
      schemaVersion: 1,
      type: "record",
      sequence: ++this.sequence,
      id: randomUUID(),
      kind,
      timestamp: this.now(),
      leafId: this.getLeafId(),
      ...extra,
    };
  }

  private write(record: TrajectoryRecord): void {
    if (this.failed || this.closed) return;
    this.writeTail = this.writeTail
      .then(() => appendTrajectoryRecord(this.agentDir, this.sessionId, record))
      .then(() => {
        this.version += 1;
        this.onVersion?.(this.version);
      })
      .catch((error) => {
        this.failed = true;
        console.error(
          `[pi-web] trajectory recording failed for ${this.sessionId}:`,
          error instanceof Error ? error.message : error,
        );
      });
  }

  onAgentEvent(event: { type: string; [key: string]: unknown }): void {
    switch (event.type) {
      case "turn_start": {
        if (typeof event.turnIndex !== "number") return;
        const turnId = `turn-${event.turnIndex}`;
        const record = this.nextRecord("turn_start", {
          turnId,
          data: { summary: `Turn ${event.turnIndex}` },
        });
        this.openTurns.add(turnId);
        this.write(record);
        break;
      }
      case "turn_end": {
        if (typeof event.turnIndex !== "number") return;
        const turnId = `turn-${event.turnIndex}`;
        this.openTurns.delete(turnId);
        this.write(this.nextRecord("turn_end", {
          turnId,
          status: "complete",
          endTimestamp: this.now(),
          data: { summary: `Turn ${event.turnIndex} complete` },
        }));
        break;
      }
      case "tool_execution_start": {
        const toolCallId = String(event.toolCallId ?? "");
        if (!toolCallId) return;
        const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
        const record = this.nextRecord("tool_start", {
          stepId: toolCallId,
          data: {
            toolName,
            summary: `${toolName} ${String(summarizePayload(event.args).preview ?? "")}`.slice(0, 400),
          },
        });
        this.write(record);
        break;
      }
      case "tool_execution_end": {
        const toolCallId = String(event.toolCallId ?? "");
        if (!toolCallId) return;
        const isError = event.isError === true;
        const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
        this.write(this.nextRecord("tool_end", {
          stepId: toolCallId,
          status: isError ? "error" : "complete",
          endTimestamp: this.now(),
          data: {
            toolName,
            ...(isError ? { error: true } : {}),
            summary: `${toolName} ${isError ? "failed" : "complete"}`,
          },
        }));
        break;
      }
      case "auto_retry_start": {
        this.write(this.nextRecord("retry_start", {
          data: {
            ...(typeof event.attempt === "number" ? { attempt: event.attempt } : {}),
            ...(typeof event.delayMs === "number" ? { delayMs: event.delayMs } : {}),
            ...(typeof event.errorMessage === "string" ? { errorMessage: event.errorMessage } : {}),
            summary: `retry ${String(event.attempt ?? "")}`,
          },
        }));
        break;
      }
      case "auto_retry_end": {
        this.write(this.nextRecord("retry_end", {
          status: event.success === true ? "complete" : "error",
          endTimestamp: this.now(),
          data: {
            ...(typeof event.attempt === "number" ? { attempt: event.attempt } : {}),
            ...(typeof event.finalError === "string" ? { error: event.finalError } : {}),
            summary: event.success === true ? "retry succeeded" : "retry failed",
          },
        }));
        break;
      }
      case "compaction_start": {
        this.write(this.nextRecord("compaction_start", {
          data: {
            ...(typeof event.reason === "string" ? { reason: event.reason } : {}),
            summary: "compaction started",
          },
        }));
        break;
      }
      case "compaction_end": {
        this.write(this.nextRecord("compaction_end", {
          status: event.aborted === true ? "aborted" : "complete",
          endTimestamp: this.now(),
          data: {
            ...(typeof event.reason === "string" ? { reason: event.reason } : {}),
            summary: event.aborted === true ? "compaction aborted" : "compaction complete",
          },
        }));
        break;
      }
      case "error":
      case "extension_error": {
        this.write(this.nextRecord("error", {
          status: "error",
          data: {
            ...(typeof event.extensionPath === "string" ? { extensionPath: event.extensionPath } : {}),
            summary: typeof event.error === "string" ? event.error.slice(0, 400) : "error",
          },
        }));
        break;
      }
      case "agent_end": {
        // A run that ended without request/turn end events was stopped
        // mid-flight; close everything as aborted so the projection never
        // fabricates a duration.
        for (const requestId of [...this.openRequests.keys()]) {
          this.finishRequest(requestId, "aborted");
        }
        for (const turnId of [...this.openTurns.keys()]) {
          this.write(this.nextRecord("turn_end", {
            turnId,
            status: "aborted",
            endTimestamp: this.now(),
            data: { summary: "Turn aborted" },
          }));
        }
        this.openTurns.clear();
        break;
      }
    }
  }

  startRequest(model: unknown, context: unknown, options: unknown): string {
    const requestId = randomUUID();
    const modelRec = (model ?? {}) as { id?: unknown; provider?: unknown };
    const contextRec = (context ?? {}) as { systemPrompt?: unknown };
    const optionsRec = (options ?? {}) as { thinkingLevel?: unknown };
    const modelName = typeof modelRec.id === "string" ? modelRec.id : undefined;
    const provider = typeof modelRec.provider === "string" ? modelRec.provider : undefined;
    const thinkingLevel = typeof optionsRec.thinkingLevel === "string"
      ? optionsRec.thinkingLevel
      : undefined;
    const snapshot = fullPayload({
      ...(contextRec.systemPrompt !== undefined ? { systemPrompt: contextRec.systemPrompt } : {}),
    });
    this.write(this.nextRecord("request_start", {
      requestId,
      data: {
        ...(modelName ? { model: modelName } : {}),
        ...(provider ? { provider } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
        summary: `request ${modelName ?? "unknown model"}`,
        context: snapshot,
      },
    }));
    this.openRequests.add(requestId);
    return requestId;
  }

  firstToken(requestId: string): void {
    if (!this.openRequests.has(requestId)) return;
    this.write(this.nextRecord("request_first_token", { requestId }));
  }

  finishRequest(
    requestId: string,
    status: TrajectoryStatus,
    result?: unknown,
  ): void {
    this.openRequests.delete(requestId);
    const message = (result ?? {}) as { usage?: unknown; stopReason?: unknown; errorMessage?: unknown };
    const usage = message.usage as
      | { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown; totalTokens?: unknown }
      | undefined;
    const errorText = status === "error"
      ? (typeof message.errorMessage === "string"
          ? message.errorMessage
          : result instanceof Error
            ? result.message
            : String(result))
      : undefined;
    this.write(this.nextRecord("request_end", {
      requestId,
      status,
      endTimestamp: this.now(),
      data: {
        summary: status === "error" ? `request failed: ${errorText ?? "unknown error"}` : `request ${status}`,
        ...(usage
          ? { usage: {
              input: Number(usage.input ?? 0),
              output: Number(usage.output ?? 0),
              cacheRead: Number(usage.cacheRead ?? 0),
              cacheWrite: Number(usage.cacheWrite ?? 0),
              total: Number(usage.totalTokens ?? 0),
            } }
          : {}),
        ...(typeof message.stopReason === "string" ? { stopReason: message.stopReason } : {}),
        ...(status === "aborted" ? { error: "aborted" } : {}),
        ...(errorText !== undefined ? { error: errorText.slice(0, 400) } : {}),
      },
    }));
  }

  recordSubagentLink(data: Record<string, unknown>): void {
    this.write(this.nextRecord("subagent_link", {
      data: {
        ...data,
        summary: `subagent ${typeof data.agent === "string" ? data.agent : "child"}`,
      },
    }));
  }

  async flush(): Promise<void> {
    await this.writeTail;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    for (const requestId of [...this.openRequests.keys()]) {
      this.finishRequest(requestId, "aborted");
    }
    for (const turnId of [...this.openTurns.keys()]) {
      this.write(this.nextRecord("turn_end", {
        turnId,
        status: "aborted",
        endTimestamp: this.now(),
        data: { summary: "Turn aborted" },
      }));
    }
    this.openRequests.clear();
    this.openTurns.clear();
    await this.flush();
    this.closed = true;
  }
}
