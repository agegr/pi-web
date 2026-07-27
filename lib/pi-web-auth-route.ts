import { getSession } from "./pi-web-auth";

const MAX_BODY_BYTES = 16 * 1024;
const COOKIE_NAME = "pi_web_session";

/** 校验 JSON 请求头，供无 body 的认证 mutation 使用。
 * @param request 当前 HTTP 请求。
 * @returns 校验通过时无返回值。
 * @throws Content-Type 或声明 body 大小不符合限制时抛出带 status 的错误。
 */
export function validateAuthJsonHeaders(request: Request): void {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw Object.assign(new Error("Content-Type 必须是 application/json"), { status: 415 });
  }
}

/** 返回统一格式的 API 错误响应。
 * @param errorCode 面向客户端的稳定错误码。
 * @param message 面向旧客户端的非敏感错误信息。
 * @param status HTTP 状态码。
 * @returns JSON 错误响应。
 */
export function authError(errorCode: string, message: string, status: number): Response {
  return Response.json({ errorCode, error: message }, { status });
}

/** 读取并校验认证 API 的 JSON 请求体。
 * @param request 当前 HTTP 请求。
 * @param options 是否允许缺少请求体或空请求体。
 * @returns 解析后的 JSON 值。
 * @throws 请求不是 JSON 或 body 超限时抛出带 status 的错误。
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
          throw Object.assign(new Error("请求体过大"), { status: 413 });
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
    throw Object.assign(new Error("请求体必须是有效 JSON"), { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("请求体格式无效"), { status: 400 });
  }
  return parsed as Record<string, unknown>;
}

/** 合并已读取的请求体分块，避免在读取前分配不受限的缓冲区。
 * @param chunks 请求体分块。
 * @param byteLength 已读取的总字节数。
 * @returns 合并后的请求体字节。
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

/** 从请求 cookie 中提取 session token。
 * @param request 当前 HTTP 请求。
 * @returns 原始 session token，缺失时返回 null。
 */
export function getSessionToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)pi_web_session=([^;]*)/);
  return match?.[1] || null;
}

/** 校验当前请求的认证 session。
 * @param request 当前 HTTP 请求。
 * @returns session token 和校验结果。
 */
export function getAuthenticatedSession(request: Request): { token: string; valid: boolean } {
  const token = getSessionToken(request);
  return { token: token ?? "", valid: token ? getSession(token).valid : false };
}

/** 生成认证 session cookie。
 * @param request 当前 HTTP 请求。
 * @param token cookie 值；传 null 表示清理 cookie。
 * @returns Set-Cookie 响应头值。
 */
export function sessionCookie(request: Request, token: string | null): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const age = token ? "86400" : "0";
  const value = token ?? "";
  return `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${secure}`;
}

/** 计算登录限速使用的来源 key，不把代理头作为认证身份。
 * @param request 当前 HTTP 请求。
 * @returns 限速桶 key。
 */
export function loginRateKey(request: Request): string {
  if (process.env.PI_WEB_TRUSTED_PROXY === "true") {
    return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
      || request.headers.get("x-real-ip")?.trim()
      || "anonymous";
  }
  return "anonymous";
}
