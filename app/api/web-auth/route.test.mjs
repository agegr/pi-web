import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const originalPassword = process.env.PI_WEB_PASSWORD;
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, POST, DELETE } = await jiti.import("./route.ts");
const { recordAuthSuccess } = await import("../../../lib/auth-throttle.ts");

before(() => { process.env.PI_WEB_PASSWORD = "correct horse battery staple"; });
beforeEach(() => { recordAuthSuccess(); });
after(() => {
  recordAuthSuccess();
  if (originalPassword === undefined) delete process.env.PI_WEB_PASSWORD;
  else process.env.PI_WEB_PASSWORD = originalPassword;
});

function request(method, body, headers = {}) {
  return new NextRequest("http://localhost/api/web-auth", {
    method,
    headers: {
      Host: "localhost",
      Origin: "http://localhost",
      "Sec-Fetch-Site": "same-origin",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("logs in with one password and reports the signed session", async () => {
  let response = await POST(request("POST", { password: "wrong" }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal(response.headers.get("retry-after"), "1");

  recordAuthSuccess();
  response = await POST(request("POST", { password: "correct horse battery staple" }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /^pi_web_session=v1\./);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//i);

  const cookiePair = cookie.split(";", 1)[0];
  response = await GET(request("GET", undefined, { Cookie: cookiePair }));
  assert.deepEqual(await response.json(), { enabled: true, authenticated: true });
});

test("blocks further attempts after a failure, even with the right password", async () => {
  let response = await POST(request("POST", { password: "wrong" }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Invalid password", retryAfterMs: 1000 });

  response = await POST(request("POST", { password: "correct horse battery staple" }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "1");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("set-cookie"), false);
  const body = await response.json();
  assert.equal(body.error, "Too many failed attempts");
  assert.ok(body.retryAfterMs > 0 && body.retryAfterMs <= 1000);
});

test("logout clears the session cookie", async () => {
  const response = await DELETE(request("DELETE"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /pi_web_session=;/);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/i);
});

test("rejects cross-origin login attempts", async () => {
  const response = await POST(request(
    "POST",
    { password: "correct horse battery staple" },
    { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
  ));
  assert.equal(response.status, 403);
});
