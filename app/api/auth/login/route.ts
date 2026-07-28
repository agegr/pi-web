import { authenticateAndCreateSession, beginLoginAttempt, finishLoginAttempt } from "../../../../lib/pi-web-auth";
import { authError, loginRateKey, readAuthJson, sessionCookie } from "../../../../lib/pi-web-auth-route";
import { setTimeout as delay } from "node:timers/promises";

/** Create a web session with a password.
 * @param request Current HTTP request.
 * @returns Login result response.
 */
export async function POST(request: Request) {
  try {
    const body = await readAuthJson(request);
    if (typeof body.password !== "string") return authError("AUTH_INVALID_PARAMETERS", "Invalid request parameters", 400);
    const key = loginRateKey(request);
    const limit = beginLoginAttempt(key);
    if (!limit.allowed) {
      const response = authError("AUTH_LOGIN_RATE_LIMITED", "Too many login attempts", 429);
      response.headers.set("Retry-After", String(Math.ceil((limit.retryAfterMs ?? 0) / 1000)));
      return response;
    }
    let credentialFailed = false;
    try {
      if (limit.delayMs) await delay(limit.delayMs);
      const sessionToken = await authenticateAndCreateSession(body.password);
      if (!sessionToken) {
        credentialFailed = true;
        return authError("AUTH_LOGIN_FAILED", "Login failed", 401);
      }
      const response = Response.json({ success: true });
      response.headers.set("Set-Cookie", sessionCookie(request, sessionToken));
      return response;
    } finally {
      finishLoginAttempt(key, credentialFailed);
    }
  } catch (error) {
    const status = (error as { status?: number }).status;
    return authError("AUTH_LOGIN_FAILED", status ? (error as Error).message : "Login failed", status ?? 500);
  }
}
