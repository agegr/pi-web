import { initializeAuth } from "../../../../lib/pi-web-auth";
import { authError, readAuthJson } from "../../../../lib/pi-web-auth-route";

/** 使用一次性 token 初始化认证密码。
 * @param request 当前 HTTP 请求。
 * @returns 初始化结果响应。
 */
export async function POST(request: Request) {
  try {
    const body = await readAuthJson(request);
    if (typeof body.token !== "string" || typeof body.password !== "string" || typeof body.confirmPassword !== "string") return authError("请求参数无效", 400);
    if (body.password !== body.confirmPassword) return authError("两次密码不一致", 400);
    await initializeAuth(body.token, body.password);
    return new Response(null, { status: 204 });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) return authError((error as Error).message, status);
    const message = error instanceof Error ? error.message : "认证初始化失败";
    return authError(message.includes("token") ? "初始化 token 无效" : message.includes("已经") ? "认证已经初始化" : "认证初始化失败", message.includes("token") ? 401 : message.includes("已经") ? 409 : 500);
  }
}
