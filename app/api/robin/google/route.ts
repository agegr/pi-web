import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { authorizeUrl, disconnect, isConnected, readCredentials } from "@/extension/robin/google-calendar";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * The OAuth `state` nonce, held in memory only.
 *
 * globalThis rather than a module constant so it survives Next's dev hot
 * reload, matching how pi-web keeps its own cross-reload state.
 */
const stateStore = ((globalThis as { __robinGoogleStates?: Set<string> }).__robinGoogleStates ??= new Set<string>());

export function issueState(): string {
  const state = randomBytes(16).toString("hex");
  stateStore.add(state);
  // Abandoned attempts should not accumulate.
  setTimeout(() => stateStore.delete(state), 10 * 60_000).unref?.();
  return state;
}

export function consumeState(state: string): boolean {
  return stateStore.delete(state);
}

/** The redirect must match what is registered in the Google client exactly. */
export function redirectUriFor(req: Request): string {
  return new URL("/api/robin/google/callback", new URL(req.url).origin).toString();
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const configured = readCredentials() !== null;
  return NextResponse.json({
    configured,
    connected: configured && isConnected(),
    redirectUri: redirectUriFor(req),
    ...(configured
      ? {}
      : { hint: "Set ROBIN_GOOGLE_CLIENT_ID and ROBIN_GOOGLE_CLIENT_SECRET in .env.local" }),
  });
}

/** Starts the consent flow; the browser follows the returned URL. */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = await req.json() as { action?: unknown };
    if (body.action === "disconnect") {
      disconnect();
      return NextResponse.json({ connected: false });
    }
    if (body.action !== "connect") {
      return NextResponse.json({ error: "action must be connect or disconnect" }, { status: 400 });
    }
    if (!readCredentials()) {
      return NextResponse.json({
        error: "Google client credentials are not configured. "
          + "Set ROBIN_GOOGLE_CLIENT_ID and ROBIN_GOOGLE_CLIENT_SECRET in .env.local and restart.",
      }, { status: 400 });
    }
    return NextResponse.json({ authorizeUrl: authorizeUrl(redirectUriFor(req), issueState()) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
