import { checkLoginRateLimit, initializeAuth, recordLoginFailure } from "../../../../lib/pi-web-auth";
import { authError, loginRateKey, readAuthJson } from "../../../../lib/pi-web-auth-route";
import { setTimeout as delay } from "node:timers/promises";

/** Initialize the authentication password with a one-time token.
 * @param request Current HTTP request.
 * @returns Initialization result response.
 */
export async function POST(request: Request) {
  try {
    const body = await readAuthJson(request);
    if (typeof body.token !== "string" || typeof body.password !== "string" || typeof body.confirmPassword !== "string") return authError("AUTH_INVALID_PARAMETERS", "Invalid request parameters", 400);
    if (body.password !== body.confirmPassword) return authError("AUTH_PASSWORD_MISMATCH", "Passwords do not match", 400);
    const key = loginRateKey(request);
    const limit = checkLoginRateLimit(key);
    if (!limit.allowed) {
      const response = authError("AUTH_SETUP_RATE_LIMITED", "Too many setup attempts", 429);
      response.headers.set("Retry-After", String(Math.max(1, Math.ceil((limit.retryAfterMs ?? 0) / 1000))));
      return response;
    }
    if (limit.delayMs) await delay(limit.delayMs);
    try {
      await initializeAuth(body.token, body.password);
    } catch (error) {
      if (error instanceof Error && error.message === "Invalid setup token") recordLoginFailure(key);
      throw error;
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    const status = (error as { status?: number }).status;
      if (status) return authError("AUTH_SETUP_FAILED", (error as Error).message, status);
    const message = error instanceof Error ? error.message : "Authentication setup failed";
    if (message === "Invalid password length" || message === "Invalid password format") return authError("AUTH_PASSWORD_INVALID", "Invalid password format", 400);
    if (message.includes("token")) return authError("AUTH_SETUP_TOKEN_INVALID", "Invalid setup token", 401);
    if (message.includes("already")) return authError("AUTH_ALREADY_INITIALIZED", "Authentication is already initialized", 409);
    return authError("AUTH_SETUP_FAILED", "Authentication setup failed", 500);
  }
}
