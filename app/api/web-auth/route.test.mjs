import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const originalPassword = process.env.PI_WEB_PASSWORD;
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, POST, DELETE } = await jiti.import("./route.ts");

before(() => { process.env.PI_WEB_PASSWORD = "correct horse battery staple"; });
after(() => {
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

  response = await POST(request("POST", { password: "correct horse battery staple" }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /^pi_web_session=v1\./);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=strict/i);
  assert.match(cookie, /Path=\//i);

  const cookiePair = cookie.split(";", 1)[0];
  response = await GET(request("GET", undefined, { Cookie: cookiePair }));
  assert.deepEqual(await response.json(), { enabled: true, authenticated: true });
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
