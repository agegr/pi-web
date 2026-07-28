import { revokeSession } from "../../../../lib/pi-web-auth";
import { authError, getSessionToken, readAuthJson, sessionCookie } from "../../../../lib/pi-web-auth-route";

/** Clear the current web session.
 * @param request Current HTTP request.
 * @returns Logout result response.
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
    return authError("AUTH_LOGOUT_FAILED", status ? (error as Error).message : "Logout failed", status ?? 500);
  }
}
