import { getSession } from "./pi-web-auth";

const MAX_BODY_BYTES = 16 * 1024;
const COOKIE_NAME = "pi_web_session";

/** Validate JSON request headers for authentication mutations without a body.
 * @param request Current HTTP request.
 * @returns Nothing when validation succeeds.
 * @throws Throws an error with a status when Content-Type or the declared body size is invalid.
 */
export function validateAuthJsonHeaders(request: Request): void {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw Object.assign(new Error("Content-Type must be application/json"), { status: 415 });
  }
}

/** Return a consistently formatted API error response.
 * @param errorCode Stable error code exposed to clients.
 * @param message Non-sensitive error message for legacy clients.
 * @param status HTTP status code.
 * @returns JSON error response.
 */
export function authError(errorCode: string, message: string, status: number): Response {
  return Response.json({ errorCode, error: message }, { status });
}

/** Read and validate an authentication API JSON request body.
 * @param request Current HTTP request.
 * @param options Whether a missing or empty body is allowed.
 * @returns Parsed JSON value.
 * @throws Throws an error with a status when the request is not JSON or the body exceeds the limit.
 */
export async function readAuthJson(request: Request, options: { allowEmpty?: boolean } = {}): Promise<Record<string, unknown>> {
  const hasBody = request.body !== null;
  if (!hasBody && options.allowEmpty) return {};
  validateAuthJsonHeaders(request);
  const reader = request.body?.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          await reader.cancel();
          throw Object.assign(new Error("Request body is too large"), { status: 413 });
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const text = new TextDecoder().decode(concatChunks(chunks, bytes));
  if (!text.trim() && options.allowEmpty) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("Invalid request body format"), { status: 400 });
  }
  return parsed as Record<string, unknown>;
}

/** Merge read request-body chunks without allocating an unbounded buffer upfront.
 * @param chunks Request-body chunks.
 * @param byteLength Total number of bytes read.
 * @returns Merged request-body bytes.
 */
function concatChunks(chunks: Uint8Array[], byteLength: number): Uint8Array {
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Extract the session token from the request cookie.
 * @param request Current HTTP request.
 * @returns Raw session token, or null when missing.
 */
export function getSessionToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)pi_web_session=([^;]*)/);
  return match?.[1] || null;
}

/** Validate the authentication session for the current request.
 * @param request Current HTTP request.
 * @returns Session token and validation result.
 */
export function getAuthenticatedSession(request: Request): { token: string; valid: boolean } {
  const token = getSessionToken(request);
  return { token: token ?? "", valid: token ? getSession(token).valid : false };
}

/** Generate the authentication session cookie.
 * @param request Current HTTP request.
 * @param token Cookie value; null clears the cookie.
 * @returns Set-Cookie header value.
 */
export function sessionCookie(request: Request, token: string | null): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const age = token ? "86400" : "0";
  const value = token ?? "";
  return `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${secure}`;
}

/** Compute the source key for login rate limiting without treating proxy headers as identity.
 * @param request Current HTTP request.
 * @returns Rate-limit bucket key.
 */
export function loginRateKey(request: Request): string {
  if (process.env.PI_WEB_TRUSTED_PROXY === "true") {
    return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
      || request.headers.get("x-real-ip")?.trim()
      || "anonymous";
  }
  return "anonymous";
}
