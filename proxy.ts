import { NextResponse, type NextRequest } from "next/server";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import {
  isValidBasicAuthorization,
  isWebPasswordEnabled,
} from "@/lib/web-auth";
import { getDownloadSecret, verifyDownloadToken } from "@/lib/download-auth";

/**
 * A download request carrying a valid signed token may skip Basic auth.
 *
 * Wrapper apps (e.g. Pake) replay download URLs through their own HTTP client
 * and do not carry the page's cached Basic credentials; rejecting those
 * requests would break every file download inside the wrapper. Instead the URL
 * carries a short-lived signed token (bound to the path, ~5 min TTL) issued by
 * the download-token endpoint. Valid tokens pass through to the file route;
 * missing/invalid tokens still fall through to the regular Basic check.
 */
function isSignedDownloadRequest(request: NextRequest): boolean {
  const { pathname, searchParams } = request.nextUrl;
  if (!pathname.startsWith("/api/files/")) return false;
  if (searchParams.get("type") !== "download") return false;

  const token = searchParams.get("dt");
  if (!token) return false;
  return verifyDownloadToken(getDownloadSecret(), pathname, token);
}

/**
 * True when the request is a download-shaped request that carries a `dt` token
 * which fails verification (distinguished from plain unauthenticated 401s).
 *
 * @param request - the current request
 * @returns true when the request looks like a download and carries an invalid token
 */
function isInvalidDownloadTokenRequest(request: NextRequest): boolean {
  const { pathname, searchParams } = request.nextUrl;
  if (!pathname.startsWith("/api/files/")) return false;
  if (searchParams.get("type") !== "download") return false;
  const token = searchParams.get("dt");
  if (!token) return false;
  return !verifyDownloadToken(getDownloadSecret(), pathname, token);
}

export function proxy(request: NextRequest) {
  const isApiRequest =
    request.nextUrl.pathname === "/api" ||
    request.nextUrl.pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403 });
    }
    return NextResponse.json(
      { error: "Untrusted API request" },
      { status: 403 },
    );
  }

  // Download requests with an invalid token get an explicit 403 (vs. 401 for
  // unauthenticated requests).
  if (isInvalidDownloadTokenRequest(request)) {
    return NextResponse.json(
      { error: "Invalid download token" },
      { status: 403 },
    );
  }

  // Download requests with a valid signed token pass through without Basic
  // (checked after the host/origin checks).
  if (isSignedDownloadRequest(request)) {
    return NextResponse.next();
  }

  const password = process.env.PI_WEB_PASSWORD;
  if (
    isWebPasswordEnabled(password) &&
    !isValidBasicAuthorization(request.headers.get("authorization"), password)
  ) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
      },
    });
  }

  return NextResponse.next();
}

export const config = { matcher: ["/", "/api/:path*"] };
