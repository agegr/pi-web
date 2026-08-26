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

test("does not globally trust opaque iframe or alternate loopback origins", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const previewUrl = "http://localhost:30141/api/files/tmp/test.docx?type=preview";
  const opaqueIframe = new Request(previewUrl, {
    headers: {
      host: "localhost:30141",
      origin: "null",
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "iframe",
    },
  });
  const alternateLoopback = new Request(previewUrl, {
    headers: {
      host: "localhost:30141",
      origin: "http://127.0.0.1:30141",
      "sec-fetch-site": "cross-site",
    },
  });

  assert.equal(isApiRequestAllowed(opaqueIframe), false);
  assert.equal(isApiRequestAllowed(alternateLoopback), false);
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

test("allows same-origin requests when Chromium strips the port from Origin", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  // Loopback IP with the port stripped from Origin (Chromium 150+ behavior).
  const loopback = new Request("http://127.0.0.1:30141/api/agent/running", {
    headers: {
      host: "127.0.0.1:30141",
      origin: "http://127.0.0.1",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestAllowed(loopback), true);

  // LAN IP with the port stripped from Origin.
  const lan = new Request("http://192.168.32.7:30141/api/test", {
    method: "POST",
    headers: {
      host: "192.168.32.7:30141",
      origin: "http://192.168.32.7",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
  });
  assert.equal(isApiRequestAllowed(lan), true);

  // Loopback name with the port stripped from Origin.
  const named = new Request("http://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
  });
  assert.equal(isApiRequestAllowed(named), true);
});

test("still rejects when Origin hostname differs from Host even with port stripped", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  // Cross-loopback-name origin should not slip through just because both
  // sides happen to be loopback addresses.
  const crossName = new Request("http://localhost:30141/api/test", {
    headers: {
      host: "localhost:30141",
      origin: "http://127.0.0.1",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestAllowed(crossName), false);

  // Attacker host matching its own Origin must still be blocked by the
  // Host allowlist, not the Origin comparison.
  const dnsRebind = new Request("http://localhost:30141/api/skills/install", {
    method: "POST",
    headers: {
      host: "attacker.example:30141",
      origin: "http://attacker.example",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
  });
  assert.equal(isApiRequestAllowed(dnsRebind), false);
});

test("rejects cross-port CSRF when Origin includes a mismatched port", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  // Attacker host on a sibling port. The Host allowlist permits the hostname
  // because pi-web.operator.dev is the operator-configured origin. A naive
  // hostname-only Origin check would accept this; the port-aware check must
  // not.
  const crossPort = new Request("http://pi-web.operator.dev:30141/api/skills/install", {
    method: "POST",
    headers: {
      host: "pi-web.operator.dev:30141",
      origin: "http://pi-web.operator.dev:8080",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
  });
  assert.equal(isApiRequestAllowed(crossPort, ["pi-web.operator.dev"]), false);
});

test("accepts same-origin requests when Origin port matches the request port", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  // Legacy / pre-Chromium-150 behavior: Origin includes the port and it
  // matches Host. Must still pass.
  const matchingPort = new Request("http://127.0.0.1:30141/api/agent/running", {
    headers: {
      host: "127.0.0.1:30141",
      origin: "http://127.0.0.1:30141",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestAllowed(matchingPort), true);
});

test("rejects Origin whose scheme differs even when hostname and port match", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  // https attacker on a loopback port must not be able to drive an http API.
  const httpsDowngrade = new Request("http://127.0.0.1:30141/api/test", {
    method: "POST",
    headers: {
      host: "127.0.0.1:30141",
      origin: "https://127.0.0.1:30141",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
  });
  assert.equal(isApiRequestAllowed(httpsDowngrade), false);
});

test("accepts real-world Chrome 152 POST against /api with the port stripped from Origin", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  // Mirrors the failing request captured on Chrome 152.0.0.0:
  //   POST /api/default-cwd HTTP/1.1
  //   Host: 127.0.0.1:30141
  //   Origin: http://127.0.0.1          ← port stripped by Chromium
  //   Sec-Fetch-Site: same-origin
  //   Sec-Fetch-Mode: cors
  //   Content-Length: 0
  const captured = new Request("http://127.0.0.1:30141/api/default-cwd", {
    method: "POST",
    headers: {
      host: "127.0.0.1:30141",
      origin: "http://127.0.0.1",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
    },
  });
  assert.equal(isApiRequestAllowed(captured), true);
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

test("allows a proxy that reports the scheme out-of-band and rewrites Origin", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  // Azure Dev Tunnels normalizes Host and Origin onto the backend authority
  // but keeps the external scheme in x-forwarded-proto.
  const request = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://localhost:30141",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestAllowed(request), true);
});

test("still rejects a foreign origin when a proxy is in front", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const foreignHost = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://attacker.example",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-site",
    },
  });
  const foreignPort = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://localhost:30142",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-site",
    },
  });
  const alternateLoopback = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://127.0.0.1:30141",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-site",
    },
  });
  const opaque = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "null",
      "x-forwarded-proto": "https",
      "sec-fetch-site": "same-site",
    },
  });

  assert.equal(isApiRequestAllowed(foreignHost), false);
  assert.equal(isApiRequestAllowed(foreignPort), false);
  assert.equal(isApiRequestAllowed(alternateLoopback), false);
  assert.equal(isApiRequestAllowed(opaque), false);
});

test("does not relax the scheme without same-origin proxy evidence", async () => {
  const { isApiRequestAllowed } = await loadSubject();
  const request = new Request("https://localhost:30141/api/test", {
    method: "POST",
    headers: {
      host: "localhost:30141",
      origin: "http://localhost:30141",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(isApiRequestAllowed(request), false);

  request.headers.set("x-forwarded-proto", "https");
  request.headers.set("sec-fetch-site", "same-site");
  assert.equal(isApiRequestAllowed(request), false);
});
