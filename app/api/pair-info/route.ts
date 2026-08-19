import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getActivePassword } from "@/lib/runtime-password";

export const dynamic = "force-dynamic";

function isFullUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Resolve the address the *phone* should dial, with the port and hostname
 * broken out for display.
 *
 * Source of truth order:
 *   1. `.pi-web-hostname` file (written by `bin/pi-web.js` on every launch)
 *     — may be a bare host (`100.75.255.47`) or a full URL
 *     (`https://duoji.taildee88d.ts.net`) when `tailscale serve` is set up.
 *     The file carries the canonical addressable URL.
 *   2. `PI_WEB_HOSTNAME` env var — used by `lib/request-security.ts` as a
 *     bare hostname whitelist entry, so it can't carry a full URL through
 *     here. We only consume it as a fallback when the file is missing.
 *   3. `127.0.0.1` — last resort; the modal will surface a warning.
 */
function resolveServiceInfo(): { url: string; hostname: string; port: string } {
  const fallbackPort = process.env.PORT?.trim() || "30141";

  try {
    const path = join(process.cwd(), ".pi-web-hostname");
    if (existsSync(path)) {
      const raw = readFileSync(path, "utf8").trim();
      if (raw && raw !== "0.0.0.0") {
        if (isFullUrl(raw)) {
          // `tailscale serve` (or any HTTPS-terminating proxy in front of
          // us) wrote a full URL. Honor it as-is so the phone gets a
          // secure context — required for Chrome to install this as a
          // real PWA in standalone mode.
          const parsed = new URL(raw);
          const url = raw.endsWith("/") ? raw : `${raw}/`;
          return {
            url,
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === "https:" ? "443" : "80"),
          };
        }
        return {
          url: `http://${raw}:${fallbackPort}/`,
          hostname: raw,
          port: fallbackPort,
        };
      }
    }
  } catch {
    /* ignore */
  }

  const fromEnv = process.env.PI_WEB_HOSTNAME?.trim();
  if (fromEnv && fromEnv !== "0.0.0.0") {
    return {
      url: `http://${fromEnv}:${fallbackPort}/`,
      hostname: fromEnv,
      port: fallbackPort,
    };
  }

  return {
    url: `http://127.0.0.1:${fallbackPort}/`,
    hostname: "127.0.0.1",
    port: fallbackPort,
  };
}

/**
 * Information the desktop's "Connect Phone" modal needs to render a QR code
 * the phone can scan.
 */
export async function GET() {
  // Auth is required iff a password is in play — either explicit env var
  // or the runtime-generated one. We don't want to leak the *existence* of
  // the password here (that's what /api/pair-password is for), just whether
  // the phone will be prompted at all.
  const authRequired = getActivePassword().length > 0;

  const info = resolveServiceInfo();

  // Loopback / unspecified is only acceptable when the operator hasn't
  // bound a specific address — surface a clear warning in that case.
  const response: Record<string, unknown> = {
    url: info.url,
    hostname: info.hostname,
    port: info.port,
    authRequired,
    username: "pi",
  };

  if (info.hostname === "127.0.0.1") {
    response.warning = "Server has no bound hostname; QR encodes loopback. Pass PI_WEB_HOSTNAME or -H tailscale for cross-device access.";
  }

  return NextResponse.json(response);
}

function unused() {
  // The earlier heuristic (existence-of-file) was unreliable because the
  // file is only written when the password is first needed. The actual
  // check is `getActivePassword().length > 0` above, which both reports
  // truth and forces creation so the proxy and modal see the same value.
}