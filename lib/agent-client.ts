// Client-side helper for POST /api/agent/[id].
//
// Every /api/agent/[id] route returns one of:
//   { success: true, data: <result> }
//   { error: string }              (non-2xx)
//
// Call sites previously repeated the same 5-line fetch block 13× in
// hooks/useAgentSession.ts. This helper collapses that down to one line.

import { missingCwdFromBody } from "./missing-cwd";

export class AgentCommandError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly accepted?: boolean,
    /** The session's folder, when the refusal is that it no longer exists (#1422). */
    public readonly missingCwd?: string,
  ) {
    super(message);
    this.name = "AgentCommandError";
  }
}

/**
 * A command refused for an extension's error that pi's runner already reported as an
 * `extension_error` event (a `user_bash` handler that threw): the page shows that event's
 * notice, so the refusal adds none.
 */
export const EXTENSION_REPORTED_CODE = "extension_reported";

export function isPromptRejectedError(error: unknown): error is AgentCommandError {
  return error instanceof AgentCommandError
    && error.code === "prompt_rejected"
    && error.accepted === false;
}

/**
 * GET /api/agent/[id] without the system prompt, for status reads: the usage read after each
 * reply and on every stream connect, the settle and reconcile polls. None of them shows the
 * prompt, and it is nearly all of the reply (context files, skills, tool notes: hundreds of KB
 * in a large project), fetched again after every model call (#1302).
 */
export function agentStatusUrl(sessionId: string): string {
  return `/api/agent/${encodeURIComponent(sessionId)}?systemPrompt=0`;
}

export async function sendAgentCommand<T = unknown>(
  sessionId: string,
  command: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    error?: string;
    code?: string;
    accepted?: boolean;
  };
  if (!res.ok || body.error) {
    throw new AgentCommandError(
      body.error ?? `HTTP ${res.status}`,
      res.status,
      body.code,
      body.accepted,
      missingCwdFromBody(body) ?? undefined,
    );
  }
  return body.data as T;
}
