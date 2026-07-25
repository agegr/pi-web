import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getRpcSession, startRpcSession, type AgentEvent, type AgentSessionWrapper } from "./rpc-manager";
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

type TelegramSentMessage = {
  message_id: number;
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
const TELEGRAM_LIVE_EDIT_INTERVAL_MS = 1_100;
const TELEGRAM_THINKING_PREVIEW_LIMIT = 1_200;

type TelegramUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
};

type ModelStreamBlock = {
  kind: "model";
  model: string;
  thinking: string;
  text: string;
  usage?: TelegramUsage;
  active: boolean;
};

type ToolStreamBlock = {
  kind: "tool";
  id: string;
  name: string;
  preview: string;
  startedAt: number;
  finishedAt?: number;
  isError?: boolean;
};

type NoticeStreamBlock = {
  kind: "notice";
  text: string;
};

type StreamBlock = ModelStreamBlock | ToolStreamBlock | NoticeStreamBlock;

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

function formatModelName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Pi";
  const replacements: Record<string, string> = {
    ai: "AI",
    claude: "Claude",
    deepseek: "DeepSeek",
    flash: "Flash",
    gemini: "Gemini",
    gpt: "GPT",
    kimi: "Kimi",
    mini: "Mini",
    qwen: "Qwen",
    turbo: "Turbo",
  };
  return trimmed
    .split(/[-_/\s]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (replacements[lower]) return replacements[lower];
      if (/^v\d+(?:\.\d+)?$/i.test(part)) return part.toUpperCase();
      if (/^\d+(?:\.\d+)*[a-z]?$/i.test(part)) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function formatDuration(startedAt: number, finishedAt = Date.now()): string {
  const seconds = Math.max(0, finishedAt - startedAt) / 1_000;
  if (seconds < 1) return "<1s";
  if (seconds < 10) return `${seconds.toFixed(1).replace(/\.0$/, "")}s`;
  return `${Math.round(seconds)}s`;
}

function formatUsage(usage?: TelegramUsage): string {
  if (!usage) return "";
  const parts: string[] = [];
  if (usage.input) parts.push(`${usage.input.toLocaleString()} in`);
  if (usage.output) parts.push(`${usage.output.toLocaleString()} out`);
  if (usage.cacheRead) parts.push(`${usage.cacheRead.toLocaleString()} cache`);
  if (usage.cacheWrite) parts.push(`${usage.cacheWrite.toLocaleString()} cache write`);
  if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
  return parts.join(" · ");
}

function previewToolArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const input = args as Record<string, unknown>;
  const preferredKeys = ["command", "path", "file_path", "pattern", "query", "url", "description"];
  for (const key of preferredKeys) {
    if (!(key in input)) continue;
    const value = String(input[key] ?? "").trim();
    if (value) return value.length > 700 ? `${value.slice(0, 697)}...` : value;
  }
  const safeEntries = Object.entries(input)
    .filter(([key]) => !["content", "data", "image", "base64"].includes(key.toLowerCase()))
    .slice(0, 5);
  if (safeEntries.length === 0) return "";
  const value = JSON.stringify(Object.fromEntries(safeEntries));
  return value.length > 700 ? `${value.slice(0, 697)}...` : value;
}

function readAssistantSnapshot(message: unknown): {
  model: string;
  thinking: string;
  text: string;
  usage?: TelegramUsage;
} | null {
  if (!message || typeof message !== "object") return null;
  const candidate = message as {
    role?: unknown;
    model?: unknown;
    content?: unknown;
    usage?: TelegramUsage;
  };
  if (candidate.role !== "assistant") return null;
  const content = Array.isArray(candidate.content) ? candidate.content : [];
  const thinking: string[] = [];
  const text: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: unknown; thinking?: unknown; text?: unknown };
    if (item.type === "thinking" && typeof item.thinking === "string") thinking.push(item.thinking);
    if (item.type === "text" && typeof item.text === "string") text.push(item.text);
  }
  return {
    model: typeof candidate.model === "string" ? candidate.model : "",
    thinking: thinking.join("\n"),
    text: text.join("\n"),
    usage: candidate.usage,
  };
}

function truncateThinking(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= TELEGRAM_THINKING_PREVIEW_LIMIT) return trimmed;
  return `…\n${trimmed.slice(-TELEGRAM_THINKING_PREVIEW_LIMIT)}`;
}

