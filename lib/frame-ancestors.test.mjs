import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const original = {
  password: process.env.PI_WEB_PASSWORD,
  ancestors: process.env.PI_WEB_FRAME_ANCESTORS,
};
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { proxy } = await jiti.import("../proxy.ts");
const { frameAncestorSources, pageFramingHeaders } = await jiti.import("./frame-ancestors.ts");

function restore(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  delete process.env.PI_WEB_PASSWORD;
  delete process.env.PI_WEB_FRAME_ANCESTORS;
});
after(() => {
  restore("PI_WEB_PASSWORD", original.password);
  restore("PI_WEB_FRAME_ANCESTORS", original.ancestors);
});

function request(path, headers = {}) {
  return new NextRequest(`http://127.0.0.1:30141${path}`, {
    headers: { Host: "127.0.0.1:30141", ...headers },
  });
}

test("the app page refuses a cross-site frame by default", () => {
  const response = proxy(request("/", {
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Dest": "iframe",
    Referer: "https://attacker.example/",
  }));
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("content-security-policy"), "frame-ancestors 'self'");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
});

test("every page answer carries the policy, redirects and the login page included", () => {
  assert.equal(proxy(request("/login")).status, 307);
  assert.equal(proxy(request("/login")).headers.get("content-security-policy"), "frame-ancestors 'self'");

  process.env.PI_WEB_PASSWORD = "secret";
  for (const path of ["/", "/login"]) {
    assert.equal(proxy(request(path)).headers.get("content-security-policy"), "frame-ancestors 'self'", path);
  }
});

test("API answers are not pages and get no framing policy", () => {
  const response = proxy(request("/api/sessions"));
  assert.equal(response.headers.get("content-security-policy"), null);
  assert.equal(response.headers.get("x-frame-options"), null);
});

test("PI_WEB_FRAME_ANCESTORS lets the named origins frame the app", () => {
  process.env.PI_WEB_FRAME_ANCESTORS = "https://portal.example, http://localhost:*";
  const response = proxy(request("/"));
  assert.equal(
    response.headers.get("content-security-policy"),
    "frame-ancestors 'self' https://portal.example http://localhost:*",
  );
  // X-Frame-Options cannot name another origin, so it must not block them.
  assert.equal(response.headers.get("x-frame-options"), null);
});

test("accepts CSP source expressions and drops anything that could reach past the directive", () => {
  assert.deepEqual(
    frameAncestorSources("*, https:, *.example.com, https://a.example:8443, http://[::1]:3000, http://127.0.0.1:*"),
    ["*", "https:", "*.example.com", "https://a.example:8443", "http://[::1]:3000", "http://127.0.0.1:*"],
  );
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(
      frameAncestorSources("https://ok.example, https://a.example; script-src *, 'unsafe-inline', 'none', https://a.example/path?x, a b"),
      ["https://ok.example"],
    );
    assert.deepEqual(pageFramingHeaders(" , ;"), [
      ["Content-Security-Policy", "frame-ancestors 'self'"],
      ["X-Frame-Options", "SAMEORIGIN"],
    ]);
  } finally {
    console.warn = warn;
  }
});
