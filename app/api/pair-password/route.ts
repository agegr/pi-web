import { NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { getActivePassword, hasRuntimePasswordFile, isPasswordFromEnv } from "@/lib/runtime-password";

export const dynamic = "force-dynamic";

/**
 * Status endpoint for the desktop's "Pair device" modal. By default it
 * returns only metadata; the plaintext password is only included when the
 * caller passes `?reveal=1` AND clears the same-origin / sec-fetch-site
 * checks. This keeps a malicious page or rogue extension from trivially
 * exfiltrating the runtime password via a passive fetch.
 *
 * To get the actual password, the in-app UI calls this endpoint with
 * `?reveal=1` from a same-origin request that originated in the operator's
 * browser.
 */
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const url = new URL(req.url);
  const reveal = url.searchParams.get("reveal") === "1";
  const present = hasRuntimePasswordFile() || isPasswordFromEnv();
  if (!reveal) {
    return NextResponse.json({
      present,
      source: isPasswordFromEnv() ? "env" : "runtime",
      regeneratable: !isPasswordFromEnv(),
    });
  }
  const password = getActivePassword();
  return NextResponse.json({
    present: true,
    password,
    source: isPasswordFromEnv() ? "env" : "runtime",
    regeneratable: !isPasswordFromEnv(),
  });
}
