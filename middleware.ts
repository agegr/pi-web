import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PASS = process.env.PI_WEB_PASS?.trim();
const COOKIE_NAME = "pi_web_auth";

async function tokenFor(pass: string) {
  const data = new TextEncoder().encode(`pi-web-auth:${pass}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!PASS) {
    return NextResponse.next();
  }

  if (pathname === "/login" || pathname.startsWith("/api/unlock")) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  const expected = await tokenFor(PASS);

  if (cookie === expected) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
