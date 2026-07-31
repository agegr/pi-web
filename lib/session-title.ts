import { generateSessionTitle as generateOmpSessionTitle } from "@oh-my-pi/pi-coding-agent/utils/title-generator";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { AgentSessionLike } from "./omp-types";

const MAX_TITLE_LENGTH = 80;

export interface GeneratedSessionTitle {
  title: string;
}

/** Plain text of a session message, ignoring images and tool blocks. */
function messageText(message: AgentMessage): string {
  const content = (message as { content: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } =>
      typeof block === "object" && block !== null && (block as { type?: string }).type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** First user turn on the session's current branch. */
export function findFirstUserMessage(messages: readonly AgentMessage[]): string | undefined {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = messageText(message);
    if (text) return text;
  }
  return undefined;
}

export function truncateTitle(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(trimmed);
  return characters.length > MAX_TITLE_LENGTH
    ? characters.slice(0, MAX_TITLE_LENGTH).join("").trim()
    : trimmed;
}

/**
 * Name a session using omp's own title generator.
 *
 * omp titles sessions with the `tiny` → `commit` → `smol` role chain (or the
 * configured local tiny model), so a title generated from the browser costs the
 * same as one generated in the TUI and never burns the session's primary model.
 * Returns `null` when omp declines to title — greetings and other low-signal
 * first messages are deliberately left unnamed until the next real turn.
 */
export async function generateSessionTitle(
  session: AgentSessionLike,
): Promise<GeneratedSessionTitle | null> {
  const context = session.sessionManager.buildSessionContext();
  const firstMessage = findFirstUserMessage(context.messages);
  if (!firstMessage) {
    throw new Error("The session has no user messages to name");
  }

  const title = await generateOmpSessionTitle(
    firstMessage,
    session.modelRegistry as never,
    session.settings,
    session.sessionId,
    session.model as never,
  );
  if (!title) return null;

  const cleaned = truncateTitle(title);
  if (!/[\p{L}\p{N}]/u.test(cleaned)) {
    throw new Error("The model did not return a usable session title");
  }
  return { title: cleaned };
}
