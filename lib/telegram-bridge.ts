import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { startRpcSession, type AgentSessionWrapper } from "./rpc-manager";
import { readTelegramConfig, type TelegramBridgeConfig } from "./telegram-config";

type TelegramUser = {
  username?: string;
  first_name?: string;
};

type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: { id: number; type: string };
  from?: TelegramUser;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

type TelegramApiEnvelope<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type TelegramSessionRecord = {
  sessionId: string;
  sessionFile: string;
  cwd: string;
};

type TelegramBridgeState = {
  offset: number;
  chats: Record<string, TelegramSessionRecord>;
};

export type TelegramBridgeStatus = {
  running: boolean;
  botUsername: string | null;
  lastConnectedAt: string | null;
  lastMessageAt: string | null;
  lastError: string | null;
};

const EMPTY_STATUS: TelegramBridgeStatus = {
  running: false,
  botUsername: null,
  lastConnectedAt: null,
  lastMessageAt: null,
  lastError: null,
};

const TELEGRAM_MESSAGE_LIMIT = 4096;

export function splitTelegramMessage(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  const parts: string[] = [];
  let remaining = normalized;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const newline = window.lastIndexOf("\n");
    const space = window.lastIndexOf(" ");
    const splitAt = newline > limit * 0.55
      ? newline
      : space > limit * 0.55
        ? space
        : limit;
    parts.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) parts.push(remaining);
  return parts;
}
function telegramStatePath(): string {
  return join(getAgentDir(), "pi-web-telegram-state.json");
}

function readBridgeState(): TelegramBridgeState {
  const path = telegramStatePath();
  if (!existsSync(path)) return { offset: 0, chats: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<TelegramBridgeState>;
    return {
      offset: typeof parsed.offset === "number" ? parsed.offset : 0,
      chats: parsed.chats && typeof parsed.chats === "object" ? parsed.chats : {},
    };
  } catch {
    return { offset: 0, chats: {} };
  }
}

function writeBridgeState(state: TelegramBridgeState): void {
  const path = telegramStatePath();
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tempPath, path);
}

async function telegramApi<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const envelope = await response.json() as TelegramApiEnvelope<T>;
  if (!response.ok || !envelope.ok || envelope.result === undefined) {
    throw new Error(envelope.description || `Telegram API ${method} failed (${response.status})`);
  }
  return envelope.result;
}

export async function testTelegramToken(token: string): Promise<{ username: string; name: string }> {
  const bot = await telegramApi<{ username?: string; first_name?: string }>(token, "getMe", {});
  return {
    username: bot.username ?? "",
    name: bot.first_name ?? bot.username ?? "Telegram bot",
  };
}

class TelegramBridge {
  private controller: AbortController | null = null;
  private loopPromise: Promise<void> | null = null;
  private state: TelegramBridgeState = readBridgeState();
  private status: TelegramBridgeStatus = { ...EMPTY_STATUS };
  private chatQueues = new Map<string, Promise<void>>();

  getStatus(): TelegramBridgeStatus {
    return { ...this.status };
  }

  async restart(): Promise<void> {
    await this.stop();
    const config = readTelegramConfig();
    if (config.enabled && config.token && config.cwd && config.allowedChatIds.length > 0) {
      this.start(config);
    }
  }

  start(config = readTelegramConfig()): void {
    if (this.loopPromise || !config.enabled) return;
    this.controller = new AbortController();
    this.status = { ...EMPTY_STATUS, running: true };
    const signal = this.controller.signal;
    this.loopPromise = this.poll(config, signal)
      .catch((error) => {
        if (!signal.aborted) {
          this.status.lastError = error instanceof Error ? error.message : String(error);
          console.error("[pi-web] Telegram bridge stopped:", this.status.lastError);
        }
      })
      .finally(() => {
        this.status.running = false;
        this.controller = null;
        this.loopPromise = null;
      });
  }

  async stop(): Promise<void> {
    const promise = this.loopPromise;
    this.controller?.abort();
    if (promise) {
      try {
        await promise;
      } catch {
        // Poll cancellation is expected while applying new settings.
      }
    }
    this.status.running = false;
  }

