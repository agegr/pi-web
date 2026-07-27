import { checkLoginRateLimit, initializeAuth, recordLoginFailure } from "../../../../lib/pi-web-auth";
import { authError, loginRateKey, readAuthJson } from "../../../../lib/pi-web-auth-route";
import { setTimeout as delay } from "node:timers/promises";

/** 使用一次性 token 初始化认证密码。
 * @param request 当前 HTTP 请求。
 * @returns 初始化结果响应。
 */
export async function POST(request: Request) {
  try {
    const body = await readAuthJson(request);
    if (typeof body.token !== "string" || typeof body.password !== "string" || typeof body.confirmPassword !== "string") return authError("AUTH_INVALID_PARAMETERS", "请求参数无效", 400);
    if (body.password !== body.confirmPassword) return authError("AUTH_PASSWORD_MISMATCH", "两次密码不一致", 400);
    const key = loginRateKey(request);
    const limit = checkLoginRateLimit(key);
    if (!limit.allowed) {
      const response = authError("AUTH_SETUP_RATE_LIMITED", "初始化尝试过于频繁", 429);
      response.headers.set("Retry-After", String(Math.max(1, Math.ceil((limit.retryAfterMs ?? 0) / 1000))));
      return response;
    }
    if (limit.delayMs) await delay(limit.delayMs);
    try {
      await initializeAuth(body.token, body.password);
    } catch (error) {
      if (error instanceof Error && error.message === "初始化 token 无效") recordLoginFailure(key);
      throw error;
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    const status = (error as { status?: number }).status;
      if (status) return authError("AUTH_SETUP_FAILED", (error as Error).message, status);
    const message = error instanceof Error ? error.message : "认证初始化失败";
    if (message === "密码长度无效" || message === "密码格式无效") return authError("AUTH_PASSWORD_INVALID", "密码格式无效", 400);
    if (message.includes("token")) return authError("AUTH_SETUP_TOKEN_INVALID", "初始化 token 无效", 401);
    if (message.includes("已经")) return authError("AUTH_ALREADY_INITIALIZED", "认证已经初始化", 409);
    return authError("AUTH_SETUP_FAILED", "认证初始化失败", 500);
  }
}
