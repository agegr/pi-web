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

/**
 * Reminders for events that are about to start.
 *
 * Not a digest: the digests answer "what is my day", and this answers "you
 * need to leave now". It runs off the same poll cycle rather than a slot, so
 * `lead` is the only thing to configure.
 */
export interface ReminderSettings {
  enabled: boolean;
  /** Minutes before an event starts. */
  lead: number;
  locale: "en" | "zh";
  /** Empty falls back to the main allow-list, like the other feeds. */
  chatIds: number[];
}

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: false,
  lead: 30,
  locale: "en",
  chatIds: [],
};

/**
 * Speech-to-text for voice notes.
 *
 * Its own key rather than pi's provider auth: pi's logins are OAuth
 * subscriptions resolved inside an extension's tool context, and the bridge is
 * a separate process with no such context. A plain API key is the honest way
 * to say "this costs something and here is what pays for it".
 */
export interface TranscriptionSettings {
  enabled: boolean;
  /** OpenAI-compatible /v1/audio/transcriptions endpoint. */
  baseUrl: string;
  model: string;
}

export const DEFAULT_TRANSCRIPTION: TranscriptionSettings = {
  enabled: false,
  baseUrl: "https://api.openai.com/v1",
  model: "whisper-1",
};

export interface RobinSecrets {
  google?: { clientId?: string; clientSecret?: string };
  telegram?: {
    botToken?: string;
    allowedChatIds?: number[];
    dailyAgenda?: DailyAgendaSettings;
    jobDigest?: JobDigestSettings;
    gmailDigest?: GmailDigestSettings;
    reminders?: ReminderSettings;
    transcription?: TranscriptionSettings;
  };
  transcription?: { apiKey?: string };
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

function normalizeReminders(stored: ReminderSettings | undefined): ReminderSettings {
  if (!stored) return { ...DEFAULT_REMINDERS };
  const lead = Number(stored.lead);
  return {
    enabled: stored.enabled === true,
    // Under five minutes is not a reminder, and over a day is the digest's job.
    lead: Number.isFinite(lead) ? Math.min(Math.max(Math.round(lead), 5), 1440) : DEFAULT_REMINDERS.lead,
    locale: stored.locale === "zh" ? "zh" : "en",
    chatIds: Array.isArray(stored.chatIds)
      ? stored.chatIds.filter((id): id is number => Number.isInteger(id))
      : [],
  };
}

function normalizeTranscription(stored: TranscriptionSettings | undefined): TranscriptionSettings {
  if (!stored) return { ...DEFAULT_TRANSCRIPTION };
  const baseUrl = typeof stored.baseUrl === "string" ? stored.baseUrl.trim().replace(/\/$/, "") : "";
  return {
    enabled: stored.enabled === true,
    // Only http(s): this URL is fetched with an API key attached.
    baseUrl: /^https?:\/\//i.test(baseUrl) ? baseUrl : DEFAULT_TRANSCRIPTION.baseUrl,
    model: typeof stored.model === "string" && stored.model.trim()
      ? stored.model.trim()
      : DEFAULT_TRANSCRIPTION.model,
  };
}

export function telegramSettings(): {
  botToken?: string;
  allowedChatIds: number[];
  dailyAgenda: DailyAgendaSettings;
  jobDigest: JobDigestSettings;
  gmailDigest: GmailDigestSettings;
  reminders: ReminderSettings;
  transcription: TranscriptionSettings & { apiKey?: string };
} {
  const secrets = read();
  const token = pick(secrets.telegram?.botToken, process.env.TELEGRAM_BOT_TOKEN);
  const fileIds = secrets.telegram?.allowedChatIds;
  const transcriptionKey = pick(secrets.transcription?.apiKey, process.env.OPENAI_API_KEY);
  return {
    botToken: token.value,
    allowedChatIds: Array.isArray(fileIds) && fileIds.length > 0
      ? fileIds
      : parseChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
    dailyAgenda: normalizeDailyAgenda(secrets.telegram?.dailyAgenda),
    jobDigest: normalizeJobDigest(secrets.telegram?.jobDigest),
    gmailDigest: normalizeGmailDigest(secrets.telegram?.gmailDigest),
    reminders: normalizeReminders(secrets.telegram?.reminders),
    transcription: {
      ...normalizeTranscription(secrets.telegram?.transcription),
      ...(transcriptionKey.value ? { apiKey: transcriptionKey.value } : {}),
    },
  };
}

/** Chat ids and reminder settings are not secret, so they are returned in full. */
export function describeTelegram(): {
  botToken: SecretStatus;
  allowedChatIds: number[];
  dailyAgenda: DailyAgendaSettings;
  jobDigest: JobDigestSettings;
  gmailDigest: GmailDigestSettings;
  reminders: ReminderSettings;
  transcription: TranscriptionSettings & { apiKey: SecretStatus };
} {
  const secrets = read();
  const token = pick(secrets.telegram?.botToken, process.env.TELEGRAM_BOT_TOKEN);
  const transcriptionKey = pick(secrets.transcription?.apiKey, process.env.OPENAI_API_KEY);
  const settings = telegramSettings();
  // The key itself never crosses back to the browser; only whether it is set.
  const { apiKey: _withheld, ...transcription } = settings.transcription;
  void _withheld;
  return {
    botToken: describeSecret(token.value, token.source),
    allowedChatIds: settings.allowedChatIds,
    dailyAgenda: settings.dailyAgenda,
    jobDigest: settings.jobDigest,
    gmailDigest: settings.gmailDigest,
    reminders: settings.reminders,
    transcription: {
      ...transcription,
      apiKey: describeSecret(transcriptionKey.value, transcriptionKey.source),
    },
  };
}

export function setReminders(reminders: ReminderSettings): void {
  if (!Number.isFinite(reminders.lead) || reminders.lead < 5 || reminders.lead > 1440) {
    throw new Error("Reminder lead time must be between 5 and 1440 minutes");
  }
  if (reminders.locale !== "en" && reminders.locale !== "zh") {
    throw new Error("Reminder language must be en or zh");
  }
  const secrets = read();
  write({ ...secrets, telegram: { ...secrets.telegram, reminders } });
}

export function setTranscription(transcription: TranscriptionSettings, apiKey?: string): void {
  if (!/^https?:\/\//i.test(transcription.baseUrl.trim())) {
    throw new Error("Transcription base URL must be http(s)");
  }
  if (!transcription.model.trim()) throw new Error("Transcription model is required");
  const secrets = read();
  const trimmedKey = apiKey?.trim();
  write({
    ...secrets,
    telegram: {
      ...secrets.telegram,
      transcription: {
        ...transcription,
        baseUrl: transcription.baseUrl.trim().replace(/\/$/, ""),
        model: transcription.model.trim(),
      },
    },
    // An omitted key leaves the stored one alone; an empty string clears it.
    ...(apiKey === undefined
      ? {}
      : trimmedKey
        ? { transcription: { apiKey: trimmedKey } }
        : { transcription: {} }),
  });
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
