import { getAuthState } from "../../../../lib/pi-web-auth.ts";
import { getAuthenticatedSession } from "../../../../lib/pi-web-auth-route.ts";

/** 返回认证初始化状态和当前 session 状态。
 * @param request 当前 HTTP 请求。
 * @returns 认证状态 JSON 响应。
 */
export async function GET(request: Request) {
  try {
    const state = await getAuthState();
    return Response.json({ initialized: state.initialized, authenticated: state.initialized && getAuthenticatedSession(request).valid });
  } catch {
    return Response.json({ error: "认证状态读取失败" }, { status: 500 });
  }
}
