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
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

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

/**
 * The twice-daily job push.
 *
 * Two send times rather than an interval: a job digest is something you read
 * over coffee and again after work, and a posting that appeared at 11am is no
 * more urgent for arriving at 11:05. Each slot claims its own batch, so the
 * evening push never repeats the morning's.
 */
export interface JobDigestSettings {
  enabled: boolean;
  morning: string;
  evening: string;
  /** Jobs per push. */
  count: number;
  locale: "en" | "zh";
  /**
   * Who receives the job digest.
   *
   * Separate from the main allow-list because the two are different
   * conversations: the assistant chat is where you talk to Robin, and the job
   * feed is a stream you skim and tap. Mixing them buries one in the other.
   * Empty falls back to the main allow-list, so an existing setup keeps working.
   */
  chatIds: number[];
  /**
   * When to walk the whole ATS directory, once a day.
   *
   * It rides in the bridge rather than a launchd agent of its own because the
   * bridge is already a supervised always-on process on this machine — a
   * second daemon to run one job a night is a second thing to keep alive.
   * Empty disables it.
   */
  sweepAt: string;
}

export const DEFAULT_JOB_DIGEST: JobDigestSettings = {
  enabled: false,
  morning: "08:00",
  evening: "20:00",
  count: 10,
  locale: "en",
  chatIds: [],
  // Before the morning digest, and late enough that the boards have settled.
  sweepAt: "03:00",
};

/**
 * The once-a-day email check.
 *
 * One send time, not two: unlike jobs — which you read over coffee and again
 * after work — important mail (OA, interviews, deliveries, deadlines) is
 * exactly the kind of thing that should surface once and then sit in the
 * conversation where you can ask about it.
 */
export interface GmailDigestSettings {
  enabled: boolean;
  time: string;
  locale: "en" | "zh";
  /** Who receives it; empty falls back to the main allow-list, like the job feed. */
  chatIds: number[];
  /** Gmail search query for the window the agent reviews. */
  query: string;
}

export const DEFAULT_GMAIL_DIGEST: GmailDigestSettings = {
  enabled: false,
  time: "08:00",
  locale: "en",
  chatIds: [],
  query: "newer_than:1d",
};

