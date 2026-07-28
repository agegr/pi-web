import { authenticateAndCreateSession, beginLoginAttempt, finishLoginAttempt } from "../../../../lib/pi-web-auth";
import { authError, loginRateKey, readAuthJson, sessionCookie } from "../../../../lib/pi-web-auth-route";
import { setTimeout as delay } from "node:timers/promises";

/** 使用密码创建 web session。
 * @param request 当前 HTTP 请求。
 * @returns 登录结果响应。
 */
export async function POST(request: Request) {
  try {
    const body = await readAuthJson(request);
    if (typeof body.password !== "string") return authError("AUTH_INVALID_PARAMETERS", "请求参数无效", 400);
    const key = loginRateKey(request);
    const limit = beginLoginAttempt(key);
    if (!limit.allowed) {
      const response = authError("AUTH_LOGIN_RATE_LIMITED", "登录尝试过于频繁", 429);
      response.headers.set("Retry-After", String(Math.ceil((limit.retryAfterMs ?? 0) / 1000)));
      return response;
    }
    let credentialFailed = false;
    try {
      if (limit.delayMs) await delay(limit.delayMs);
      const sessionToken = await authenticateAndCreateSession(body.password);
      if (!sessionToken) {
        credentialFailed = true;
        return authError("AUTH_LOGIN_FAILED", "登录失败", 401);
      }
      const response = Response.json({ success: true });
      response.headers.set("Set-Cookie", sessionCookie(request, sessionToken));
      return response;
    } finally {
      finishLoginAttempt(key, credentialFailed);
    }
  } catch (error) {
    const status = (error as { status?: number }).status;
    return authError("AUTH_LOGIN_FAILED", status ? (error as Error).message : "登录失败", status ?? 500);
  }
}
