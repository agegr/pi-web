/**
 * Cursor PKCE OAuth：生成校验参数、打开浏览器、轮询令牌并负责刷新。
 * 协议参考 @offbynan/pi-cursor-provider、oh-my-pi 与 opencode-cursor（MIT）。
 */

const CURSOR_LOGIN_URL = "https://cursor.com/loginDeepControl";
const CURSOR_POLL_URL = "https://api2.cursor.sh/auth/poll";
const CURSOR_REFRESH_URL = "https://api2.cursor.sh/auth/exchange_user_api_key";

const POLL_MAX_ATTEMPTS = 150;
const POLL_BASE_DELAY = 1000;
const POLL_MAX_DELAY = 10_000;
const POLL_BACKOFF_MULTIPLIER = 1.2;
const POLL_REQUEST_TIMEOUT_MS = 15_000;

// ── PKCE ──

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(96);
  crypto.getRandomValues(verifierBytes);
  const verifier = Buffer.from(verifierBytes).toString("base64url");

  const data = new TextEncoder().encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const challenge = Buffer.from(hashBuffer).toString("base64url");

  return { verifier, challenge };
}

// ── 登录参数 ──

export interface CursorAuthParams {
  verifier: string;
  challenge: string;
  uuid: string;
  loginUrl: string;
}

export async function generateCursorAuthParams(): Promise<CursorAuthParams> {
  const { verifier, challenge } = await generatePKCE();
  const uuid = crypto.randomUUID();

  const params = new URLSearchParams({
    challenge,
    uuid,
    mode: "login",
    redirectTarget: "cli",
  });

  const loginUrl = `${CURSOR_LOGIN_URL}?${params.toString()}`;
  return { verifier, challenge, uuid, loginUrl };
}

// ── 轮询授权结果 ──

const CANCEL_MESSAGE = "Login cancelled";

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(CANCEL_MESSAGE));
      return;
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error(CANCEL_MESSAGE));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pollCursorAuth(
  uuid: string,
  verifier: string,
  signal?: AbortSignal,
  options: { requestTimeoutMs?: number; initialDelayMs?: number } = {},
): Promise<{ accessToken: string; refreshToken: string }> {
  let delay = options.initialDelayMs ?? POLL_BASE_DELAY;
  let consecutiveErrors = 0;

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await abortableSleep(delay, signal);

    try {
      const timeoutSignal = AbortSignal.timeout(
        options.requestTimeoutMs ?? POLL_REQUEST_TIMEOUT_MS,
      );
      const response = await fetch(
        `${CURSOR_POLL_URL}?uuid=${encodeURIComponent(uuid)}&verifier=${encodeURIComponent(verifier)}`,
        { signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal },
      );

      if (response.status === 404) {
        consecutiveErrors = 0;
        delay = Math.min(delay * POLL_BACKOFF_MULTIPLIER, POLL_MAX_DELAY);
        continue;
      }

      if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 410) {
        throw new Error(`Cursor login was rejected (HTTP ${response.status})`);
      }

      if (response.ok) {
        const data = (await response.json()) as {
          accessToken?: string;
          refreshToken?: string;
        };
        if (!data.accessToken || !data.refreshToken) {
          throw new Error("Cursor login returned an incomplete token response");
        }
        return {
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        };
      }

      throw new Error(`Poll failed: ${response.status}`);
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.message === CANCEL_MESSAGE)) {
        throw new Error(CANCEL_MESSAGE);
      }
      if (err instanceof Error && err.message.startsWith("Cursor login was rejected")) {
        throw err;
      }
      consecutiveErrors++;
      if (consecutiveErrors >= 3) {
        throw new Error(
          `Too many consecutive errors during Cursor auth polling: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  throw new Error("Cursor authentication polling timeout");
}

// ── 刷新令牌 ──

export interface CursorCredentials {
  access: string;
  refresh: string;
  expires: number;
  [key: string]: unknown;
}

export async function refreshCursorToken(
  refreshToken: string,
  signal?: AbortSignal,
): Promise<CursorCredentials> {
  const response = await fetch(CURSOR_REFRESH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${refreshToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    signal,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cursor token refresh failed: ${error}`);
  }

  const data = (await response.json()) as {
    accessToken: string;
    refreshToken: string;
  };

  return {
    access: data.accessToken,
    refresh: data.refreshToken || refreshToken,
    expires: getTokenExpiry(data.accessToken),
  };
}

// ── 读取 JWT 过期时间 ──

export function getTokenExpiry(token: string): number {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) {
      return Date.now() + 3600 * 1000;
    }
    const decoded = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (
      decoded &&
      typeof decoded === "object" &&
      typeof decoded.exp === "number"
    ) {
      return decoded.exp * 1000 - 5 * 60 * 1000;
    }
  } catch {}
  return Date.now() + 3600 * 1000;
}
