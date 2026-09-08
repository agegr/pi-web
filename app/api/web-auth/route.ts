import { NextRequest, NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  createWebSessionToken,
  isValidBasicAuthorization,
  isValidWebPassword,
  isValidWebSessionToken,
  isWebPasswordEnabled,
  PI_WEB_SESSION_COOKIE,
  PI_WEB_SESSION_MAX_AGE,
} from "@/lib/web-auth";

export const dynamic = "force-dynamic";

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:"
    || request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() === "https";
}

function clearSessionCookie(response: NextResponse, request: Request): void {
  response.cookies.set({
    name: PI_WEB_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: 0,
  });
}

export async function GET(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const password = process.env.PI_WEB_PASSWORD;
  const enabled = isWebPasswordEnabled(password);
  const authenticated = !enabled
    || isValidBasicAuthorization(request.headers.get("authorization"), password)
    || isValidWebSessionToken(request.cookies.get(PI_WEB_SESSION_COOKIE)?.value, password);
  return NextResponse.json(
    { enabled, authenticated },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  const password = process.env.PI_WEB_PASSWORD;
  if (!isWebPasswordEnabled(password)) {
    return NextResponse.json({ error: "Password authentication is disabled" }, { status: 404 });
  }

  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  if (!body || typeof body.password !== "string" || !isValidWebPassword(body.password, password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: PI_WEB_SESSION_COOKIE,
    value: createWebSessionToken(password),
    httpOnly: true,
    sameSite: "strict",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: PI_WEB_SESSION_MAX_AGE,
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response, request);
  return response;
}
