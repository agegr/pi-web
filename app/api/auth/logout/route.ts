import { revokeSession } from "../../../../lib/pi-web-auth";
import { authError, getSessionToken, readAuthJson, sessionCookie } from "../../../../lib/pi-web-auth-route";

/** 清理当前 web session。
 * @param request 当前 HTTP 请求。
 * @returns 登出结果响应。
 */
export async function POST(request: Request) {
  try {
    await readAuthJson(request);
    const token = getSessionToken(request);
    if (token) revokeSession(token);
    const response = Response.json({ success: true });
    response.headers.set("Set-Cookie", sessionCookie(request, null));
    return response;
  } catch (error) {
    const status = (error as { status?: number }).status;
    return authError("AUTH_LOGOUT_FAILED", status ? (error as Error).message : "登出失败", status ?? 500);
  }
}