export interface RobinSecrets {
  google?: { clientId?: string; clientSecret?: string };
  telegram?: {
    botToken?: string;
    allowedChatIds?: number[];
    dailyAgenda?: DailyAgendaSettings;
    jobDigest?: JobDigestSettings;
    gmailDigest?: GmailDigestSettings;
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

/** Stored values are never trusted raw — an edited file must not crash the bridge. */
function normalizeDailyAgenda(stored: DailyAgendaSettings | undefined): DailyAgendaSettings {
  if (!stored) return { ...DEFAULT_DAILY_AGENDA };
  return {
    enabled: stored.enabled === true,
    time: CLOCK_TIME.test(stored.time) ? stored.time : DEFAULT_DAILY_AGENDA.time,
    locale: stored.locale === "zh" ? "zh" : "en",
  };
}

function normalizeGmailDigest(stored: GmailDigestSettings | undefined): GmailDigestSettings {
  if (!stored) return { ...DEFAULT_GMAIL_DIGEST };
  return {
    enabled: stored.enabled === true,
    time: CLOCK_TIME.test(stored.time) ? stored.time : DEFAULT_GMAIL_DIGEST.time,
    locale: stored.locale === "zh" ? "zh" : "en",
    chatIds: Array.isArray(stored.chatIds)
      ? stored.chatIds.filter((id): id is number => Number.isInteger(id))
      : [],
    query: typeof stored.query === "string" && stored.query.trim()
      ? stored.query.trim()
      : DEFAULT_GMAIL_DIGEST.query,
  };
}

function normalizeJobDigest(stored: JobDigestSettings | undefined): JobDigestSettings {
  if (!stored) return { ...DEFAULT_JOB_DIGEST };
  const count = Number(stored.count);
  return {
    enabled: stored.enabled === true,
    morning: CLOCK_TIME.test(stored.morning) ? stored.morning : DEFAULT_JOB_DIGEST.morning,
    evening: CLOCK_TIME.test(stored.evening) ? stored.evening : DEFAULT_JOB_DIGEST.evening,
    count: Number.isFinite(count) ? Math.min(Math.max(Math.round(count), 1), 50) : DEFAULT_JOB_DIGEST.count,
    locale: stored.locale === "zh" ? "zh" : "en",
    chatIds: Array.isArray(stored.chatIds)
      ? stored.chatIds.filter((id): id is number => Number.isInteger(id))
      : [],
    // An empty string is a real value here — it means "no nightly sweep" — so
    // it has to survive normalisation rather than falling back to the default.
    sweepAt: stored.sweepAt === "" || CLOCK_TIME.test(stored.sweepAt ?? "")
      ? stored.sweepAt ?? DEFAULT_JOB_DIGEST.sweepAt
      : DEFAULT_JOB_DIGEST.sweepAt,
  };
}

export function telegramSettings(): {
  botToken?: string;
  allowedChatIds: number[];
  dailyAgenda: DailyAgendaSettings;
  jobDigest: JobDigestSettings;
  gmailDigest: GmailDigestSettings;
} {
  const secrets = read();
  const token = pick(secrets.telegram?.botToken, process.env.TELEGRAM_BOT_TOKEN);
  const fileIds = secrets.telegram?.allowedChatIds;
  return {
    botToken: token.value,
    allowedChatIds: Array.isArray(fileIds) && fileIds.length > 0
      ? fileIds
      : parseChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
    dailyAgenda: normalizeDailyAgenda(secrets.telegram?.dailyAgenda),
    jobDigest: normalizeJobDigest(secrets.telegram?.jobDigest),
    gmailDigest: normalizeGmailDigest(secrets.telegram?.gmailDigest),
  };
}

/** Chat ids and reminder settings are not secret, so they are returned in full. */
export function describeTelegram(): {
  botToken: SecretStatus;
  allowedChatIds: number[];
  dailyAgenda: DailyAgendaSettings;
  jobDigest: JobDigestSettings;
  gmailDigest: GmailDigestSettings;
} {
  const secrets = read();
  const token = pick(secrets.telegram?.botToken, process.env.TELEGRAM_BOT_TOKEN);
  const settings = telegramSettings();
  return {
    botToken: describeSecret(token.value, token.source),
    allowedChatIds: settings.allowedChatIds,
    dailyAgenda: settings.dailyAgenda,
    jobDigest: settings.jobDigest,
    gmailDigest: settings.gmailDigest,
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
  if (!CLOCK_TIME.test(dailyAgenda.time)) {
    throw new Error("Daily agenda time must be HH:MM");
  }
  if (dailyAgenda.locale !== "en" && dailyAgenda.locale !== "zh") {
    throw new Error("Daily agenda language must be en or zh");
  }
  const secrets = read();
  write({ ...secrets, telegram: { ...secrets.telegram, dailyAgenda } });
}

export function setGmailDigest(gmailDigest: GmailDigestSettings): void {
  if (!CLOCK_TIME.test(gmailDigest.time)) {
    throw new Error("Gmail digest time must be HH:MM");
  }
  if (gmailDigest.locale !== "en" && gmailDigest.locale !== "zh") {
    throw new Error("Gmail digest language must be en or zh");
  }
  const secrets = read();
  write({ ...secrets, telegram: { ...secrets.telegram, gmailDigest } });
}

export function setJobDigest(jobDigest: JobDigestSettings): void {
  if (!CLOCK_TIME.test(jobDigest.morning) || !CLOCK_TIME.test(jobDigest.evening)) {
    throw new Error("Job digest times must be HH:MM");
  }
  if (jobDigest.sweepAt !== "" && !CLOCK_TIME.test(jobDigest.sweepAt)) {
    throw new Error("Sweep time must be HH:MM, or empty to disable it");
  }
  if (jobDigest.locale !== "en" && jobDigest.locale !== "zh") {
    throw new Error("Job digest language must be en or zh");
  }
  if (!Number.isFinite(jobDigest.count) || jobDigest.count < 1 || jobDigest.count > 50) {
    throw new Error("Job digest size must be between 1 and 50");
  }
  const secrets = read();
  write({ ...secrets, telegram: { ...secrets.telegram, jobDigest } });
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
