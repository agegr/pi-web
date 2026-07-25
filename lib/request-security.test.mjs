import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./request-security.ts");
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

test("proxy keeps only required auth APIs and OAuth login public", async () => {
  const { getRequestAccess } = await import("./request-security.ts");
  const publicPaths = [
    "/login", "/setup", "/api/auth/status", "/api/auth/setup", "/api/auth/login",
    "/api/auth/login/anthropic", "/_next/static/chunk.js", "/_next/image", "/favicon.ico",
  ];
  for (const path of publicPaths) {
    assert.deepEqual(getRequestAccess(new Request(`http://localhost:30141${path}`)), { type: "public" }, path);
  }
});

test("proxy protects auth management APIs without a session", async () => {
  const { getRequestAccess } = await import("./request-security.ts");
  const protectedPaths = [
    "/api/auth/api-key/openai",
    "/api/auth/providers",
    "/api/auth/all-providers",
    "/api/auth/logout",
    "/api/auth/logout/openai",
    "/api/auth/password",
  ];
  for (const path of protectedPaths) {
    assert.deepEqual(getRequestAccess(new Request(`http://localhost:30141${path}`)), { type: "unauthorized" }, path);
  }
  assert.deepEqual(getRequestAccess(new Request("http://localhost:30141/api/auth/login/anthropic/callback")), { type: "unauthorized" });
});

test("proxy applies CSRF checks before public auth API routing", async () => {
  const { getRequestAccess } = await import("./request-security.ts");
  const paths = ["/api/auth/status", "/api/auth/setup", "/api/auth/login", "/api/auth/login/anthropic"];
  for (const path of paths) {
    const request = new Request(`http://localhost:30141${path}`, {
      method: "POST",
      headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    });
    assert.deepEqual(getRequestAccess(request), { type: "forbidden" }, path);
  }
});

test("proxy redirects unauthenticated pages and rejects unauthenticated API and SSE", async () => {
  const { getRequestAccess } = await import("./request-security.ts");
  assert.deepEqual(getRequestAccess(new Request("http://localhost:30141/")), { type: "redirect" });

  assert.deepEqual(getRequestAccess(new Request("http://localhost:30141/api/sessions")), { type: "unauthorized" });

  assert.deepEqual(getRequestAccess(new Request("http://localhost:30141/api/agent/running/events", {
    headers: { accept: "text/event-stream" },
  })), { type: "unauthorized" });
});

test("proxy allows a valid cookie but still rejects cross-origin API requests", async () => {
  const { getRequestAccess } = await import("./request-security.ts");
  const { createSession } = await import("./pi-web-auth.ts");
  const cookie = `pi_web_session=${createSession()}`;

  assert.deepEqual(getRequestAccess(new Request("http://localhost:30141/", { headers: { cookie } })), { type: "allow" });

  assert.deepEqual(getRequestAccess(new Request("http://localhost:30141/api/sessions", {
    headers: { cookie, origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  })), { type: "forbidden" });
});