  private async poll(config: TelegramBridgeConfig, signal: AbortSignal): Promise<void> {
    const bot = await testTelegramToken(config.token);
    this.status.botUsername = bot.username || null;
    this.status.lastConnectedAt = new Date().toISOString();
    this.status.lastError = null;

    while (!signal.aborted) {
      try {
        const updates = await telegramApi<TelegramUpdate[]>(
          config.token,
          "getUpdates",
          {
            offset: this.state.offset,
            timeout: 25,
            allowed_updates: ["message"],
          },
          signal,
        );
        this.status.lastConnectedAt = new Date().toISOString();
        this.status.lastError = null;

        for (const update of updates) {
          this.state.offset = Math.max(this.state.offset, update.update_id + 1);
          writeBridgeState(this.state);
          if (update.message) this.enqueueMessage(config, update.message);
        }
      } catch (error) {
        if (signal.aborted) break;
        this.status.lastError = error instanceof Error ? error.message : String(error);
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
    }
  }

  private enqueueMessage(config: TelegramBridgeConfig, message: TelegramMessage): void {
    const chatId = String(message.chat.id);
    const previous = this.chatQueues.get(chatId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => this.handleMessage(config, message))
      .catch((error) => {
        console.error(`[pi-web] Telegram chat ${chatId} failed:`, error);
      })
      .finally(() => {
        if (this.chatQueues.get(chatId) === next) this.chatQueues.delete(chatId);
      });
    this.chatQueues.set(chatId, next);
  }

  private async handleMessage(config: TelegramBridgeConfig, message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    if (!config.allowedChatIds.includes(chatId)) return;
    const text = message.text?.trim();
    if (!text) {
      await this.sendText(config.token, chatId, "Pi Web currently accepts text messages only.");
      return;
    }

    this.status.lastMessageAt = new Date().toISOString();

    if (text === "/start" || text === "/help") {
      await this.sendText(
        config.token,
        chatId,
        "Pi Web bridge is ready.\n\nSend a message to talk to Pi.\n/new — start a fresh Pi session\n/status — show the linked session",
      );
      return;
    }
    if (text === "/new") {
      delete this.state.chats[chatId];
      writeBridgeState(this.state);
      await this.sendText(config.token, chatId, "Started a fresh Pi session. Send your next message when ready.");
      return;
    }
    if (text === "/status") {
      const linked = this.state.chats[chatId];
      await this.sendText(
        config.token,
        chatId,
        linked
          ? `Connected to Pi session ${linked.sessionId}\nWorking directory: ${linked.cwd}`
          : `No Pi session is linked yet.\nWorking directory: ${config.cwd}`,
      );
      return;
    }

    await telegramApi(config.token, "sendChatAction", { chat_id: chatId, action: "typing" });
    try {
      const session = await this.getSession(chatId, config.cwd);
      const answer = await this.prompt(session, text);
      await this.sendText(config.token, chatId, answer || "Pi completed the request without a text response.");
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await this.sendText(config.token, chatId, `Pi bridge error: ${messageText}`);
    }
  }

  private async getSession(chatId: string, cwd: string): Promise<AgentSessionWrapper> {
    const record = this.state.chats[chatId];
    if (record && record.cwd === cwd && record.sessionFile && existsSync(record.sessionFile)) {
      const { session } = await startRpcSession(record.sessionId, record.sessionFile, cwd);
      return session;
    }

    const tempKey = `__telegram__${chatId}_${Date.now()}`;
    const { session, realSessionId } = await startRpcSession(tempKey, "", cwd);
    this.state.chats[chatId] = {
      sessionId: realSessionId,
      sessionFile: session.sessionFile,
      cwd,
    };
    writeBridgeState(this.state);
    return session;
  }

  private async prompt(session: AgentSessionWrapper, message: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("Pi did not finish within 30 minutes."));
      }, 30 * 60 * 1000);
      const finish = async (error?: string) => {
        clearTimeout(timeout);
        unsubscribe();
        if (error) {
          reject(new Error(error));
          return;
        }
        try {
          const result = await session.send({ type: "get_last_assistant_text" }) as { text?: string };
          resolve(result.text ?? "");
        } catch (err) {
          reject(err);
        }
      };
      const unsubscribe = session.onEvent((event) => {
        if (event.type === "prompt_error") void finish(String(event.errorMessage ?? "Pi prompt failed."));
        else if (event.type === "prompt_done") void finish();
      });

      session.send({ type: "prompt", message }).catch((error) => {
        void finish(error instanceof Error ? error.message : String(error));
      });
    });
  }

  private async sendText(token: string, chatId: string, text: string): Promise<void> {
    const parts = splitTelegramMessage(text);
    for (const part of parts) {
      await telegramApi(token, "sendMessage", {
        chat_id: chatId,
        text: part,
        link_preview_options: { is_disabled: true },
      });
    }
  }
}

declare global {
  var __piWebTelegramBridge: TelegramBridge | undefined;
}

export function getTelegramBridge(): TelegramBridge {
  if (!globalThis.__piWebTelegramBridge) {
    globalThis.__piWebTelegramBridge = new TelegramBridge();
  }
  return globalThis.__piWebTelegramBridge;
}

export function startTelegramBridge(): void {
  getTelegramBridge().start();
}