function renderStreamBlocks(blocks: StreamBlock[], final: boolean): string {
  const sections = blocks.map((block, index) => {
    if (block.kind === "notice") return block.text;
    if (block.kind === "tool") {
      const duration = formatDuration(block.startedAt, block.finishedAt);
      const nextBlock = blocks[index + 1];
      const previousModel = [...blocks.slice(0, index)].reverse().find(
        (candidate): candidate is ModelStreamBlock => candidate.kind === "model",
      );
      const usage = nextBlock?.kind === "tool" ? "" : formatUsage(previousModel?.usage);
      return [
        `${block.isError ? "✕ " : ""}${block.name}`,
        block.preview,
        block.finishedAt ? duration : `${duration} · running`,
        usage,
      ].filter(Boolean).join("\n");
    }

    const thinking = truncateThinking(block.thinking);
    const nextBlock = blocks[index + 1];
    const usage = nextBlock?.kind === "tool" ? "" : formatUsage(block.usage);
    let section = `${block.model}\n\n${thinking ? `Thinking\n${thinking}` : `Thinking${block.active && !final ? "…" : ""}`}`;
    if (block.text) section += `\n\n${block.text}`;
    if (usage) section += `\n\n${usage}`;
    return section;
  });
  return sections.filter(Boolean).join("\n\n").trim() || "Pi\n\nThinking…";
}

function fitLiveMessage(text: string): string {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) return text;
  const headLength = 1_250;
  const marker = "\n\n… live output truncated …\n\n";
  const tailLength = TELEGRAM_MESSAGE_LIMIT - headLength - marker.length;
  return `${text.slice(0, headLength)}${marker}${text.slice(-tailLength)}`;
}

class TelegramLiveMessage {
  private pendingText: string | null = null;
  private lastText = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly token: string,
    private readonly chatId: string,
    private readonly messageId: number,
  ) {}

  update(text: string): void {
    this.pendingText = fitLiveMessage(text);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.queuePendingEdit();
    }, TELEGRAM_LIVE_EDIT_INTERVAL_MS);
  }

  async finish(text: string): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingText = null;
    await this.inFlight;

    const parts = splitTelegramMessage(text);
    if (parts.length === 0) return;
    await this.edit(parts[0]);
    for (const part of parts.slice(1)) {
      await telegramApi(this.token, "sendMessage", {
        chat_id: this.chatId,
        text: part,
        link_preview_options: { is_disabled: true },
      });
    }
  }

  private queuePendingEdit(): void {
    const text = this.pendingText;
    this.pendingText = null;
    if (!text || text === this.lastText) return;
    this.inFlight = this.inFlight
      .then(() => this.edit(text))
      .catch((error) => {
        console.error("[pi-web] Telegram live edit failed:", error instanceof Error ? error.message : error);
      })
      .finally(() => {
        if (this.pendingText && !this.timer) {
          this.timer = setTimeout(() => {
            this.timer = null;
            this.queuePendingEdit();
          }, TELEGRAM_LIVE_EDIT_INTERVAL_MS);
        }
      });
  }

  private async edit(text: string): Promise<void> {
    if (!text || text === this.lastText) return;
    try {
      await telegramApi(this.token, "editMessageText", {
        chat_id: this.chatId,
        message_id: this.messageId,
        text,
        link_preview_options: { is_disabled: true },
      });
      this.lastText = text;
    } catch (error) {
      if (error instanceof Error && error.message.includes("message is not modified")) {
        this.lastText = text;
        return;
      }
      throw error;
    }
  }
}

class TelegramPromptStream {
  private readonly blocks: StreamBlock[] = [];
  private currentModel: ModelStreamBlock | null = null;

  constructor(
    private readonly liveMessage: TelegramLiveMessage,
    private readonly fallbackModel: string,
  ) {}

