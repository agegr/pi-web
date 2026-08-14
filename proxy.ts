import { NextResponse, type NextRequest } from "next/server";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
  isLocalRequest,
} from "@/lib/request-security";
import { getActivePassword } from "@/lib/runtime-password";
import { consumePairToken } from "@/lib/pair-tokens";
import {
  attachSessionCookie,
  isValidBasicAuthorization,
  isWebPasswordEnabled,
  readSessionExpiry,
  SESSION_RENEW_BELOW_SECONDS,
  SESSION_TTL_SECONDS,
} from "@/lib/web-auth";

export function proxy(request: NextRequest) {
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403 });
    }
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  // Loopback requests are the operator's own browser on the same machine —
  // they get a free pass, no Basic Auth, no cookie. Only network-originated
  // requests (phone over Tailscale, LAN guests) are prompted for a password.
  if (isLocalRequest(request)) {
    return NextResponse.next();
  }

  // One-time pairing token: when the phone scans the desktop's QR code it
  // lands here with `?pair=<token>`. Consume the token, attach a 30-day
  // session cookie, and redirect to the token-stripped URL. The phone
  // never has to type a password.
  const pairToken = request.nextUrl.searchParams.get("pair");
  if (pairToken) {
    if (consumePairToken(pairToken)) {
      const target = new URL(request.url);
      target.searchParams.delete("pair");
      const response = NextResponse.redirect(target, { status: 302 });
      attachSessionCookie(response, Date.now() + SESSION_TTL_SECONDS * 1000);
      return response;
    }
    // Stale or invalid token — drop it and fall through to auth so the
    // user can recover by typing the password instead of being stuck.
    const target = new URL(request.url);
    target.searchParams.delete("pair");
    return NextResponse.redirect(target, { status: 302 });
  }

  // A valid session cookie is equivalent to a successful Basic Auth — it lets
  // the device skip the password prompt until the cookie expires. We only
  // honor the cookie when a password is configured, so deployments without
  // `PI_WEB_PASSWORD` keep their "open door" behavior.
  const password = getActivePassword();
  if (isWebPasswordEnabled(password)) {
    const sessionExpiry = readSessionExpiry(request.headers.get("cookie"));
    if (sessionExpiry !== null && sessionExpiry > Date.now()) {
      const response = NextResponse.next();
      // Sliding 30-day window: only re-issue when the cookie is close enough
      // to expiry that the response would meaningfully extend it.
      if (sessionExpiry - Date.now() < SESSION_RENEW_BELOW_SECONDS * 1000) {
        attachSessionCookie(response, Date.now() + SESSION_TTL_SECONDS * 1000);
      }
      return response;
    }
  }

  if (
    isWebPasswordEnabled(password)
    && !isValidBasicAuthorization(request.headers.get("authorization"), password)
  ) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
      },
    });
  }

  // First successful Basic Auth of a session — issue the cookie so the
  // browser can present it on subsequent requests.
  if (isWebPasswordEnabled(password)) {
    const response = NextResponse.next();
    attachSessionCookie(response, Date.now() + SESSION_TTL_SECONDS * 1000);
    return response;
  }

  return NextResponse.next();
}

export const config = { matcher: ["/", "/api/:path*"] };