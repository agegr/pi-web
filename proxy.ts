import { NextResponse, type NextRequest } from "next/server";
import { getRequestAccess } from "@/lib/request-security";
import { getAuthState } from "@/lib/pi-web-auth";

/** Protect pages, business APIs, and SSE while keeping authentication entry points and static assets public.
 * @param request Next.js proxy request.
 * @returns Access-control response.
 */
export async function proxy(request: NextRequest) {
  const access = getRequestAccess(request);
  if (access.type === "public") {
    return NextResponse.next();
  }
  if (access.type === "allow") return NextResponse.next();
  if (access.type === "forbidden") {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (access.type === "unauthorized") return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let destination: "/login" | "/setup" = "/login";
  try {
    if (!(await getAuthState()).initialized) destination = "/setup";
  } catch {
    // Do not treat a corrupt config as uninitialized, or the setup page cannot recover safely.
    destination = "/login";
  }
  return NextResponse.redirect(new URL(destination, request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
