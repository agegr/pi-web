import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPairToken } from "@/lib/pair-tokens";

export const dynamic = "force-dynamic";

/**
 * Generate a one-time pairing token the desktop embeds in the QR code.
 * The token lets the phone reach the server with `/?pair=<token>`,
 * which proxy.ts validates and exchanges for a 30-day session cookie
 * without ever asking the user for a password.
 *
 * The URL the QR encodes uses the same hostname-resolution rules as
 * /api/pair-info: env var wins, then the .pi-web-hostname file, then
 * the request's Host header (last resort — only useful in dev mode
 * without a configured bind address).
 */
export async function GET() {
  const configured = process.env.PI_WEB_HOSTNAME?.trim();
  let host: string | null = null;
  if (configured && configured !== "0.0.0.0") {
    host = configured;
  } else {
    try {
      const path = join(process.cwd(), ".pi-web-hostname");
      if (existsSync(path)) {
        const value = readFileSync(path, "utf8").trim();
        if (value && value !== "0.0.0.0") host = value;
      }
    } catch {
      /* ignore */
    }
  }
  const port = process.env.PORT?.trim() || "30141";
  if (!host) host = "127.0.0.1";

  const { token, expiresAt } = createPairToken();
  const url = `http://${host}:${port}/?pair=${encodeURIComponent(token)}`;
  return NextResponse.json({ url, expiresAt });
}