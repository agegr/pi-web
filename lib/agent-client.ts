// Client-side helper for POST /api/agent/[id].
//
// Every /api/agent/[id] route returns one of:
//   { success: true, data: <result> }
//   { error: string }              (non-2xx)
//
// Call sites previously repeated the same 5-line fetch block 13× in
// hooks/useAgentSession.ts. This helper collapses that down to one line.

export class AgentCommandError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly accepted?: boolean,
  ) {
    super(message);
    this.name = "AgentCommandError";
  }
}

export function isPromptRejectedError(error: unknown): error is AgentCommandError {
  return error instanceof AgentCommandError
    && error.code === "prompt_rejected"
    && error.accepted === false;
}

/**
 * True when a prompt failed because an ephemeral side conversation's runtime is
 * gone.
 *
 * The idle timeout can reclaim a side conversation while its panel is still
 * open. That is not a failure the user should have to resolve: the panel opens a
 * fresh fork and sends the prompt again, because an ephemeral fork holds no
 * state worth preserving.
 *
 * The server answers a prompt to a vanished session with 404 +
 * `prompt_rejected` — the same shape a genuinely missing session uses, which for
 * a side conversation is exactly what happened.
 *
 * Lives here rather than beside the rest of the side-conversation logic because
 * `lib/side-chat.ts` pulls in server-only modules (the session reader), and this
 * predicate is called from a client component.
 */
export function isSideChatReclaimError(
  error: { status?: number; code?: string; accepted?: boolean } | null | undefined,
): boolean {
  return Boolean(error)
    && error?.status === 404
    && error?.code === "prompt_rejected"
    && error?.accepted === false;
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
    );
  }
  return body.data as T;
}
