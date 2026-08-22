import { NextResponse, type NextRequest } from "next/server";
import {
  isWebPasswordEnabled,
  isValidSessionToken,
  isValidBasicAuthorization,
  isValidCredential,
  generateSessionToken,
  PI_WEB_AUTH_USERNAME,
  PI_WEB_SESSION_COOKIE,
} from "@/lib/web-auth";

export function GET(request: NextRequest) {
  const password = process.env.PI_WEB_PASSWORD;
  const authRequired = isWebPasswordEnabled(password);

  if (!authRequired) {
    return NextResponse.json({
      authRequired: false,
      authenticated: true,
    });
  }

  const cookieToken = request.cookies.get(PI_WEB_SESSION_COOKIE)?.value;
  const authorization = request.headers.get("authorization");
  const authenticated =
    isValidSessionToken(cookieToken, password) ||
    isValidBasicAuthorization(authorization, password);

  return NextResponse.json({
    authRequired: true,
    authenticated,
  });
}

export async function POST(request: NextRequest) {
  const password = process.env.PI_WEB_PASSWORD;
  const passwordRequired = isWebPasswordEnabled(password);

  if (!passwordRequired) {
    return NextResponse.json({ success: true });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Invalid request payload" },
      { status: 400 },
    );
  }

  const payload = body as Record<string, unknown>;
  const inputUsername =
    typeof payload.username === "string" && payload.username.trim()
      ? payload.username.trim()
      : PI_WEB_AUTH_USERNAME;
  const inputPassword =
    typeof payload.password === "string" ? payload.password : "";

  if (!isValidCredential(inputUsername, inputPassword, password)) {
    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: 401 },
    );
  }

  const token = generateSessionToken(password);
  if (!token) {
    return NextResponse.json(
      { error: "Failed to generate session token" },
      { status: 500 },
    );
  }

  const isHttps =
    request.nextUrl.protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https";

  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: PI_WEB_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  });

  return response;
}