  handle(event: AgentEvent): void {
    switch (event.type) {
      case "message_start":
        this.beginOrUpdateModel(event.message);
        break;
      case "message_update":
        this.beginOrUpdateModel(event.message);
        break;
      case "message_end":
        this.beginOrUpdateModel(event.message);
        if (this.currentModel) this.currentModel.active = false;
        this.currentModel = null;
        break;
      case "tool_execution_start":
        this.blocks.push({
          kind: "tool",
          id: String(event.toolCallId ?? ""),
          name: String(event.toolName ?? "tool"),
          preview: previewToolArgs(event.args),
          startedAt: Date.now(),
        });
        break;
      case "tool_execution_end": {
        const id = String(event.toolCallId ?? "");
        const tool = [...this.blocks].reverse().find(
          (block): block is ToolStreamBlock => block.kind === "tool" && block.id === id,
        );
        if (tool) {
          tool.finishedAt = Date.now();
          tool.isError = event.isError === true;
        }
        break;
      }
      case "auto_retry_start":
        this.blocks.push({
          kind: "notice",
          text: `Retry ${String(event.attempt ?? "")}/${String(event.maxAttempts ?? "")}\n${String(event.errorMessage ?? "")}`.trim(),
        });
        break;
      case "compaction_start":
      case "auto_compaction_start":
        this.blocks.push({ kind: "notice", text: "Compacting context…" });
        break;
    }
    this.liveMessage.update(renderStreamBlocks(this.blocks, false));
  }

  async finish(): Promise<void> {
    if (this.currentModel) this.currentModel.active = false;
    await this.liveMessage.finish(renderStreamBlocks(this.blocks, true));
  }

  ensureFinalAnswer(answer: string): void {
    const trimmed = answer.trim();
    if (!trimmed) return;
    const lastModel = [...this.blocks].reverse().find(
      (block): block is ModelStreamBlock => block.kind === "model",
    );
    if (lastModel?.text.trim()) return;
    if (lastModel) {
      lastModel.text = trimmed;
      lastModel.active = false;
      return;
    }
    this.blocks.push({
      kind: "model",
      model: formatModelName(this.fallbackModel),
      thinking: "",
      text: trimmed,
      active: false,
    });
  }

  addError(message: string): void {
    this.blocks.push({ kind: "notice", text: `Pi bridge error\n${message}` });
  }

