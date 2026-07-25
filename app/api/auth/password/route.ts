import { changePassword } from "../../../../lib/pi-web-auth.ts";
import { authError, getAuthenticatedSession, readAuthJson, sessionCookie, validateAuthJsonHeaders } from "../../../../lib/pi-web-auth-route.ts";

/** 修改密码并吊销全部已有 session。
 * @param request 当前 HTTP 请求。
 * @returns 修改结果响应。
 */
export async function POST(request: Request) {
  try {
    validateAuthJsonHeaders(request);
    const session = getAuthenticatedSession(request);
    if (!session.valid) return authError("未认证", 401);
    const body = await readAuthJson(request);
    if (typeof body.currentPassword !== "string" || typeof body.newPassword !== "string" || typeof body.confirmPassword !== "string") return authError("请求参数无效", 400);
    if (body.newPassword !== body.confirmPassword) return authError("两次密码不一致", 400);
    await changePassword(body.currentPassword, body.newPassword);
    const response = Response.json({ success: true });
    response.headers.set("Set-Cookie", sessionCookie(request, null));
    return response;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status) return authError((error as Error).message, status);
    const message = error instanceof Error ? error.message : "密码修改失败";
    return authError(message === "当前密码错误" ? message : "密码修改失败", message === "当前密码错误" ? 401 : 500);
  }
}
