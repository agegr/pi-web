/**
 * Telegram → Robin bridge.
 *
 * A standalone process, deliberately not a pi extension: extensions load per
 * session, so every `pi -p` invocation and every pi-web session would start its
 * own poller. Telegram's getUpdates acknowledges by offset, so concurrent
 * pollers on one token steal and drop each other's messages. Exactly one
 * consumer is required, and a separate process is the only way to guarantee it.
 *
 * It talks to pi-web over HTTP, reusing /api/robin/assistant — which already
 * carries the tool allow-list, so the bridge inherits the same boundary rather
 * than inventing a second one.
 *
 * Long polling, never webhooks: getUpdates is an outbound call, so nothing
 * needs to listen on a public port and no certificate or tunnel is involved.
 *
 * Run with:  node --experimental-strip-types scripts/telegram/bridge.ts
 */
import { pathToFileURL } from "node:url";
import { localDate } from "../../extension/robin/dates.ts";
import {
  DEFAULT_DAILY_AGENDA,
  telegramSettings,
  type DailyAgendaSettings,
} from "../../extension/robin/settings.ts";
import {
  markDailyAgendaSent,
  readDailyAgendaDelivery,
  type DailyAgendaDelivery,
} from "../../extension/robin/store.ts";
import {
  chunkMessage,
  errorMessage,
  formatReply,
  isAllowed,
  parseAllowlist,
  parseUpdates,
  resolveLocale,
  type BridgeLocale,
  type IncomingMessage,
} from "./protocol.ts";

const TELEGRAM_API = "https://api.telegram.org";
/** Long-poll window; Telegram holds the request open this long when idle. */
const POLL_TIMEOUT_SECONDS = 30;
const AGENT_TIMEOUT_MS = 120_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

export interface BridgeConfig {
  token: string;
  allowlist: number[];
  piWebUrl: string;
  /** Basic-auth password when PI_WEB_PASSWORD is set on pi-web. */
  password?: string;
  dailyAgenda: DailyAgendaSettings;
}

export interface BridgeDeps {
  fetch: typeof fetch;
  log: (message: string) => void;
  now: () => number;
  readDailyAgendaDelivery: () => DailyAgendaDelivery | null;
  markDailyAgendaSent: (date: string, chatId: number) => void;
}

/**
 * Resolve the token and allow-list.
 *
 * Reads the same store the dashboard's settings screen writes, so a value saved
 * there is what the bridge actually uses — falling back to the environment for
 * headless setups. `stored` is injectable so the tests do not touch the real
 * secrets file.
 */
export function readConfig(
  env: NodeJS.ProcessEnv,
  stored: {
    botToken?: string;
    allowedChatIds: number[];
    dailyAgenda?: DailyAgendaSettings;
  } = telegramSettings(),
): BridgeConfig {
  const token = stored.botToken?.trim() || env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "No Telegram bot token. Set one on the dashboard settings page (/dashboard/settings), "
      + "or put TELEGRAM_BOT_TOKEN in .env.local.",
    );
  }
  const allowlist = stored.allowedChatIds.length > 0
    ? stored.allowedChatIds
    : parseAllowlist(env.TELEGRAM_ALLOWED_CHAT_IDS);

  return {
    token,
    allowlist,
    piWebUrl: (env.PI_WEB_URL?.trim() || "http://127.0.0.1:30141").replace(/\/$/, ""),
    ...(env.PI_WEB_PASSWORD?.trim() ? { password: env.PI_WEB_PASSWORD.trim() } : {}),
    dailyAgenda: stored.dailyAgenda ?? { ...DEFAULT_DAILY_AGENDA },
  };
}

