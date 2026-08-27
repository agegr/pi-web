import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { generateCursorAuthParams, getTokenExpiry, pollCursorAuth } = await jiti.import("./auth.ts");

test("builds a Cursor deep-link login URL with PKCE challenge and uuid", async () => {
  const params = await generateCursorAuthParams();
  const url = new URL(params.loginUrl);
  assert.equal(url.origin + url.pathname, "https://cursor.com/loginDeepControl");
  assert.equal(url.searchParams.get("mode"), "login");
  assert.equal(url.searchParams.get("redirectTarget"), "cli");
  assert.equal(url.searchParams.get("uuid"), params.uuid);
  assert.equal(url.searchParams.get("challenge"), params.challenge);
  assert.ok(params.verifier.length > 20);
  assert.notEqual(params.verifier, params.challenge);
});

test("reads JWT expiry with a five-minute skew", () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  const token = `header.${payload}.sig`;
  const expires = getTokenExpiry(token);
  assert.ok(expires <= exp * 1000 - 4 * 60 * 1000);
  assert.ok(expires >= exp * 1000 - 6 * 60 * 1000);
});

test("pollCursorAuth aborts when the login signal fires", async () => {
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(() => pollCursorAuth("uuid", "verifier", abort.signal), /Login cancelled/);
});

test("pollCursorAuth bounds each poll request", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      if (init.signal.aborted) reject(init.signal.reason);
    });
  };

  await assert.rejects(
    () => pollCursorAuth("uuid", "verifier", undefined, {
      initialDelayMs: 0,
      requestTimeoutMs: 5,
    }),
    /Too many consecutive errors/,
  );
  assert.equal(calls, 3);
});
