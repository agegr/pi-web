/**
 * Read-only Google Calendar access.
 *
 * Server-only. Nothing here is ever written to the Robin store: Google events
 * are fetched per request and merged into the dashboard's view, so the calendar
 * of record stays Google's. Disconnecting removes every trace immediately.
 *
 * ## Credentials
 *
 * The OAuth client is the user's own — this is a personal, locally-run app, so
 * there is no shared client to fall back on. Set in `.env.local`:
 *
 *   ROBIN_GOOGLE_CLIENT_ID=...
 *   ROBIN_GOOGLE_CLIENT_SECRET=...
 *
 * The refresh token lands in ~/.pi/robin/google.json with 0600 permissions.
 * That file is a long-lived credential: treat it like a password.
 */
import { chmodSync } from "node:fs";
import { addDays, localDate } from "./dates.ts";
import type { DashboardEvent } from "./events.ts";
import { dataPath, readJsonObject, writeJsonObject } from "./paths.ts";
import { googleCredentials } from "./settings.ts";

const TOKENS_FILE = "google.json";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CALENDAR_ENDPOINT = "https://www.googleapis.com/calendar/v3";
/** Read-only on purpose: this integration cannot modify the user's calendar. */
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const REQUEST_TIMEOUT_MS = 10_000;

interface StoredTokens {
  refreshToken: string;
  /** Cached only to avoid a refresh round-trip on every request. */
  accessToken?: string;
  accessTokenExpiresAt?: number;
  connectedAt: string;
}

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Read at call time, not at module load: the settings screen writes these and
 * the change has to take effect without restarting the server.
 */
export function readCredentials(): GoogleCredentials | null {
  const { clientId, clientSecret } = googleCredentials();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function readTokens(): StoredTokens | null {
  const stored = readJsonObject<Partial<StoredTokens>>(TOKENS_FILE);
  // A disconnected account leaves an empty object behind, which still parses —
  // the refresh token, not the file, is what "connected" means.
  return stored?.refreshToken ? stored as StoredTokens : null;
}

function writeTokens(tokens: StoredTokens): void {
  writeJsonObject(TOKENS_FILE, tokens);
  // The refresh token is a standing grant on the user's calendar; do not leave
  // it group- or world-readable.
  try {
    chmodSync(dataPath(TOKENS_FILE), 0o600);
  } catch {
    // Best effort — a filesystem without POSIX modes is not a reason to fail.
  }
}

export function isConnected(): boolean {
  return readTokens() !== null;
}

export function disconnect(): void {
  writeJsonObject(TOKENS_FILE, { disconnectedAt: new Date().toISOString() });
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const credentials = readCredentials();
  if (!credentials) throw new Error("Google client credentials are not configured");
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    // A refresh token is only issued with consent + offline access, and Google
    // omits it on repeat grants unless prompted again.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function postForm(url: string, body: URLSearchParams): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const parsed = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const detail = typeof parsed?.error_description === "string"
        ? parsed.error_description
        : typeof parsed?.error === "string" ? parsed.error : `HTTP ${response.status}`;
      throw new Error(`Google rejected the request: ${detail}`);
    }
    return parsed ?? {};
  } finally {
    clearTimeout(timer);
  }
}

export async function exchangeCode(code: string, redirectUri: string): Promise<void> {
  const credentials = readCredentials();
  if (!credentials) throw new Error("Google client credentials are not configured");

  const result = await postForm(TOKEN_ENDPOINT, new URLSearchParams({
    code,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  }));

  const refreshToken = typeof result.refresh_token === "string" ? result.refresh_token : null;
  if (!refreshToken) {
    throw new Error(
      "Google did not return a refresh token. Remove this app's access at "
      + "myaccount.google.com/permissions and connect again.",
    );
  }
  writeTokens({
    refreshToken,
    ...(typeof result.access_token === "string" ? { accessToken: result.access_token } : {}),
    ...(typeof result.expires_in === "number"
      ? { accessTokenExpiresAt: Date.now() + result.expires_in * 1000 }
      : {}),
    connectedAt: new Date().toISOString(),
  });
}

