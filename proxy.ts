import { NextResponse, type NextRequest } from "next/server";
import { getRequestAccess } from "@/lib/request-security";
import { getAuthState } from "@/lib/pi-web-auth";

/** 保护页面、业务 API 和 SSE，同时保留认证引导及静态资源公开访问。
 * @param request Next.js proxy 请求。
 * @returns 访问控制响应。
 */
export async function proxy(request: NextRequest) {
  const access = getRequestAccess(request);
  if (access.type === "public") {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/login" || pathname === "/setup") {
      return NextResponse.rewrite(new URL("/", request.url));
    }
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
    // 损坏配置不能伪装成未初始化，否则 setup 页面无法安全恢复。
    destination = "/login";
  }
  return NextResponse.redirect(new URL(destination, request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
