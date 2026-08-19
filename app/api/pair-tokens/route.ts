import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPairToken } from "@/lib/pair-tokens";

export const dynamic = "force-dynamic";

function isFullUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Resolve the base URL the QR code should encode. Prefers the
 * `.pi-web-hostname` file (written by the launcher on every start) — it
 * carries the canonical addressable URL, which may be a full HTTPS URL
 * when `tailscale serve` is configured. `PI_WEB_HOSTNAME` env var is
 * normalized to a bare hostname for the request-security whitelist, so
 * it can't carry a full URL through; we only fall back to it when the
 * file is missing.
 */
function resolveBaseUrl(): string {
  const port = process.env.PORT?.trim() || "30141";
  try {
    const path = join(process.cwd(), ".pi-web-hostname");
    if (existsSync(path)) {
      const raw = readFileSync(path, "utf8").trim();
      if (raw && raw !== "0.0.0.0") {
        if (isFullUrl(raw)) {
          return raw.endsWith("/") ? raw.slice(0, -1) : raw;
        }
        return `http://${raw}:${port}`;
      }
    }
  } catch {
    /* ignore */
  }

  const fromEnv = process.env.PI_WEB_HOSTNAME?.trim();
  if (fromEnv && fromEnv !== "0.0.0.0") {
    return `http://${fromEnv}:${port}`;
  }
  return `http://127.0.0.1:${port}`;
}

/**
 * Generate a one-time pairing token the desktop embeds in the QR code.
 * The token lets the phone reach the server with `/?pair=<token>`,
 * which proxy.ts validates and exchanges for a 30-day session cookie
 * without ever asking the user for a password.
 */
export async function GET() {
  const { token, expiresAt } = createPairToken();
  const url = `${resolveBaseUrl()}/?pair=${encodeURIComponent(token)}`;
  return NextResponse.json({ url, expiresAt });
}