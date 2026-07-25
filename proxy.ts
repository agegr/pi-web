import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, authIsConfigured, verifySessionToken } from "@/lib/auth";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/session",
  "/manifest.webmanifest",
  "/sw.js",
  "/offline.html",
]);

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname)
    || pathname.startsWith("/icons/")
    || pathname.startsWith("/_next/");
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const authenticated = authIsConfigured()
    && verifySessionToken(request.cookies.get(AUTH_COOKIE_NAME)?.value);
  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
