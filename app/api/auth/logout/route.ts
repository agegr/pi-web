import { revokeSession } from "../../../../lib/pi-web-auth.ts";
import { getSessionToken, sessionCookie, validateAuthJsonHeaders } from "../../../../lib/pi-web-auth-route.ts";

/** 清理当前 web session。
 * @param request 当前 HTTP 请求。
 * @returns 登出结果响应。
 */
export async function POST(request: Request) {
  try {
    validateAuthJsonHeaders(request);
    const token = getSessionToken(request);
    if (token) revokeSession(token);
    const response = Response.json({ success: true });
    response.headers.set("Set-Cookie", sessionCookie(request, null));
    return response;
  } catch (error) {
    const status = (error as { status?: number }).status;
    return Response.json({ error: status ? (error as Error).message : "登出失败" }, { status: status ?? 500 });
  }
}