  private beginOrUpdateModel(message: unknown): void {
    const snapshot = readAssistantSnapshot(message);
    if (!snapshot) return;
    if (!this.currentModel) {
      this.currentModel = {
        kind: "model",
        model: formatModelName(snapshot.model || this.fallbackModel),
        thinking: "",
        text: "",
        active: true,
      };
      this.blocks.push(this.currentModel);
    }
    this.currentModel.model = formatModelName(snapshot.model || this.fallbackModel);
    this.currentModel.thinking = snapshot.thinking;
    this.currentModel.text = snapshot.text;
    this.currentModel.usage = snapshot.usage;
  }
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
  private respondingChats = new Map<string, number>();

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
    try {
      await telegramApi(config.token, "setMyCommands", {
        commands: [
          { command: "new", description: "Start a fresh Pi session" },
          { command: "status", description: "Show the linked session" },
          { command: "model", description: "Show the active model" },
          { command: "stats", description: "Show token and cost totals" },
          { command: "stop", description: "Abort the current run" },
          { command: "help", description: "Show bridge commands" },
        ],
      }, signal);
    } catch (error) {
      if (!signal.aborted) {
        console.warn("[pi-web] failed to register Telegram bot commands:", error instanceof Error ? error.message : error);
      }
    }
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
    if (!config.allowedChatIds.includes(chatId)) return;
    const text = message.text?.trim() ?? "";
    if (text === "/stop") {
      void this.stopChat(config.token, chatId);
      return;
    }
    const isBridgeCommand = ["/start", "/help", "/new", "/status", "/model", "/stats"].includes(text);
    const createsModelRun = Boolean(text) && !isBridgeCommand;
    if (config.blockWhileRunning && (this.respondingChats.get(chatId) ?? 0) > 0) {
      void this.sendModelBusy(config.token, chatId);
      return;
    }
    if (createsModelRun) {
      this.respondingChats.set(chatId, (this.respondingChats.get(chatId) ?? 0) + 1);
    }
    const previous = this.chatQueues.get(chatId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => this.handleMessage(config, message))
      .catch((error) => {
        console.error(`[pi-web] Telegram chat ${chatId} failed:`, error);
      })
      .finally(() => {
        if (createsModelRun) {
          const remaining = (this.respondingChats.get(chatId) ?? 1) - 1;
          if (remaining > 0) this.respondingChats.set(chatId, remaining);
          else this.respondingChats.delete(chatId);
        }
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
        [
          "Pi Web bridge is ready.",
          "",
          "Send a message to talk to Pi with live Thinking, tool calls, timing, and usage.",
          "/new — start a fresh Pi session",
          "/status — show the linked session",
          "/model — show the active model",
          "/stats — show session token and cost totals",
          "/stop — abort the current run",
        ].join("\n"),
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
    if (text === "/model") {
      const linked = this.state.chats[chatId];
      if (!linked) {
        await this.sendText(config.token, chatId, "No Pi session is linked yet.");
        return;
      }
      const session = await this.getSession(chatId, config.cwd);
      const model = session.inner.model;
      await this.sendText(
        config.token,
        chatId,
        model
          ? `${formatModelName(model.name || model.id)}\n${model.provider}/${model.id}`
          : "No model is selected for this session.",
      );
      return;
    }
    if (text === "/stats") {
      const linked = this.state.chats[chatId];
      if (!linked) {
        await this.sendText(config.token, chatId, "No Pi session is linked yet.");
        return;
      }
      const session = await this.getSession(chatId, config.cwd);
      const stats = await session.send({ type: "get_session_stats" }) as {
        userMessages?: number;
        assistantMessages?: number;
        toolCalls?: number;
        tokens?: {
          input?: number;
          output?: number;
          cacheRead?: number;
          cacheWrite?: number;
          total?: number;
        };
        cost?: number;
      };
      await this.sendText(config.token, chatId, [
        "Session stats",
        `${(stats.userMessages ?? 0).toLocaleString()} user · ${(stats.assistantMessages ?? 0).toLocaleString()} assistant · ${(stats.toolCalls ?? 0).toLocaleString()} tools`,
        `${(stats.tokens?.input ?? 0).toLocaleString()} in · ${(stats.tokens?.output ?? 0).toLocaleString()} out · ${(stats.tokens?.cacheRead ?? 0).toLocaleString()} cache`,
        `${(stats.tokens?.total ?? 0).toLocaleString()} total · $${(stats.cost ?? 0).toFixed(4)}`,
      ].join("\n"));
      return;
    }

    await telegramApi(config.token, "sendChatAction", { chat_id: chatId, action: "typing" });
    let stream: TelegramPromptStream | null = null;
    let typingTimer: ReturnType<typeof setInterval> | null = null;
    try {
      const session = await this.getSession(chatId, config.cwd);
      const selectedModel = session.inner.model;
      const fallbackModel = selectedModel?.name || selectedModel?.id || "Pi";
      const initial = await telegramApi<TelegramSentMessage>(config.token, "sendMessage", {
        chat_id: chatId,
        text: `${formatModelName(fallbackModel)}\n\nThinking…`,
        link_preview_options: { is_disabled: true },
      });
      stream = new TelegramPromptStream(
        new TelegramLiveMessage(config.token, chatId, initial.message_id),
        fallbackModel,
      );
      typingTimer = setInterval(() => {
        void telegramApi(config.token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
      }, 4_000);
      const answer = await this.prompt(session, text, stream);
      stream.ensureFinalAnswer(answer || "Pi completed the request without a text response.");
      await stream.finish();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      if (stream) {
        stream.addError(messageText);
        await stream.finish();
      } else {
        await this.sendText(config.token, chatId, `Pi bridge error: ${messageText}`);
      }
    } finally {
      if (typingTimer) clearInterval(typingTimer);
    }
  }

  private async stopChat(token: string, chatId: string): Promise<void> {
    const linked = this.state.chats[chatId];
    const session = linked ? getRpcSession(linked.sessionId) : undefined;
    if (!session?.isRunning()) {
      await this.sendText(token, chatId, "There is no active Pi run to stop.");
      return;
    }
    await session.send({ type: "abort" });
    await this.sendText(token, chatId, "Stopping the current Pi run.");
  }

  private async sendModelBusy(token: string, chatId: string): Promise<void> {
    const linked = this.state.chats[chatId];
    const session = linked ? getRpcSession(linked.sessionId) : undefined;
    const model = session?.inner.model;
    const modelName = formatModelName(model?.name || model?.id || "Model");
    await this.sendText(
      token,
      chatId,
      `${modelName} is responding.\nWait for it to finish or send /stop to abort the current run.`,
    );
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

  private async prompt(
    session: AgentSessionWrapper,
    message: string,
    stream: TelegramPromptStream,
  ): Promise<string> {
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
        stream.handle(event);
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
