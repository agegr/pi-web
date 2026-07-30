import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

async function loadSubject() {
  return jiti.import("./request-security.ts");
}

function localRequest(pathname, init = {}) {
  return new Request(`http://localhost:30141${pathname}`, {
    ...init,
    headers: { host: "localhost:30141", ...init.headers },
  });
}

test("allows same-origin and non-browser API requests", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  assert.equal(isApiRequestAllowed(new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://localhost:30141",
      "sec-fetch-site": "same-origin",
    },
  })), true);
  assert.equal(isApiRequestAllowed(new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: { host: "localhost:30141" },
  })), true);
});

test("allows LAN same-origin requests when Next.js uses an internal localhost URL", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const request = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "192.168.32.7:30141",
      origin: "http://192.168.32.7:30141",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestAllowed(request), true);
});

test("allows IPv6 and an explicitly configured hostname", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const ipv6 = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "[::1]:30141",
      origin: "http://[::1]:30141",
      "sec-fetch-site": "same-origin",
    },
  });
  const configured = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "pi-web.internal:30141",
      origin: "http://pi-web.internal:30141",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestAllowed(ipv6), true);
  assert.equal(isApiRequestAllowed(configured, ["pi-web.internal"]), true);
});

test("uses the public Host header when Next internal URL differs", async () => {
  const { isApiRequestOriginAllowed } = await loadSubject();
  assert.equal(isApiRequestOriginAllowed(new Request("http://localhost:30141/api/auth/setup", {
    method: "POST",
    headers: {
      host: "100.99.251.117:30141",
      origin: "http://100.99.251.117:30141",
      "sec-fetch-site": "same-origin",
    },
  })), true);
});

test("does not trust spoofed proxy headers unless a trusted proxy is configured", async () => {
  const { loginRateKey } = await jiti.import("./pi-web-auth-route.ts");
  const original = process.env.PI_WEB_TRUSTED_PROXY;
  delete process.env.PI_WEB_TRUSTED_PROXY;
  try {
    const first = new Request("http://localhost:30141/api/auth/login", { headers: { "x-forwarded-for": "203.0.113.1" } });
    const second = new Request("http://localhost:30141/api/auth/login", { headers: { "x-forwarded-for": "203.0.113.2" } });
    assert.equal(loginRateKey(first), "anonymous");
    assert.equal(loginRateKey(second), "anonymous");
  } finally {
    if (original === undefined) delete process.env.PI_WEB_TRUSTED_PROXY;
    else process.env.PI_WEB_TRUSTED_PROXY = original;
  }
});

test("parses proxy source only when PI_WEB_TRUSTED_PROXY is explicitly enabled", async () => {
  const { loginRateKey } = await jiti.import("./pi-web-auth-route.ts");
  const original = process.env.PI_WEB_TRUSTED_PROXY;
  process.env.PI_WEB_TRUSTED_PROXY = "true";
  try {
    assert.equal(loginRateKey(new Request("http://localhost:30141/api/auth/login", {
      headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" },
    })), "203.0.113.1");
  } finally {
    if (original === undefined) delete process.env.PI_WEB_TRUSTED_PROXY;
    else process.env.PI_WEB_TRUSTED_PROXY = original;
  }
});

test("rejects cross-origin browser API requests", async () => {
  const { isApiRequestAllowed, shouldCheckApiRequestOrigin } = await loadSubject();
  const post = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
  });
  const crossSiteGet = new Request("http://localhost:30141/api/sessions", {
    headers: { host: "localhost:30141", "sec-fetch-site": "cross-site" },
  });
  assert.equal(shouldCheckApiRequestOrigin(post), true);
  assert.equal(isApiRequestAllowed(post), false);
  assert.equal(shouldCheckApiRequestOrigin(crossSiteGet), true);
  assert.equal(isApiRequestAllowed(crossSiteGet), false);
});

test("allows only user-initiated session export document navigations from a PWA", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const navigationHeaders = {
    host: "127.0.0.1:30141",
    "sec-fetch-site": "cross-site",
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
    "sec-fetch-user": "?1",
  };

  assert.equal(isApiRequestAllowed(new Request(
    "http://127.0.0.1:30141/api/sessions/session-id/export?inline=1",
    { headers: navigationHeaders },
  )), true);
  assert.equal(isApiRequestAllowed(new Request(
    "http://127.0.0.1:30141/api/sessions",
    { headers: navigationHeaders },
  )), false);
  assert.equal(isApiRequestAllowed(new Request(
    "http://127.0.0.1:30141/api/sessions/session-id/export?inline=1",
    { headers: { ...navigationHeaders, "sec-fetch-dest": "empty" } },
  )), false);
  assert.equal(isApiRequestAllowed(new Request(
    "http://127.0.0.1:30141/api/sessions/session-id/export?inline=1",
    {
      headers: {
        ...navigationHeaders,
        "sec-fetch-user": "",
      },
    },
  )), false);
  assert.equal(isApiRequestAllowed(new Request(
    "http://127.0.0.1:30141/api/sessions/session-id/export?inline=1",
    { method: "POST", headers: navigationHeaders },
  )), false);
  assert.equal(isApiRequestAllowed(new Request(
    "http://127.0.0.1:30141/api/sessions/session-id/export?inline=1",
    { headers: { ...navigationHeaders, host: "attacker.example:30141" } },
  )), false);
});

