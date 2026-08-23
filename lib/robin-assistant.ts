/**
 * The Robin assistant's session machinery.
 *
 * Extracted from the route so the scoring runner can drive a turn directly
 * instead of making pi-web call its own HTTP endpoint — which would have to
 * get past the same basic auth that protects it from everyone else.
 */
import { mkdirSync } from "node:fs";
import {
  dataDir,
  readJobProfile,
  readAssistantSessionId,
  readDailyAgendaSessionId,
  readJobScorerSessionId,
  readMailReviewSessionId,
  writeAssistantSessionId,
  writeDailyAgendaSessionId,
  writeJobScorerSessionId,
  writeMailReviewSessionId,
} from "@/extension/robin/store";
import {
  ROBIN_MAIL_TOOL_NAMES,
  ROBIN_READ_ONLY_TOOL_NAMES,
  ROBIN_SCORING_TOOL_NAMES,
  ROBIN_TOOL_NAMES,
} from "@/extension/robin/tools";
import { getRpcSession, startRpcSession, type AgentSessionWrapper } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";

/** A dashboard command is a sentence, not a coding task; well under a minute. */
const TURN_TIMEOUT_MS = 90_000;

/**
 * Scoring is a batch, not a sentence: one turn walks a dozen postings and
 * calls a tool for each. It is also unattended — nobody is watching a spinner —
 * so it gets room to finish rather than being cut off halfway through a batch,
 * which would leave half the jobs unscored and invisible.
 */
const SCORING_TIMEOUT_MS = 300_000;

/**
 * The mail review reads a day's worth of mail and writes todos/events; it is
 * more work than a sentence but less than a scoring batch. Generous enough for
 * a full inbox day, short enough not to hang the page forever.
 */
const MAIL_TIMEOUT_MS = 180_000;

const TOOL_NAMES = [...ROBIN_TOOL_NAMES];

/**
 * Which tools a turn gets, and which session it runs in.
 *
 * The session is part of the mode, not an afterthought. `scoring` reads
 * employer-authored job descriptions, so it runs in its own session: anything
 * a posting tries to talk the model into dies with that turn instead of
 * sitting in the history of the assistant you chat with afterwards.
 */
export const MODES = {
  default: {
    toolNames: TOOL_NAMES,
    read: readAssistantSessionId,
    write: writeAssistantSessionId,
    timeoutMs: TURN_TIMEOUT_MS,
  },
  readOnly: {
    toolNames: [...ROBIN_READ_ONLY_TOOL_NAMES],
    read: readDailyAgendaSessionId,
    write: writeDailyAgendaSessionId,
    timeoutMs: TURN_TIMEOUT_MS,
  },
  scoring: {
    toolNames: [...ROBIN_SCORING_TOOL_NAMES],
    read: readJobScorerSessionId,
    write: writeJobScorerSessionId,
    timeoutMs: SCORING_TIMEOUT_MS,
    /**
     * Every scoring round starts from nothing.
     *
     * Scoring is stateless by nature — read the rubric, read the CV, read
     * forty postings, emit forty numbers — and resuming the previous round
     * buys nothing while costing everything: the session grew from 1.3k
     * tokens to 163k over five nights, re-reading every posting ever scored
     * on every subsequent turn, and descriptions make that grow several times
     * faster. It also undoes the isolation this mode exists for, since a
     * posting's text would otherwise sit in the history of the next round.
     *
     * The last session id is still recorded, so a bad batch can be traced.
     */
    stateless: true,
  },
  mail: {
    toolNames: [...ROBIN_MAIL_TOOL_NAMES],
    read: readMailReviewSessionId,
    write: writeMailReviewSessionId,
    timeoutMs: MAIL_TIMEOUT_MS,
  },
} as const;

export type AssistantMode = keyof typeof MODES;

/** `readOnly: true` predates `mode` and still means the daily-agenda mode. */
export function resolveMode(body: { mode?: unknown; readOnly?: unknown }): AssistantMode {
  if (typeof body.mode === "string" && body.mode in MODES) return body.mode as AssistantMode;
  return body.readOnly === true ? "readOnly" : "default";
}

interface AgentEventLike {
  type: string;
  [key: string]: unknown;
}

/**
 * Acquire the assistant session, restricted to the Robin tools.
 *
 * `set_tools` is re-sent on every acquisition rather than trusted from session
 * creation: a session restored from its file comes back with pi's default tool
 * set, which includes bash. Re-applying the allow-list here is what keeps the
 * restriction true for the life of the session.
 */
