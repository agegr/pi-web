import { createHash } from "crypto";
import { NextResponse } from "next/server";

const PASS = process.env.PI_WEB_PASS?.trim();
const COOKIE_NAME = "pi_web_auth";

function tokenFor(pass: string) {
  return createHash("sha256").update(`pi-web-auth:${pass}`).digest("hex");
}

export async function POST(req: Request) {
  if (!PASS) {
    return NextResponse.json({ error: "Password protection is not enabled" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password : "";

  if (!password || password !== PASS) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, tokenFor(PASS), {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