async function telegram(
  config: BridgeConfig,
  deps: BridgeDeps,
  method: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await deps.fetch(`${TELEGRAM_API}/bot${config.token}/${method}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = (parsed as { description?: string } | null)?.description ?? `HTTP ${response.status}`;
      throw new Error(`Telegram ${method} failed: ${detail}`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendMessage(
  config: BridgeConfig,
  deps: BridgeDeps,
  chatId: number,
  text: string,
): Promise<void> {
  for (const chunk of chunkMessage(text)) {
    await telegram(config, deps, "sendMessage", { chat_id: chatId, text: chunk }, 30_000);
  }
}

/** Ask the assistant. Returns text ready to send back. */
export async function askAssistant(
  config: BridgeConfig,
  deps: BridgeDeps,
  message: string,
  locale: BridgeLocale = "en",
  readOnly = false,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  try {
    const response = await deps.fetch(`${config.piWebUrl}/api/robin/assistant`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(config.password
          ? { Authorization: `Basic ${Buffer.from(`pi:${config.password}`).toString("base64")}` }
          : {}),
      },
      body: JSON.stringify({ message, ...(readOnly ? { readOnly: true } : {}) }),
    });
    const parsed = await response.json().catch(() => null) as
      { reply?: string; usedTools?: string[]; error?: string } | null;
    if (!response.ok) {
      throw new Error(parsed?.error ?? `pi-web returned HTTP ${response.status}`);
    }
    return formatReply(parsed?.reply ?? "", parsed?.usedTools ?? [], locale);
  } finally {
    clearTimeout(timer);
  }
}

/** Returns the machine-local date once today's configured send time has arrived. */
export function dailyAgendaRunKey(
  schedule: DailyAgendaSettings,
  now: number,
): string | null {
  if (!schedule.enabled) return null;
  const at = new Date(now);
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  return time >= schedule.time ? localDate(at) : null;
}

export function pendingDailyAgendaChatIds(
  allowlist: number[],
  date: string,
  delivery: DailyAgendaDelivery | null,
): number[] {
  if (delivery?.date !== date) return allowlist;
  return allowlist.filter((chatId) => !delivery.chatIds.includes(chatId));
}

export async function sendDailyAgenda(
  config: BridgeConfig,
  deps: BridgeDeps,
  date: string,
  chatIds = config.allowlist,
): Promise<void> {
  const prompt = config.dailyAgenda.locale === "zh"
    ? `生成 ${date} 的 Telegram 每日简报。必须调用 todo_list 和 calendar_list_events，简洁列出今天的日程和未完成待办。不要新增或修改任何内容，只返回可直接发送的简报。`
    : `Create my Telegram daily briefing for ${date}. You must call todo_list and calendar_list_events. Concisely list today's agenda and unfinished todos. Do not add or change anything; return only the ready-to-send briefing.`;
  const reply = await askAssistant(config, deps, prompt, config.dailyAgenda.locale, true);
  for (const chatId of chatIds) {
    await sendMessage(config, deps, chatId, reply);
    deps.markDailyAgendaSent(date, chatId);
  }
  deps.log(`[daily agenda] sent ${date} to ${chatIds.length} chat(s)`);
}

export async function handleMessage(
  config: BridgeConfig,
  deps: BridgeDeps,
  message: IncomingMessage,
): Promise<void> {
  // Authorization happens before anything costly, and before any reply. An
  // unknown chat gets silence, not an error: answering would confirm the bot
  // exists and invite probing.
  if (!isAllowed(message.chatId, config.allowlist)) {
    deps.log(
      config.allowlist.length === 0
        ? `[discovery] chat id ${message.chatId} (${message.from}) said: ${message.text.slice(0, 60)}\n`
          + `           Add it: TELEGRAM_ALLOWED_CHAT_IDS=${message.chatId}`
        : `[refused] chat id ${message.chatId} (${message.from}) is not on the allow-list`,
    );
    return;
  }

  // The bridge has no access to the dashboard's language setting, so replies
  // follow the sender's own Telegram client language.
  const locale = resolveLocale(message.languageCode);

  deps.log(`[${message.chatId}] ${message.text}`);
  try {
    const reply = await askAssistant(config, deps, message.text, locale);
    await sendMessage(config, deps, message.chatId, reply);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    deps.log(`[error] ${detail}`);
    // The sender is authorized, so an error is useful to them rather than a leak.
    await sendMessage(config, deps, message.chatId, errorMessage(detail, locale)).catch(() => {});
  }
}

/**
 * One long-poll cycle. Returns the next offset.
 *
 * Messages are handled strictly one at a time: they all land in the same pi
 * session, which cannot take a second prompt while the first is still running.
 */
export async function pollOnce(
  config: BridgeConfig,
  deps: BridgeDeps,
  offset: number | null,
): Promise<number | null> {
  const payload = await telegram(
    config,
    deps,
    "getUpdates",
    {
      timeout: POLL_TIMEOUT_SECONDS,
      ...(offset === null ? {} : { offset }),
      allowed_updates: ["message"],
    },
    (POLL_TIMEOUT_SECONDS + 15) * 1000,
  );

  const { messages, nextOffset } = parseUpdates(payload);
  for (const message of messages) {
    await handleMessage(config, deps, message);
  }
  return nextOffset ?? offset;
}

export async function run(config: BridgeConfig, deps: BridgeDeps): Promise<void> {
  deps.log(`Robin Telegram bridge → ${config.piWebUrl}`);
  deps.log(
    config.allowlist.length === 0
      ? "No allow-list set — running in discovery mode. Message the bot to learn your chat id; nothing will be acted on."
      : `Allowed chat ids: ${config.allowlist.join(", ")}`,
  );

  let offset: number | null = null;
  let backoff = BACKOFF_START_MS;

  for (;;) {
    try {
      offset = await pollOnce(config, deps, offset);
      const runKey = config.allowlist.length > 0
        ? dailyAgendaRunKey(config.dailyAgenda, deps.now())
        : null;
      if (runKey) {
        const pending = pendingDailyAgendaChatIds(
          config.allowlist,
          runKey,
          deps.readDailyAgendaDelivery(),
        );
        if (pending.length > 0) await sendDailyAgenda(config, deps, runKey, pending);
      }
      backoff = BACKOFF_START_MS;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      deps.log(`[poll error] ${detail} — retrying in ${Math.round(backoff / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      // Exponential backoff keeps a dead network or a revoked token from
      // hammering Telegram and burning rate limit.
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    }
  }
}

// Compare resolved URLs rather than matching on the filename: a suffix match
// would also fire when this module is imported by a script of the same name.
const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const deps: BridgeDeps = {
    fetch: globalThis.fetch,
    log: (message) => console.log(`${new Date().toISOString()} ${message}`),
    now: () => Date.now(),
    readDailyAgendaDelivery,
    markDailyAgendaSent,
  };
  try {
    await run(readConfig(process.env), deps);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