async function acquireSession(
  toolNames: string[],
  remembered: string | null,
  remember: (sessionId: string) => void,
  model?: { provider: string; modelId: string } | null,
): Promise<{ session: AgentSessionWrapper; sessionId: string }> {
  /**
   * Re-sent on every acquisition, like the tool list and for the same reason:
   * a session restored from its file comes back on whatever pi defaults to, so
   * pinning it once at creation would silently stop applying.
   */
  const applyModel = async (session: AgentSessionWrapper) => {
    if (!model) return;
    try {
      await session.send({ type: "set_model", provider: model.provider, modelId: model.modelId });
    } catch (error) {
      // A model that has been removed or renamed must not take the whole
      // scoring run down — falling back to the default still scores jobs.
      console.error(
        `[robin] scoring model ${model.provider}/${model.modelId} unavailable, using the default:`,
        error instanceof Error ? error.message : error,
      );
    }
  };

  if (remembered) {
    const live = getRpcSession(remembered);
    if (live?.isAlive()) {
      await live.send({ type: "set_tools", toolNames, exact: true });
      await applyModel(live);
      return { session: live, sessionId: remembered };
    }
    const filePath = await resolveSessionPath(remembered);
    if (filePath) {
      const { session, realSessionId } = await startRpcSession(remembered, filePath, undefined, {
        toolNames,
        exactTools: true,
      });
      await session.send({ type: "set_tools", toolNames, exact: true });
      await applyModel(session);
      return { session, sessionId: realSessionId };
    }
    // Remembered id no longer resolves (session deleted, agent dir moved): fall
    // through and start a fresh one rather than failing the request.
  }

  const cwd = dataDir();
  mkdirSync(cwd, { recursive: true });
  const { session, realSessionId } = await startRpcSession(
    `__robin_assistant__${Date.now()}`,
    "",
    cwd,
    { toolNames, exactTools: true, ...(model ? { initialModel: model } : {}) },
  );
  remember(realSessionId);
  return { session, sessionId: realSessionId };
}

function textFromMessage(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const { role, content } = message as { role?: unknown; content?: unknown };
  if (role !== "assistant") return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text: string } =>
      typeof block === "object" && block !== null
      && (block as { type?: unknown }).type === "text"
      && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
    .join("");
}

/**
 * Send the prompt and wait for the run to finish.
 *
 * `send({type:"prompt"})` resolves once pi accepts the submission, not when the
 * turn ends, so completion has to come off the event stream. Waiting here keeps
 * the browser on a plain request/response instead of a second SSE client.
 */
async function runTurn(
  session: AgentSessionWrapper,
  message: string,
  images: Array<{ type: "image"; data: string; mimeType: string }> = [],
  timeoutMs: number = TURN_TIMEOUT_MS,
): Promise<{ reply: string; usedTools: string[] }> {
  const chunks: string[] = [];
  const usedTools: string[] = [];

  return await new Promise<{ reply: string; usedTools: string[] }>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      outcome();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error("The assistant took too long to respond."))),
      timeoutMs,
    );

    const unsubscribe = session.onEvent((event: AgentEventLike) => {
      if (event.type === "message_end") {
        const text = textFromMessage(event.message);
        if (text) chunks.push(text);
        return;
      }
      if (event.type === "tool_execution_end" && typeof event.toolName === "string") {
        usedTools.push(event.toolName);
        return;
      }
      // `prompt_done` is the wrapper's own end-of-run signal; `agent_settled`
      // also covers runs an extension injected without one.
      if (event.type === "prompt_done" || event.type === "agent_settled") {
        finish(() => resolve({ reply: chunks.join("\n\n").trim(), usedTools }));
      }
    });

    session.send({
      type: "prompt",
      message,
      ...(images.length > 0 ? { images } : {}),
    }).catch((error: unknown) => {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    });
  });
}


/** One turn, in the mode's own session, with the mode's own tools and model. */
export async function runAssistantTurn(
  modeName: AssistantMode,
  message: string,
  images: Array<{ type: "image"; data: string; mimeType: string }> = [],
): Promise<{ reply: string; usedTools: string[]; sessionId: string }> {
  const mode = MODES[modeName];
  const stateless = "stateless" in mode && mode.stateless === true;
  const { session, sessionId } = await acquireSession(
    [...mode.toolNames],
    stateless ? null : mode.read(),
    mode.write,
    modeName === "scoring" ? readJobProfile().scoreModel : null,
  );
  const { reply, usedTools } = await runTurn(session, message, images, mode.timeoutMs);
  return { reply, usedTools, sessionId };
}
