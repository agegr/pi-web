/**
 * Telegram wire handling for the Robin bridge. Pure — no I/O, so the rules that
 * matter (who is allowed, what gets acknowledged) can be tested directly.
 */

export interface TelegramPhoto {
  /** `file_id` for getFile. */
  fileId: string;
  width?: number;
  height?: number;
}

export interface IncomingMessage {
  updateId: number;
  chatId: number;
  /** Display name for logs only; never used for authorization. */
  from: string;
  /**
   * The message text, or the photo caption. Empty for a bare photo, which is
   * why the photo attachment must be checked before treating a message as blank.
   */
  text: string;
  /**
   * The sender's Telegram client language, e.g. "en" or "zh-hans".
   *
   * The bridge runs outside the browser, so it cannot see the language chosen
   * in the dashboard — that lives in localStorage. Telegram reports the
   * sender's own client language, which is the closest true signal available.
   */
  languageCode?: string;
  /**
   * Photo attachments. Telegram sends one array per photo with several sizes;
   * the largest is last. Present only for photo messages.
   */
  photos?: TelegramPhoto[];
}

export interface ParsedUpdates {
  messages: IncomingMessage[];
  /**
   * Offset to request next. Acknowledges every update seen, including ones
   * skipped as unsupported — otherwise a single unhandled update type (a
   * sticker, a channel post) wedges the loop forever re-fetching it.
   */
  nextOffset: number | null;
}

/**
 * Normalize Telegram's `photo` array into `file_id`s. Telegram lists the same
 * photo at several sizes, smallest first; callers take the last for the full
 * resolution. An empty array means the update carried no usable photo.
 */
export function parsePhotos(photo: unknown): TelegramPhoto[] {
  if (!Array.isArray(photo)) return [];
  const photos: TelegramPhoto[] = [];
  for (const size of photo) {
    const item = size as { file_id?: unknown; width?: unknown; height?: unknown };
    if (typeof item.file_id !== "string" || !item.file_id) continue;
    photos.push({
      fileId: item.file_id,
      ...(typeof item.width === "number" ? { width: item.width } : {}),
      ...(typeof item.height === "number" ? { height: item.height } : {}),
    });
  }
  return photos;
}

export function parseUpdates(payload: unknown): ParsedUpdates {
  const result = payload as { ok?: boolean; result?: unknown[] } | null;
  if (!result?.ok || !Array.isArray(result.result)) return { messages: [], nextOffset: null };

  const messages: IncomingMessage[] = [];
  let highest: number | null = null;

  for (const raw of result.result) {
    const update = raw as {
      update_id?: unknown;
      message?: {
        chat?: { id?: unknown };
        from?: { first_name?: unknown; username?: unknown; language_code?: unknown };
        text?: unknown;
        caption?: unknown;
        photo?: unknown;
      };
    };
    if (typeof update.update_id !== "number") continue;
    // Advanced for EVERY update, including callback queries this function does
    // not return — an un-acknowledged update is redelivered on the next poll,
    // forever.
    highest = highest === null ? update.update_id : Math.max(highest, update.update_id);

    const chatId = update.message?.chat?.id;
    if (typeof chatId !== "number") continue;

    const rawText = update.message?.text;
    const rawCaption = update.message?.caption;
    const text = typeof rawText === "string" ? rawText.trim()
      : typeof rawCaption === "string" ? rawCaption.trim() : "";
    const photos = parsePhotos(update.message?.photo);
    // A photo message has no `text` field, so without this a bare photo would
    // be treated as blank and dropped.
    if (!text && photos.length === 0) continue;

    const languageCode = update.message?.from?.language_code;
    messages.push({
      updateId: update.update_id,
      chatId,
      from: String(update.message?.from?.username ?? update.message?.from?.first_name ?? "unknown"),
      text,
      ...(typeof languageCode === "string" ? { languageCode } : {}),
      ...(photos.length > 0 ? { photos } : {}),
    });
  }

  return { messages, nextOffset: highest === null ? null : highest + 1 };
}

/**
 * Parse the chat-id allowlist.
 *
 * An empty list is meaningful: it puts the bridge in discovery mode, where it
 * reports the ids it sees and refuses to act on anything. That gives a way to
 * learn your own chat id without ever leaving the bot open to strangers.
 */
export function parseAllowlist(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const parsed = Number(part);
      if (!Number.isInteger(parsed)) throw new Error(`Not a numeric chat id: "${part}"`);
      return parsed;
    });
}

export function isAllowed(chatId: number, allowlist: number[]): boolean {
  return allowlist.includes(chatId);
}

/** Telegram rejects messages longer than this. */
export const MAX_MESSAGE_LENGTH = 4096;

/**
 * Split a reply for Telegram, preferring line boundaries so a long answer does
 * not get cut mid-word.
 */
export function chunkMessage(text: string, limit = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const breakAt = window.lastIndexOf("\n");
    const cut = breakAt > limit * 0.5 ? breakAt : limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export type BridgeLocale = "en" | "zh";

/** Telegram reports tags like "zh-hans" or "zh-CN"; both mean Chinese here. */
export function resolveLocale(languageCode: string | undefined): BridgeLocale {
  return languageCode?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

const TOOL_LABELS: Record<BridgeLocale, Record<string, string>> = {
  en: {
    todo_add: "added a todo",
    todo_update: "updated a todo",
    todo_delete: "deleted a todo",
    todo_complete: "completed a todo",
    todo_list: "read your todos",
    calendar_create_event: "added an event",
    calendar_list_events: "read your calendar",
    link_add: "saved a link",
    link_list: "read your links",
  },
  zh: {
    todo_add: "记了待办",
    todo_update: "改了待办",
    todo_delete: "删了待办",
    todo_complete: "完成了待办",
    todo_list: "查了待办",
    calendar_create_event: "加了日程",
    calendar_list_events: "查了日历",
    link_add: "存了链接",
    link_list: "查了链接",
  },
};

const STRINGS: Record<BridgeLocale, { emptyReply: string; error: (detail: string) => string; separator: string }> = {
  en: {
    emptyReply: "(no reply text)",
    error: (detail) => `Something went wrong: ${detail}`,
    separator: ", ",
  },
  zh: {
    emptyReply: "（没有回复内容）",
    error: (detail) => `出错了：${detail}`,
    separator: "、",
  },
};

export function errorMessage(detail: string, locale: BridgeLocale): string {
  return STRINGS[locale].error(detail);
}

/**
 * Append what the agent actually did.
 *
 * The tool list comes from executed tool calls, not from the model's prose, so
 * it is a factual record of side effects rather than a claim about them.
 */
export function formatReply(reply: string, usedTools: string[], locale: BridgeLocale = "en"): string {
  const strings = STRINGS[locale];
  const labels = TOOL_LABELS[locale];
  const body = reply.trim() || strings.emptyReply;
  const actions = [...new Set(usedTools)].map((name) => labels[name] ?? name);
  return actions.length > 0 ? `${body}\n\n— ${actions.join(strings.separator)}` : body;
}
