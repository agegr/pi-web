import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  authIsConfigured,
  authSessionMaxAge,
  createSessionToken,
  initializeAuth,
  verifyPassword,
} from "@/lib/auth";

function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 256;
}

function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function formRedirect(path: string, error?: string): NextResponse {
  const url = new URL(path, "http://localhost");
  if (error) url.searchParams.set("error", error);
  return new NextResponse(null, {
    status: 303,
    headers: { Location: `${url.pathname}${url.search}` },
  });
}

export async function GET() {
  return NextResponse.json({ configured: authIsConfigured() });
}

export async function POST(request: Request) {
  try {
    const isForm = request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")
      || request.headers.get("content-type")?.includes("multipart/form-data");
    const body = isForm
      ? Object.fromEntries(await request.formData()) as { password?: unknown; initialize?: unknown; next?: unknown }
      : await request.json().catch(() => null) as { password?: unknown; initialize?: unknown; next?: unknown } | null;
    const initialize = body?.initialize === true || body?.initialize === "true";

    if (!validPassword(body?.password)) {
      if (isForm) return formRedirect("/login", "密码长度必须为 8 到 256 个字符");
      return NextResponse.json({ error: "密码长度必须为 8 到 256 个字符" }, { status: 400 });
    }

    if (initialize) {
      if (initializeAuth(body.password) === "exists") {
        if (isForm) return formRedirect("/login", "密码已经设置，请直接登录");
        return NextResponse.json({ error: "密码已经设置，请直接登录" }, { status: 409 });
      }
    } else if (!verifyPassword(body.password)) {
      if (isForm) return formRedirect("/login", "密码错误");
      return NextResponse.json({ error: "密码错误" }, { status: 401 });
    }

    const response = isForm
      ? formRedirect(safeNextPath(body?.next))
      : NextResponse.json({ success: true });
    response.cookies.set(AUTH_COOKIE_NAME, createSessionToken(), {
      httpOnly: true,
      // 独立 PWA 从系统桌面启动时属于顶层外部导航，Lax 可携带登录 Cookie。
      sameSite: "lax",
      secure: request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: authSessionMaxAge,
    });
    return response;
  } catch (error) {
    console.error("密码登录失败", error);
    return NextResponse.json({ error: "认证服务异常" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const response = NextResponse.json({ success: true });
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: 0,
  });
  return response;
}