test("rejects an origin that does not match the external request host", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const request = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "192.168.32.7:30141",
      origin: "http://attacker.example",
      "sec-fetch-site": "same-site",
    },
  });
  assert.equal(isApiRequestAllowed(request), false);
});

test("rejects DNS rebinding even when browser headers say same-origin", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const request = new Request("http://localhost:30141/api/skills/install", {
    method: "POST",
    headers: {
      host: "attacker.example:30141",
      origin: "http://attacker.example:30141",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
  });
  assert.equal(isApiRequestAllowed(request), false);
});

test("rejects missing, malformed, and unconfigured Host headers", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  assert.equal(isApiRequestAllowed(new Request("http://localhost:30141/api/test")), false);
  assert.equal(isApiRequestAllowed(new Request("http://localhost:30141/api/test", {
    headers: { host: "localhost@attacker.example:30141" },
  })), false);
  assert.equal(isApiRequestAllowed(new Request("http://localhost:30141/api/test", {
    headers: { host: "pi-web.internal:30141" },
  })), false);
});

test("recognizes JSON request content types", async () => {
  const { hasJsonContentType } = await loadSubject();
  assert.equal(hasJsonContentType(new Request("http://localhost", {
    headers: { "content-type": "application/json; charset=utf-8" },
  })), true);
  assert.equal(hasJsonContentType(new Request("http://localhost", {
    headers: { "content-type": "application/problem+json" },
  })), true);
  assert.equal(hasJsonContentType(new Request("http://localhost", {
    headers: { "content-type": "text/plain" },
  })), false);
});

test("proxy keeps only Pi Web auth APIs public and protects Pi provider OAuth", async () => {
  const { getRequestAccess } = await loadSubject();
  const publicPaths = [
    "/login", "/setup", "/api/auth/status", "/api/auth/setup", "/api/auth/login",
    "/_next/static/chunk.js", "/_next/image", "/favicon.ico",
  ];
  for (const path of publicPaths) {
    assert.deepEqual(getRequestAccess(localRequest(path)), { type: "public" }, path);
  }
  assert.deepEqual(getRequestAccess(localRequest("/api/auth/login/anthropic")), { type: "unauthorized" });
});

test("public auth pages are rendered directly instead of rewritten to the protected home page", async () => {
  const { proxy } = await jiti.import("../proxy.ts");

  for (const pathname of ["/login", "/setup"]) {
    const response = await proxy(new Request(`http://localhost:30141${pathname}`));
    assert.equal(response.headers.has("x-middleware-rewrite"), false, pathname);
  }
});

test("proxy protects auth management APIs without a session", async () => {
  const { getRequestAccess } = await loadSubject();
  const protectedPaths = [
    "/api/auth/api-key/openai",
    "/api/auth/providers",
    "/api/auth/all-providers",
    "/api/auth/logout",
    "/api/auth/logout/openai",
    "/api/auth/password",
  ];
  for (const path of protectedPaths) {
    assert.deepEqual(getRequestAccess(localRequest(path)), { type: "unauthorized" }, path);
  }
  assert.deepEqual(getRequestAccess(localRequest("/api/auth/login/anthropic/callback")), { type: "unauthorized" });
});

test("proxy applies CSRF checks before public auth API routing", async () => {
  const { getRequestAccess } = await loadSubject();
  const paths = ["/api/auth/status", "/api/auth/setup", "/api/auth/login", "/api/auth/login/anthropic"];
  for (const path of paths) {
    const request = localRequest(path, {
      method: "POST",
      headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    });
    assert.deepEqual(getRequestAccess(request), { type: "forbidden" }, path);
  }
});

test("proxy redirects unauthenticated pages and rejects unauthenticated API and SSE", async () => {
  const { getRequestAccess } = await loadSubject();
  assert.deepEqual(getRequestAccess(localRequest("/")), { type: "redirect" });

  assert.deepEqual(getRequestAccess(localRequest("/api/sessions")), { type: "unauthorized" });

  assert.deepEqual(getRequestAccess(localRequest("/api/agent/running/events", {
    headers: { accept: "text/event-stream" },
  })), { type: "unauthorized" });
});

test("proxy allows a valid cookie but still rejects cross-origin API requests", async () => {
  const { getRequestAccess } = await loadSubject();
  const { createSession } = await jiti.import("./pi-web-auth.ts");
  const cookie = `pi_web_session=${createSession()}`;

  assert.deepEqual(getRequestAccess(localRequest("/", { headers: { cookie } })), { type: "allow" });

  assert.deepEqual(getRequestAccess(localRequest("/api/sessions", {
    headers: { cookie, origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  })), { type: "forbidden" });
});
