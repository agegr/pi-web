import { checkLoginRateLimit, createSession, recordLoginFailure, verifyPassword } from "../../../../lib/pi-web-auth.ts";
import { authError, loginRateKey, readAuthJson, sessionCookie } from "../../../../lib/pi-web-auth-route.ts";

/** 使用密码创建 web session。
 * @param request 当前 HTTP 请求。
 * @returns 登录结果响应。
 */
export async function POST(request: Request) {
  try {
    const body = await readAuthJson(request);
    if (typeof body.password !== "string") return authError("请求参数无效", 400);
    const key = loginRateKey(request);
    const limit = checkLoginRateLimit(key);
    if (!limit.allowed) return authError("登录尝试过于频繁", 429);
    if (!await verifyPassword(body.password)) {
      recordLoginFailure(key);
      return authError("密码错误", 401);
    }
    const response = Response.json({ success: true });
    response.headers.set("Set-Cookie", sessionCookie(request, createSession()));
    return response;
  } catch (error) {
    const status = (error as { status?: number }).status;
    return authError(status ? (error as Error).message : "登录失败", status ?? 500);
  }
}
