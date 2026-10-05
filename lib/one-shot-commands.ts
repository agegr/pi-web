import type { InlineExtension } from "@earendil-works/pi-coding-agent";

export const ONE_SHOT_COMMAND_EXTENSION_NAME = "pi-web-one-shot-commands";

/**
 * Keep slash-command instructions from leaking into later turns.
 *
 * A prompt template expands into an ordinary user message, and that message
 * stays in the session transcript forever. A template whose body says "run
 * ask-dual.sh and present the three sections" therefore keeps instructing the
 * model on every following turn: the model re-runs the workflow when the user
 * only sent a short follow-up.
 *
 * The transcript cannot be edited after the fact and user messages have no
 * `excludeFromContext` flag (only bash results do). The `context` event is the
 * one supported place to rewrite what the model actually receives, so this
 * extension strips the one-shot blocks here instead of trusting the model to
 * ignore instructions it can still read.
 *
 * Only messages that carry the one-shot marker are touched, and only the marker
 * section is removed. The user's own words, the model's answers, and any
 * template content outside the marker stay intact, so the conversation still
 * reads correctly if it is exported or reopened.
 */

/** Marker appended by `expandChainedCommands` in lib/chained-commands.ts. */
const ONE_SHOT_MARKER = "**【一次性指令，仅对本次回复生效】**";

/** Trailing separator written before the marker by the expander. */
const MARKER_SEPARATOR = /\n*---\n+\*\*【一次性指令，仅对本次回复生效】\*\*[\s\S]*$/;

export interface OneShotCommandOptions {
  /** Disable stripping without removing the extension. */
  enabled?: () => boolean;
  /** Invoked when a block is stripped, for logging. */
  onStrip?: (count: number) => void;
}

interface TextBlock {
  type: string;
  text?: string;
}

/** True when the message still carries the one-shot instruction block. */
export function hasOneShotBlock(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const content = (message as { content?: unknown }).content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((b): b is TextBlock => !!b && typeof b === "object")
            .map((b) => b.text ?? "")
            .join("\n")
        : "";
  return text.includes(ONE_SHOT_MARKER);
}

/**
 * Remove the one-shot instruction block from one message.
 *
 * Returns the original object when there is nothing to strip, so untouched
 * messages keep their identity and the context cache still hits.
 */
export function stripOneShotBlock<T>(message: T): T {
  if (!message || typeof message !== "object") return message;
  const record = message as { content?: unknown };

  if (typeof record.content === "string") {
    if (!record.content.includes(ONE_SHOT_MARKER)) return message;
    const stripped = record.content.replace(MARKER_SEPARATOR, "").trimEnd();
    return { ...(message as object), content: stripped } as T;
  }

  if (!Array.isArray(record.content)) return message;

  let changed = false;
  const content = record.content.map((block) => {
    if (!block || typeof block !== "object") return block;
    const textBlock = block as TextBlock;
    if (typeof textBlock.text !== "string" || !textBlock.text.includes(ONE_SHOT_MARKER)) {
      return block;
    }
    changed = true;
    return { ...textBlock, text: textBlock.text.replace(MARKER_SEPARATOR, "").trimEnd() };
  });

  return changed ? ({ ...(message as object), content } as T) : message;
}

/**
 * Strip the one-shot instruction block from the transcript sent to the model.
 *
 * Returns the same array instance when nothing needed stripping, so callers can
 * detect a no-op by identity and leave the context untouched.
 */
export function stripOneShotInstructions<T>(messages: T[]): T[] {
  let stripped = 0;
  const next = messages.map((message) => {
    if (!hasOneShotBlock(message)) return message;
    stripped += 1;
    return stripOneShotBlock(message);
  });
  return stripped === 0 ? messages : next;
}

export function createOneShotCommandExtension(
  options: OneShotCommandOptions = {},
): InlineExtension {
  return {
    name: ONE_SHOT_COMMAND_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.on("context", (event) => {
        if (options.enabled && !options.enabled()) return undefined;
        const messages = event.messages as unknown[];
        const next = stripOneShotInstructions(messages);
        // Identity check: `stripOneShotInstructions` returns the same array when
        // there was nothing to do, and the SDK treats `undefined` as "unchanged".
        if (next === messages) return undefined;
        options.onStrip?.(messages.length);
        return { messages: next as typeof event.messages };
      });
    },
  };
}
