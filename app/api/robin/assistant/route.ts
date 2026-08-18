import { NextResponse } from "next/server";
import { mkdirSync } from "node:fs";
import {
  dataDir,
  readAssistantSessionId,
  readDailyAgendaSessionId,
  writeAssistantSessionId,
  writeDailyAgendaSessionId,
} from "@/extension/robin/store";
import { ROBIN_READ_ONLY_TOOL_NAMES, ROBIN_TOOL_NAMES } from "@/extension/robin/tools";
import { getRpcSession, startRpcSession, type AgentSessionWrapper } from "@/lib/rpc-manager";
import { validateAgentImages } from "@/lib/image-attachments";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { resolveSessionPath } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

/** A dashboard command is a sentence, not a coding task; well under a minute. */
const TURN_TIMEOUT_MS = 90_000;

const TOOL_NAMES = [...ROBIN_TOOL_NAMES];

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
): Promise<{ session: AgentSessionWrapper; sessionId: string }> {
  if (remembered) {
    const live = getRpcSession(remembered);
    if (live?.isAlive()) {
      await live.send({ type: "set_tools", toolNames, exact: true });
      return { session: live, sessionId: remembered };
    }
    const filePath = await resolveSessionPath(remembered);
    if (filePath) {
      const { session, realSessionId } = await startRpcSession(remembered, filePath, undefined, {
        toolNames,
        exactTools: true,
      });
      await session.send({ type: "set_tools", toolNames, exact: true });
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
    { toolNames, exactTools: true },
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
      TURN_TIMEOUT_MS,
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

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as { message?: unknown; readOnly?: unknown; images?: unknown };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const imageError = body.images === undefined ? null : validateAgentImages(body.images);
    if (imageError) {
      return NextResponse.json({ error: imageError }, { status: 400 });
    }
    const images = (body.images ?? []) as Array<{ type: "image"; data: string; mimeType: string }>;
    if (!message && images.length === 0) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const readOnly = body.readOnly === true;
    const toolNames = readOnly ? [...ROBIN_READ_ONLY_TOOL_NAMES] : TOOL_NAMES;
    const { session, sessionId } = await acquireSession(
      toolNames,
      readOnly ? readDailyAgendaSessionId() : readAssistantSessionId(),
      readOnly ? writeDailyAgendaSessionId : writeAssistantSessionId,
    );
    const { reply, usedTools } = await runTurn(session, message, images);
    return NextResponse.json({ reply, usedTools, sessionId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
