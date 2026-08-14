import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getActivePassword } from "@/lib/runtime-password";

export const dynamic = "force-dynamic";

/**
 * Read the hostname the QR code should encode. Tries, in order:
 *   1. `PI_WEB_HOSTNAME` env var (operator passed `-H <host>`)
 *   2. `.pi-web-hostname` file (written by the launcher)
 *   3. `0.0.0.0` is rejected because the phone can't dial it. We fall back to
 *      `127.0.0.1` for that case so the user gets a working code instead of
 *      a broken one — they can read the address from the modal and copy it.
 */
function readBoundHostname(): string {
  const fromEnv = process.env.PI_WEB_HOSTNAME?.trim();
  if (fromEnv && fromEnv !== "0.0.0.0") return fromEnv;
  try {
    const path = join(process.cwd(), ".pi-web-hostname");
    if (existsSync(path)) {
      const value = readFileSync(path, "utf8").trim();
      if (value && value !== "0.0.0.0") return value;
    }
  } catch {
    /* ignore */
  }
  return "127.0.0.1";
}

/**
 * Information the desktop's "Connect Phone" modal needs to render a QR code
 * the phone can scan.
 *
 * Hostname priority:
 *   1. `PI_WEB_HOSTNAME` env var — the address the server is *bound to*.
 *      This is what the phone must dial, regardless of how the desktop
 *      browser reached the server.
 *   2. Request `Host` header — only used as a last resort if the operator
 *      has no configured hostname (e.g. fresh dev mode on loopback).
 */
export async function GET() {
  const configured = readBoundHostname();
  const port = process.env.PORT?.trim() || "30141";
  // Auth is required iff a password is in play — either explicit env var
  // or the runtime-generated one. We don't want to leak the *existence* of
  // the password here (that's what /api/pair-password is for), just whether
  // the phone will be prompted at all.
  const authRequired = getActivePassword().length > 0;

  // The QR must encode the address the *phone* can reach, regardless of how
  // the desktop browser got to the modal. PI_WEB_HOSTNAME wins because
  // that's what the server is bound to and therefore what the phone must
  // dial. Loopback / unspecified is only acceptable when the operator
  // hasn't bound a specific address — they get a clear warning.
  if (configured) {
    return NextResponse.json({
      url: `http://${configured}:${port}/`,
      hostname: configured,
      port,
      authRequired,
      username: "pi",
    });
  }

  return NextResponse.json({
    url: `http://127.0.0.1:${port}/`,
    hostname: "127.0.0.1",
    port,
    authRequired,
    username: "pi",
    warning: "Server has no bound hostname; QR encodes loopback. Pass PI_WEB_HOSTNAME or -H tailscale for cross-device access.",
  });
}

function unused() {
  // The earlier heuristic (existence-of-file) was unreliable because the
  // file is only written when the password is first needed. The actual
  // check is `getActivePassword().length > 0` above, which both reports
  // truth and forces creation so the proxy and modal see the same value.
}