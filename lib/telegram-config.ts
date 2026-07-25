import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type TelegramBridgeConfig = {
  enabled: boolean;
  token: string;
  allowedChatIds: string[];
  cwd: string;
  blockWhileRunning: boolean;
};

export type TelegramBridgePublicConfig = Omit<TelegramBridgeConfig, "token"> & {
  tokenConfigured: boolean;
  tokenHint: string | null;
};

const DEFAULT_CONFIG: TelegramBridgeConfig = {
  enabled: false,
  token: "",
  allowedChatIds: [],
  cwd: "",
  blockWhileRunning: true,
};

export function normalizeAllowedChatIds(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,]+/)
      : [];

  return [...new Set(values
    .map((entry) => String(entry).trim())
    .filter((entry) => /^-?\d+$/.test(entry)))];
}
export function telegramConfigPath(): string {
  return join(getAgentDir(), "pi-web-telegram.json");
}

export function readTelegramConfig(): TelegramBridgeConfig {
  const path = telegramConfigPath();
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<TelegramBridgeConfig>;
    return {
      enabled: parsed.enabled === true,
      token: typeof parsed.token === "string" ? parsed.token.trim() : "",
      allowedChatIds: normalizeAllowedChatIds(parsed.allowedChatIds),
      cwd: typeof parsed.cwd === "string" ? parsed.cwd.trim() : "",
      blockWhileRunning: parsed.blockWhileRunning !== false,
    };
  } catch (error) {
    console.error("[pi-web] failed to read Telegram bridge config:", error);
    return { ...DEFAULT_CONFIG };
  }
}

export function toPublicTelegramConfig(config: TelegramBridgeConfig): TelegramBridgePublicConfig {
  const token = config.token.trim();
  return {
    enabled: config.enabled,
    allowedChatIds: config.allowedChatIds,
    cwd: config.cwd,
    blockWhileRunning: config.blockWhileRunning,
    tokenConfigured: token.length > 0,
    tokenHint: token ? `••••${token.slice(-6)}` : null,
  };
}

export function validateTelegramConfig(config: TelegramBridgeConfig): string | null {
  if (!config.enabled) return null;
  if (!config.token) return "Bot token is required when the Telegram bridge is enabled.";
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(config.token)) return "Bot token format is invalid.";
  if (config.allowedChatIds.length === 0) return "Add at least one allowed Telegram chat ID.";
  if (!config.cwd) return "Working directory is required when the Telegram bridge is enabled.";
  if (!existsSync(config.cwd)) return `Working directory does not exist: ${config.cwd}`;
  return null;
}

export function writeTelegramConfig(config: TelegramBridgeConfig): void {
  const path = telegramConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(tempPath, path);
}
