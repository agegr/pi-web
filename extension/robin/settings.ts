/**
 * Credential and Telegram preference storage for the dashboard settings screen.
 *
 * Server-only. Nothing here may be imported by a client component, and the
 * values themselves must never be sent to the browser — the API returns
 * `describe*()` summaries instead, which say whether a secret is present
 * without disclosing it.
 *
 * ## Why a file and not .env.local
 *
 * Next reads .env only at startup, so a settings screen writing there would do
 * nothing until a restart — which defeats the point of having the screen. These
 * values are read per request instead, so an edit takes effect immediately.
 *
 * ## Precedence
 *
 * The file wins; the environment is a fallback. A value typed into the UI has
 * to override an older `.env.local` entry, otherwise editing appears to do
 * nothing. Where a value is coming from is reported back to the UI so a
 * lingering environment variable is never a silent surprise.
 */
import { chmodSync } from "node:fs";
import { dataPath, readJsonObject, writeJsonObject } from "./paths.ts";

const SECRETS_FILE = "secrets.json";
const DAILY_AGENDA_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export interface DailyAgendaSettings {
  enabled: boolean;
  time: string;
  locale: "en" | "zh";
}

export const DEFAULT_DAILY_AGENDA: DailyAgendaSettings = {
  enabled: false,
  time: "08:00",
  locale: "en",
};

export interface RobinSecrets {
  google?: { clientId?: string; clientSecret?: string };
  telegram?: {
    botToken?: string;
    allowedChatIds?: number[];
    dailyAgenda?: DailyAgendaSettings;
  };
}

export type SecretSource = "file" | "env";

/** What the browser is allowed to know about a secret. */
export interface SecretStatus {
  set: boolean;
  source?: SecretSource;
  /** Last four characters, enough to tell two credentials apart. */
  hint?: string;
  length?: number;
}

function read(): RobinSecrets {
  return readJsonObject<RobinSecrets>(SECRETS_FILE) ?? {};
}

function write(secrets: RobinSecrets): void {
  writeJsonObject(SECRETS_FILE, secrets);
  // Standing credentials for the user's calendar and messaging account; do not
  // leave them group- or world-readable.
  try {
    chmodSync(dataPath(SECRETS_FILE), 0o600);
  } catch {
    // Best effort — a filesystem without POSIX modes is not a reason to fail.
  }
}

export function secretsPath(): string {
  return dataPath(SECRETS_FILE);
}

function pick(fileValue: string | undefined, envValue: string | undefined): {
  value: string | undefined;
  source: SecretSource | undefined;
} {
  const fromFile = fileValue?.trim();
  if (fromFile) return { value: fromFile, source: "file" };
  const fromEnv = envValue?.trim();
  if (fromEnv) return { value: fromEnv, source: "env" };
  return { value: undefined, source: undefined };
}

export function describeSecret(value: string | undefined, source: SecretSource | undefined): SecretStatus {
  if (!value) return { set: false };
  return {
    set: true,
    ...(source ? { source } : {}),
    hint: value.slice(-4),
    length: value.length,
  };
}

/* ---------- Google ---------- */

export function googleCredentials(): { clientId?: string; clientSecret?: string } {
  const secrets = read();
  return {
    clientId: pick(secrets.google?.clientId, process.env.ROBIN_GOOGLE_CLIENT_ID).value,
    clientSecret: pick(secrets.google?.clientSecret, process.env.ROBIN_GOOGLE_CLIENT_SECRET).value,
  };
}

export function describeGoogle(): { clientId: SecretStatus; clientSecret: SecretStatus } {
  const secrets = read();
  const id = pick(secrets.google?.clientId, process.env.ROBIN_GOOGLE_CLIENT_ID);
  const secret = pick(secrets.google?.clientSecret, process.env.ROBIN_GOOGLE_CLIENT_SECRET);
  return {
    clientId: describeSecret(id.value, id.source),
    clientSecret: describeSecret(secret.value, secret.source),
  };
}

export function setGoogleCredentials(clientId: string, clientSecret: string): void {
  const secrets = read();
  write({ ...secrets, google: { clientId: clientId.trim(), clientSecret: clientSecret.trim() } });
}

export function clearGoogleCredentials(): void {
  const secrets = read();
  const { google: _dropped, ...rest } = secrets;
  void _dropped;
  write(rest);
}

/* ---------- Telegram ---------- */

export function telegramSettings(): {
  botToken?: string;
  allowedChatIds: number[];
  dailyAgenda: DailyAgendaSettings;
} {
  const secrets = read();
  const token = pick(secrets.telegram?.botToken, process.env.TELEGRAM_BOT_TOKEN);
  const fileIds = secrets.telegram?.allowedChatIds;
  const storedAgenda = secrets.telegram?.dailyAgenda;
  const dailyAgenda = storedAgenda
    ? {
        enabled: storedAgenda.enabled === true,
        time: DAILY_AGENDA_TIME.test(storedAgenda.time)
          ? storedAgenda.time
          : DEFAULT_DAILY_AGENDA.time,
        locale: storedAgenda.locale === "zh" ? "zh" as const : "en" as const,
      }
    : { ...DEFAULT_DAILY_AGENDA };
  return {
    botToken: token.value,
    allowedChatIds: Array.isArray(fileIds) && fileIds.length > 0
      ? fileIds
      : parseChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
    dailyAgenda,
  };
}

/** Chat ids and reminder settings are not secret, so they are returned in full. */
export function describeTelegram(): {
  botToken: SecretStatus;
  allowedChatIds: number[];
  dailyAgenda: DailyAgendaSettings;
} {
  const secrets = read();
  const token = pick(secrets.telegram?.botToken, process.env.TELEGRAM_BOT_TOKEN);
  const settings = telegramSettings();
  return {
    botToken: describeSecret(token.value, token.source),
    allowedChatIds: settings.allowedChatIds,
    dailyAgenda: settings.dailyAgenda,
  };
}

export function setTelegramToken(botToken: string): void {
  const secrets = read();
  write({ ...secrets, telegram: { ...secrets.telegram, botToken: botToken.trim() } });
}

export function setTelegramChatIds(allowedChatIds: number[]): void {
  const secrets = read();
  write({ ...secrets, telegram: { ...secrets.telegram, allowedChatIds } });
}

export function setDailyAgenda(dailyAgenda: DailyAgendaSettings): void {
  if (!DAILY_AGENDA_TIME.test(dailyAgenda.time)) {
    throw new Error("Daily agenda time must be HH:MM");
  }
  if (dailyAgenda.locale !== "en" && dailyAgenda.locale !== "zh") {
    throw new Error("Daily agenda language must be en or zh");
  }
  const secrets = read();
  write({ ...secrets, telegram: { ...secrets.telegram, dailyAgenda } });
}

export function clearTelegram(): void {
  const secrets = read();
  const { telegram: _dropped, ...rest } = secrets;
  void _dropped;
  write(rest);
}

/** Accepts "123, -456" and rejects anything that is not a whole number. */
export function parseChatIds(raw: string | undefined): number[] {
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
