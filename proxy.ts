import { NextResponse, type NextRequest } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";

export function proxy(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
