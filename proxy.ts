import { NextResponse, type NextRequest } from "next/server";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import {
  PI_WEB_SESSION_COOKIE,
  isValidWebAuth,
  isWebPasswordEnabled,
} from "@/lib/web-auth";

function isSafeInternalPath(path: string | null | undefined): boolean {
  if (!path || typeof path !== "string") return false;
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.includes("\\") &&
    !path.includes("\0")
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApiRequest = pathname === "/api" || pathname.startsWith("/api/");
  const isLoginPage = pathname === "/login";
  const isAuthApi = pathname.startsWith("/api/auth/web/");

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

  const password = process.env.PI_WEB_PASSWORD;
  const passwordEnabled = isWebPasswordEnabled(password);

  // If password is not enabled:
  if (!passwordEnabled) {
    // If someone visits /login when password is not set, redirect to home /
    if (isLoginPage) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  // Allow web auth endpoints without prior auth
  if (isAuthApi) {
    return NextResponse.next();
  }

  const authorization = request.headers.get("authorization");
  const cookieToken = request.cookies.get(PI_WEB_SESSION_COOKIE)?.value;
  const isAuthenticated = isValidWebAuth(authorization, cookieToken, password);

  if (!isAuthenticated) {
    if (isLoginPage) {
      return NextResponse.next();
    }

    if (isApiRequest) {
      return NextResponse.json(
        { error: "Authentication required" },
        {
          status: 401,
          headers: {
            "Cache-Control": "no-store",
            "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
          },
        },
      );
    }

    // For web page navigation, redirect to /login
    const loginUrl = new URL("/login", request.url);
    const targetPathWithQuery = pathname + request.nextUrl.search;
    if (targetPathWithQuery && targetPathWithQuery !== "/") {
      loginUrl.searchParams.set("redirect", targetPathWithQuery);
    }
    return NextResponse.redirect(loginUrl);
  }

  // If user is already authenticated and visits /login, redirect to target or home /
  if (isLoginPage) {
    const redirectParam = request.nextUrl.searchParams.get("redirect");
    const redirectUrl = isSafeInternalPath(redirectParam)
      ? new URL(redirectParam!, request.url)
      : new URL("/", request.url);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|offline.html|sw.js).*)",
  ],
};
