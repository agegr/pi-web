/**
 * Read-only Gmail access.
 *
 * Server-only. Nothing here writes to Google: messages are listed and fetched
 * per request, the same way the calendar integration never writes events. The
 * OAuth grant is shared with google-calendar.ts — both read-only scopes ride
 * the one refresh token, so there is a single connect flow and a single
 * disconnect for the whole Google surface.
 *
 * Read-only on purpose: this integration cannot send, delete, or modify mail.
 */
import { getAccessToken } from "./google-calendar.ts";

const GMAIL_ENDPOINT = "https://gmail.googleapis.com/gmail/v1";
const REQUEST_TIMEOUT_MS = 10_000;
/** Cap metadata fetches at once so a page of mail does not fan out unbounded. */
const FETCH_CONCURRENCY = 8;

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  /** Arrival time as a UTC ISO instant (Gmail's internalDate). */
  date: string;
  unread: boolean;
  labelIds: string[];
}

interface GmailPayloadPart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPayloadPart[];
}

interface GmailPayload {
  headers?: { name?: string; value?: string }[];
  parts?: GmailPayloadPart[];
  body?: { data?: string };
}

interface GmailApiMessage {
  id?: string;
  threadId?: string;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPayload;
}

async function gmailGet(token: string, path: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${GMAIL_ENDPOINT}${path}`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` },
    });
    const parsed = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const status = response.status;
      const detail = typeof parsed?.error === "object" && parsed?.error
        ? String((parsed.error as { message?: unknown }).message ?? JSON.stringify(parsed.error))
        : `HTTP ${status}`;
      if (status === 403) {
        throw new Error(
          "Gmail access was not granted. Reconnect Google so the read-only Gmail scope is "
          + "included: Settings → Google → Clear, then press Connect in the calendar panel.",
        );
      }
      throw new Error(`Gmail returned ${detail}`);
    }
    return parsed ?? {};
  } finally {
    clearTimeout(timer);
  }
}

function headerValue(payload: GmailPayload | undefined, name: string): string {
  const header = payload?.headers?.find(
    (entry) => (entry.name ?? "").toLowerCase() === name.toLowerCase(),
  );
  return header?.value?.trim() ?? "";
}

function mapMessage(raw: GmailApiMessage): GmailMessage | null {
  if (!raw.id) return null;
  const labelIds = raw.labelIds ?? [];
  return {
    id: raw.id,
    threadId: raw.threadId ?? raw.id,
    from: headerValue(raw.payload, "From"),
    subject: headerValue(raw.payload, "Subject") || "(no subject)",
    snippet: raw.snippet?.trim() ?? "",
    date: raw.internalDate ? new Date(Number(raw.internalDate)).toISOString() : "",
    unread: labelIds.includes("UNREAD"),
    labelIds,
  };
}

/** Run `fn` over `items` with a bounded number of in-flight promises. */
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

export interface ListOptions {
  /** Gmail search query, e.g. "newer_than:7d" or "is:unread". */
  query?: string;
  maxResults?: number;
}

/**
 * The most recent messages matching `query`, newest first.
 *
 * Two calls per page of mail: one list for the ids, then one metadata fetch
 * per id. Metadata is what a from/subject/snippet row needs; the full body is
 * fetched only on demand via {@link getEmail}.
 */
export async function listRecentEmails(options: ListOptions = {}): Promise<GmailMessage[]> {
  const token = await getAccessToken();
  const maxResults = Math.max(1, Math.min(options.maxResults ?? 50, 100));
  const query = options.query?.trim();

  const params = new URLSearchParams({ maxResults: String(maxResults) });
  if (query) params.set("q", query);

  const listing = await gmailGet(token, `/users/me/messages?${params.toString()}`);
  const ids = ((listing.messages as { id?: string }[] | undefined) ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === "string");

  const messages = await mapConcurrent(ids, FETCH_CONCURRENCY, async (id) => {
    const raw = await gmailGet(
      token,
      `/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    );
    return mapMessage(raw as GmailApiMessage);
  });

  return messages.filter((message): message is GmailMessage => message !== null);
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function collectText(part: GmailPayloadPart | undefined, out: { plain?: string; html?: string }): void {
  if (!part) return;
  const mime = part.mimeType ?? "";
  if (mime === "text/plain" && part.body?.data && !out.plain) {
    out.plain = decodeBase64Url(part.body.data);
  } else if (mime === "text/html" && part.body?.data && !out.html) {
    out.html = decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) collectText(child, out);
}

export interface GmailMessageDetail extends GmailMessage {
  /** Best-effort plain-text body: text/plain when present, else stripped HTML. */
  bodyText: string;
}

/**
 * One message with its body, for the agent to actually read what matters.
 *
 * Returns null for a message that no longer exists. The body is a best-effort
 * plain-text extraction — HTML mail is stripped of markup, not rendered.
 */
export async function getEmail(id: string): Promise<GmailMessageDetail | null> {
  const token = await getAccessToken();
  const raw = await gmailGet(token, `/users/me/messages/${encodeURIComponent(id)}?format=full`) as GmailApiMessage;
  const message = mapMessage(raw);
  if (!message) return null;

  const text: { plain?: string; html?: string } = {};
  collectText(raw.payload as GmailPayloadPart | undefined, text);
  const bodyText = (text.plain ?? (text.html ? stripHtml(text.html) : "")).trim();

  return { ...message, bodyText };
}
