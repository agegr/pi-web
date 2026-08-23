import { NextResponse } from "next/server";
import {
  clearGoogleCredentials,
  clearTelegram,
  describeGoogle,
  describeTelegram,
  parseChatIds,
  secretsPath,
  setDailyAgenda,
  setGmailDigest,
  setGoogleCredentials,
  setJobDigest,
  setReminders,
  setTelegramChatIds,
  setTelegramToken,
  setTranscription,
  telegramSettings,
} from "@/extension/robin/settings";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function guard(req: Request, requireJson: boolean): NextResponse | null {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (requireJson && !hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}

function fail(error: unknown, status = 400): NextResponse {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

/**
 * Report configuration state — never the secrets themselves.
 *
 * `describeGoogle` / `describeTelegram` return presence, origin and a
 * four-character tail. A secret that is never sent cannot leak through the
 * browser's memory, devtools, or a saved HAR.
 */
export async function GET(req: Request) {
  const blocked = guard(req, false);
  if (blocked) return blocked;
  try {
    return NextResponse.json({
      google: describeGoogle(),
      telegram: describeTelegram(),
      storedAt: secretsPath(),
      googleRedirectUri: new URL("/api/robin/google/callback", new URL(req.url).origin).toString(),
    });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as {
      section?: unknown;
      clientId?: unknown;
      clientSecret?: unknown;
      botToken?: unknown;
      chatIds?: unknown;
      dailyAgenda?: unknown;
      jobDigest?: unknown;
      gmailDigest?: unknown;
      reminders?: unknown;
      transcription?: unknown;
    };

    if (body.section === "google") {
      const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
      const clientSecret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";
      if (!clientId || !clientSecret) {
        return fail(new Error("Both the client ID and the client secret are required"));
      }
      setGoogleCredentials(clientId, clientSecret);
      return NextResponse.json({ google: describeGoogle() });
    }

    if (body.section === "telegram") {
      // The token and the chat list are edited separately, so an empty field
      // means "leave alone" rather than "clear" — clearing is its own action.
      if (typeof body.botToken === "string" && body.botToken.trim()) {
        setTelegramToken(body.botToken);
      }
      if (typeof body.chatIds === "string") {
        setTelegramChatIds(parseChatIds(body.chatIds));
      }
      if (typeof body.dailyAgenda === "object" && body.dailyAgenda !== null) {
        const agenda = body.dailyAgenda as Record<string, unknown>;
        setDailyAgenda({
          enabled: agenda.enabled === true,
          time: typeof agenda.time === "string" ? agenda.time : "",
          locale: agenda.locale === "zh" ? "zh" : "en",
        });
      }
      if (typeof body.jobDigest === "object" && body.jobDigest !== null) {
        const digest = body.jobDigest as Record<string, unknown>;
        setJobDigest({
          enabled: digest.enabled === true,
          morning: typeof digest.morning === "string" ? digest.morning : "",
          evening: typeof digest.evening === "string" ? digest.evening : "",
          count: Number(digest.count),
          locale: digest.locale === "zh" ? "zh" : "en",
          chatIds: typeof digest.chatIds === "string"
            ? parseChatIds(digest.chatIds)
            : Array.isArray(digest.chatIds)
              ? digest.chatIds.filter((id): id is number => Number.isInteger(id))
              : [],
          sweepAt: typeof digest.sweepAt === "string" ? digest.sweepAt : "",
        });
      }
      if (typeof body.gmailDigest === "object" && body.gmailDigest !== null) {
        const digest = body.gmailDigest as Record<string, unknown>;
        setGmailDigest({
          enabled: digest.enabled === true,
          time: typeof digest.time === "string" ? digest.time : "",
          locale: digest.locale === "zh" ? "zh" : "en",
          chatIds: typeof digest.chatIds === "string"
            ? parseChatIds(digest.chatIds)
            : Array.isArray(digest.chatIds)
              ? digest.chatIds.filter((id): id is number => Number.isInteger(id))
              : [],
          query: typeof digest.query === "string" ? digest.query.trim() : "",
        });
      }
      if (typeof body.reminders === "object" && body.reminders !== null) {
        const reminders = body.reminders as Record<string, unknown>;
        setReminders({
          enabled: reminders.enabled === true,
          lead: Number(reminders.lead),
          locale: reminders.locale === "zh" ? "zh" : "en",
          chatIds: typeof reminders.chatIds === "string"
            ? parseChatIds(reminders.chatIds)
            : Array.isArray(reminders.chatIds)
              ? reminders.chatIds.filter((id): id is number => Number.isInteger(id))
              : [],
        });
      }
      if (typeof body.transcription === "object" && body.transcription !== null) {
        const transcription = body.transcription as Record<string, unknown>;
        // An absent key means "leave the stored one alone", matching how the
        // bot token behaves; an empty string is an explicit clear.
        const apiKey = typeof transcription.apiKey === "string" ? transcription.apiKey : undefined;
        setTranscription(
          {
            enabled: transcription.enabled === true,
            baseUrl: typeof transcription.baseUrl === "string" ? transcription.baseUrl : "",
            model: typeof transcription.model === "string" ? transcription.model : "",
          },
          apiKey,
        );
      }
      return NextResponse.json({ telegram: describeTelegram() });
    }

    return fail(new Error('section must be "google" or "telegram"'));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { section?: unknown };
    if (body.section === "google") {
      clearGoogleCredentials();
      return NextResponse.json({ google: describeGoogle() });
    }
    if (body.section === "telegram") {
      clearTelegram();
      return NextResponse.json({ telegram: describeTelegram() });
    }
    return fail(new Error('section must be "google" or "telegram"'));
  } catch (error) {
    return fail(error);
  }
}

/**
 * One-shot chat-id discovery: ask Telegram for pending updates and report the
 * chats they came from.
 *
 * Deliberately sent without an `offset`, so it reads the backlog without
 * acknowledging it and does not consume messages the bridge still needs.
 */
export async function PUT(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { action?: unknown };
    if (body.action !== "detectChatIds") return fail(new Error("Unsupported action"));

    const { botToken } = telegramSettings();
    if (!botToken) return fail(new Error("Save a bot token first"));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let payload: { ok?: boolean; result?: unknown[]; description?: string };
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timeout: 0,
          allowed_updates: ["message", "channel_post", "my_chat_member"],
        }),
      });
      payload = await response.json() as typeof payload;
      if (!response.ok || !payload.ok) {
        return fail(new Error(payload.description ?? `Telegram returned HTTP ${response.status}`));
      }
    } finally {
      clearTimeout(timer);
    }

    const seen = new Map<number, string>();
    for (const raw of payload.result ?? []) {
      // A private chat arrives as `message`; a channel the bot was just added
      // to arrives as `my_chat_member`, and a channel it can post in as
      // `channel_post`. Reading only `message` is why adding the bot to a
      // channel used to detect nothing.
      const update = raw as {
        message?: { chat?: { id?: unknown; title?: unknown }; from?: { username?: unknown; first_name?: unknown } };
        channel_post?: { chat?: { id?: unknown; title?: unknown } };
        my_chat_member?: { chat?: { id?: unknown; title?: unknown; type?: unknown } };
      };
      const source = update.message ?? update.channel_post ?? update.my_chat_member;
      const id = source?.chat?.id;
      if (typeof id !== "number") continue;
      const from = (update.message as { from?: { username?: unknown; first_name?: unknown } } | undefined)?.from;
      seen.set(id, String(
        source?.chat?.title ?? from?.username ?? from?.first_name ?? "unknown",
      ));
    }

    return NextResponse.json({
      chats: [...seen].map(([id, name]) => ({ id, name })),
    });
  } catch (error) {
    return fail(error);
  }
}
