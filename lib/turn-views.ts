import type { AssistantContentBlock, AssistantMessage } from "./types";
import { getAssistantErrorMessage, isAssistantTruncated, splitFinalAssistantBlocks } from "./message-display";
import type { WrittenFile } from "./turn-written-files";

/** What the chat shows of a turn's final assistant message, apart. */
export interface FinalAnswerViews {
  /** The answer under the process group; null when the turn has none. */
  answer: AssistantMessage | null;
  /** What the message did before its answer, inside the process group. */
  process: AssistantMessage;
  writtenFiles?: WrittenFile[];
}

function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  return next;
}

/**
 * Splits a turn's final assistant message into its answer and its process part.
 * MessageView is memoized, and copies built afresh on each render defeat it: every
 * visible answer then runs its markdown again whenever anything in the chat changes,
 * be it a streamed chunk, a notice or a key typed into an extension's custom panel
 * (#1005). So the copies are kept per stored message, which is never mutated.
 */
export function getFinalAnswerViews(
  cache: WeakMap<AssistantMessage, FinalAnswerViews>,
  message: AssistantMessage,
): FinalAnswerViews {
  const cached = cache.get(message);
  if (cached) return cached;

  const { answerBlocks } = splitFinalAssistantBlocks(message);
  const answer = answerBlocks.length > 0 || getAssistantErrorMessage(message) || isAssistantTruncated(message)
    ? withAssistantBlocks(message, answerBlocks)
    : null;
  const processEnd = message.content.indexOf(answerBlocks[0]);
  const views: FinalAnswerViews = {
    answer,
    // Keep the original prefix so deferred thinking retains its stored block indices.
    process: withAssistantBlocks(
      message,
      message.content.slice(0, processEnd < 0 ? undefined : processEnd),
      { omitUsage: Boolean(answer) },
    ),
  };
  cache.set(message, views);
  return views;
}

/** The list passed last time while the turn still wrote the same files, for the same reason. */
export function keepWrittenFiles(views: FinalAnswerViews, next: WrittenFile[]): WrittenFile[] {
  const previous = views.writtenFiles;
  if (
    previous
    && previous.length === next.length
    && previous.every((file, index) => file.filePath === next[index].filePath)
  ) return previous;
  views.writtenFiles = next;
  return next;
}
