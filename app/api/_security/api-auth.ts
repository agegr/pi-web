import { randomBytes, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { getPiWebConfig } from "./pi-web-config";

const COOKIE_NAME = "pi_web_session";
const HEADER_NAME = "x-pi-web-token";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const LOGIN_MAX_FAILURES = 5;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 5 * 60 * 1000;

type LoginAttemptState = {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
};

declare global {
  var __piWebToken: string | undefined;
  var __piWebLoginAttempts: Map<string, LoginAttemptState> | undefined;
}

function getConfiguredToken(): string | null {
  const configured = getPiWebConfig().webToken;
  if (configured) return configured;
  return null;
}

function getToken(): string {
  const configured = getConfiguredToken();
  if (configured) return configured;
  if (!globalThis.__piWebToken) {
    globalThis.__piWebToken = randomBytes(32).toString("base64url");
  }
  return globalThis.__piWebToken;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey !== name) continue;
    try {
      return decodeURIComponent(rawValue.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeHost(value: string | null): string | null {
  if (!value) return null;
  const host = value.trim().toLowerCase();
  if (!host) return null;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }
  if (host === "::1") return host;
  return host.split(":")[0] ?? null;
}

function isRemoteModeEnabled(): boolean {
  return getPiWebConfig().remote;
}

function isLocalHost(hostHeader: string | null): boolean {
  const host = normalizeHost(hostHeader);
  return Boolean(host && LOCAL_HOSTS.has(host));
}

function isTrustedHost(hostHeader: string | null): boolean {
  const host = normalizeHost(hostHeader);
  if (!host) return false;
  if (LOCAL_HOSTS.has(host)) return true;
  if (isRemoteModeEnabled()) return true;
  return false;
}

function isTrustedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const expectedProto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(/:$/, "");
  const expected = `${expectedProto}://${req.headers.get("host") ?? ""}`;
  return originUrl.origin === expected;
}

function authMatches(req: Request): boolean {
  const token = getToken();
  const headerToken = req.headers.get(HEADER_NAME);
  if (headerToken && safeEqual(headerToken, token)) return true;
  const cookieToken = parseCookie(req.headers.get("cookie"), COOKIE_NAME);
  return Boolean(cookieToken && safeEqual(cookieToken, token));
}

function getLoginAttempts(): Map<string, LoginAttemptState> {
  if (!globalThis.__piWebLoginAttempts) {
    globalThis.__piWebLoginAttempts = new Map();
  }
  return globalThis.__piWebLoginAttempts;
}

function loginAttemptKey(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();
  const cfIp = req.headers.get("cf-connecting-ip")?.trim();
  const client = forwardedFor || realIp || cfIp || `direct:${normalizeHost(req.headers.get("host")) ?? "unknown"}`;
  return client.toLowerCase();
}

function pruneExpiredLoginAttempts(now: number): void {
  for (const [key, state] of getLoginAttempts()) {
    if (state.lockedUntil > now) continue;
    if (now - state.firstFailureAt <= LOGIN_FAILURE_WINDOW_MS) continue;
    getLoginAttempts().delete(key);
  }
}

export function isLocalBrowserRequest(req: Request): boolean {
  return isLocalHost(req.headers.get("host"));
}

export function hasConfiguredWebToken(): boolean {
  return Boolean(getConfiguredToken());
}

export function requestHasValidAuth(req: Request): boolean {
  return authMatches(req);
}

export function tokenMatches(value: string): boolean {
  return safeEqual(value, getToken());
}

export function checkLoginRateLimit(req: Request): NextResponse | null {
  const now = Date.now();
  pruneExpiredLoginAttempts(now);

  const state = getLoginAttempts().get(loginAttemptKey(req));
  if (!state || state.lockedUntil <= now) return null;

  const retryAfterSeconds = Math.max(1, Math.ceil((state.lockedUntil - now) / 1000));
  return NextResponse.json(
    { error: "Too many failed login attempts. Try again later.", retryAfterSeconds },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    }
  );
}

export function recordFailedLogin(req: Request): void {
  const now = Date.now();
  pruneExpiredLoginAttempts(now);

  const key = loginAttemptKey(req);
  const current = getLoginAttempts().get(key);
  const shouldContinueWindow = current
    && current.lockedUntil <= now
    && now - current.firstFailureAt <= LOGIN_FAILURE_WINDOW_MS;
  const state: LoginAttemptState = shouldContinueWindow
    ? current
    : { failures: 0, firstFailureAt: now, lockedUntil: 0 };

  state.failures += 1;
  if (state.failures >= LOGIN_MAX_FAILURES) {
    state.lockedUntil = now + LOGIN_LOCK_MS;
  }
  getLoginAttempts().set(key, state);
}

export function recordSuccessfulLogin(req: Request): void {
  getLoginAttempts().delete(loginAttemptKey(req));
}

export function assertTrustedRequest(req: Request): NextResponse | null {
  if (!isTrustedHost(req.headers.get("host"))) {
    return NextResponse.json({ error: "Untrusted host" }, { status: 403 });
  }
  if (!isTrustedOrigin(req)) {
    return NextResponse.json({ error: "Untrusted origin" }, { status: 403 });
  }
  if (!authMatches(req)) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  return null;
}

export function assertTrustedBrowserHost(req: Request): NextResponse | null {
  if (!isTrustedHost(req.headers.get("host"))) {
    return NextResponse.json({ error: "Untrusted host" }, { status: 403 });
  }
  if (!isTrustedOrigin(req)) {
    return NextResponse.json({ error: "Untrusted origin" }, { status: 403 });
  }
  return null;
}

export function attachBrowserSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(COOKIE_NAME, getToken(), {
    httpOnly: true,
    sameSite: "strict",
    secure: getPiWebConfig().cookieSecure,
    path: "/",
  });
  return res;
}
