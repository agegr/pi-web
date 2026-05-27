import { NextResponse } from "next/server";
import {
  assertTrustedBrowserHost,
  attachBrowserSessionCookie,
  checkLoginRateLimit,
  hasConfiguredWebToken,
  isLocalBrowserRequest,
  recordFailedLogin,
  recordSuccessfulLogin,
  requestHasValidAuth,
  tokenMatches,
} from "@/app/api/_security/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const blocked = assertTrustedBrowserHost(req);
  if (blocked) return blocked;

  if (requestHasValidAuth(req)) {
    return NextResponse.json({ ok: true });
  }

  if (!isLocalBrowserRequest(req)) {
    return NextResponse.json(
      { error: "WEB_TOKEN required", loginRequired: true },
      { status: 401 }
    );
  }

  return attachBrowserSessionCookie(NextResponse.json({ ok: true }));
}

export async function POST(req: Request) {
  const blocked = assertTrustedBrowserHost(req);
  if (blocked) return blocked;

  if (!hasConfiguredWebToken()) {
    return NextResponse.json(
      { error: "Set WEB_TOKEN before using remote login" },
      { status: 503 }
    );
  }

  const rateLimited = checkLoginRateLimit(req);
  if (rateLimited) return rateLimited;

  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token : "";
  if (!token || !tokenMatches(token)) {
    recordFailedLogin(req);
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  recordSuccessfulLogin(req);
  return attachBrowserSessionCookie(NextResponse.json({ ok: true }));
}
