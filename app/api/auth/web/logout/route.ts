import { NextResponse } from "next/server";
import { PI_WEB_SESSION_COOKIE } from "@/lib/web-auth";

export function POST(request: Request) {
  let isHttps = false;
  try {
    const url = new URL(request.url);
    isHttps =
      url.protocol === "https:" ||
      request.headers.get("x-forwarded-proto") === "https";
  } catch {
    isHttps = false;
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: PI_WEB_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