async function accessToken(): Promise<string> {
  const tokens = readTokens();
  if (!tokens?.refreshToken) throw new Error("Google Calendar is not connected");

  // A minute of slack so a token cannot expire mid-request.
  if (tokens.accessToken && (tokens.accessTokenExpiresAt ?? 0) > Date.now() + 60_000) {
    return tokens.accessToken;
  }

  const credentials = readCredentials();
  if (!credentials) throw new Error("Google client credentials are not configured");

  const result = await postForm(TOKEN_ENDPOINT, new URLSearchParams({
    refresh_token: tokens.refreshToken,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: "refresh_token",
  }));

  const fresh = typeof result.access_token === "string" ? result.access_token : null;
  if (!fresh) throw new Error("Google did not return an access token");
  writeTokens({
    ...tokens,
    accessToken: fresh,
    ...(typeof result.expires_in === "number"
      ? { accessTokenExpiresAt: Date.now() + result.expires_in * 1000 }
      : {}),
  });
  return fresh;
}

interface GoogleEventTime {
  /** All-day events carry `date`; timed ones carry a zoned `dateTime`. */
  date?: string;
  dateTime?: string;
}

/**
 * Convert Google's time into the dashboard's floating local model.
 *
 * `dateTime` is a real instant with an offset, so it is resolved through the
 * server's local clock — the same clock the rest of the dashboard renders in.
 * This is lossy by design: a 3pm New York meeting shows as noon here, which is
 * when it actually happens for someone sitting at this machine.
 */
function toLocalParts(time: GoogleEventTime | undefined): { date: string; start?: string } | null {
  if (time?.date) return { date: time.date };
  if (!time?.dateTime) return null;
  const instant = new Date(time.dateTime);
  if (Number.isNaN(instant.getTime())) return null;
  const hours = String(instant.getHours()).padStart(2, "0");
  const minutes = String(instant.getMinutes()).padStart(2, "0");
  return { date: localDate(instant), start: `${hours}:${minutes}` };
}

export interface GoogleEvent {
  id?: string;
  summary?: string;
  location?: string;
  status?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
}

/**
 * Map one Google event into the dashboard's model.
 *
 * Exported for its own tests: this is where Google's zoned instants meet the
 * dashboard's floating local model, so it is the part most worth pinning down.
 * Returns null for events that carry no usable start.
 */
export function mapGoogleEvent(item: GoogleEvent, calendar: string): DashboardEvent | null {
  if (item.status === "cancelled") return null;
  const startParts = toLocalParts(item.start);
  if (!startParts) return null;

  const endParts = toLocalParts(item.end);

  // Google's all-day `end.date` is EXCLUSIVE — a one-day event on the 17th ends
  // on the 18th. Ours is inclusive, so step back a day. Timed events use the
  // instant's own local date, which is already inclusive.
  let endDate: string | undefined;
  if (endParts) {
    const rawEnd = item.end?.date && !item.end.dateTime
      ? addDays(endParts.date, -1)
      : endParts.date;
    if (rawEnd > startParts.date) endDate = rawEnd;
  }

  // Only carry an end time when it lands on the same day; an end that spills
  // into tomorrow would render as an impossible range like 22:00–01:00.
  const end = startParts.start && endParts?.start && endParts.date === startParts.date
    ? endParts.start
    : undefined;

  return {
    id: `google:${item.id ?? crypto.randomUUID()}`,
    title: item.summary?.trim() || "(no title)",
    date: startParts.date,
    ...(endDate ? { endDate } : {}),
    ...(startParts.start ? { start: startParts.start } : {}),
    ...(end ? { end } : {}),
    ...(item.location?.trim() ? { location: item.location.trim() } : {}),
    createdAt: "",
    source: "google",
    calendar,
  };
}

/**
 * Fetch events between two local calendar dates, inclusive.
 *
 * Multi-day events are reported on their start day rather than expanded across
 * the range: the dashboard's event model has a single `date`, and splitting one
 * Google event into several would make it look like several commitments.
 */
export async function fetchEvents(from: string, to: string): Promise<DashboardEvent[]> {
  const token = await accessToken();
  const timeMin = new Date(`${from}T00:00:00`);
  const timeMax = new Date(`${to}T23:59:59`);

  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: "true", // expand recurring events into occurrences
    orderBy: "startTime",
    maxResults: "250",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let payload: { items?: GoogleEvent[]; summary?: string };
  try {
    const response = await fetch(
      `${CALENDAR_ENDPOINT}/calendars/primary/events?${params.toString()}`,
      {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 300 },
      },
    );
    if (!response.ok) {
      throw new Error(`Google Calendar returned HTTP ${response.status}`);
    }
    payload = await response.json() as { items?: GoogleEvent[]; summary?: string };
  } finally {
    clearTimeout(timer);
  }

  const calendar = payload.summary ?? "Google";
  return (payload.items ?? [])
    .map((item) => mapGoogleEvent(item, calendar))
    .filter((event): event is DashboardEvent => event !== null);
}
