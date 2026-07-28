import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { submitAuthForm } from "../lib/auth-form.ts";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("auth forms include secure login and setup behavior", async () => {
  const sourceText = await source("components/AuthForms.tsx");

  assert.match(sourceText, /AuthFormMode = "login" \| "setup"/);
  assert.match(sourceText, /name="password"/);
  assert.match(sourceText, /required/);
  assert.match(sourceText, /name="token"/);
  assert.match(sourceText, /name="confirmPassword"/);
  assert.doesNotMatch(sourceText, /localStorage\.(setItem|getItem)/);
  assert.doesNotMatch(sourceText, /document\.cookie/);
});

test("login submits the correct payload and invokes the callback on success", async () => {
  const requests = [];
  let successCalls = 0;

  await submitAuthForm({
    mode: "login",
    values: { password: "secret" },
    request: async (url, init) => {
      requests.push({ url, init });
      return new Response(null, { status: 204 });
    },
    onSuccess: () => { successCalls += 1; },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/auth/login");
  assert.deepEqual(JSON.parse(requests[0].init.body), { password: "secret" });
  assert.equal(successCalls, 1);
});

test("setup submits the token and password but does not request on confirmation mismatch", async () => {
  let requestCalls = 0;

  const mismatch = await submitAuthForm({
    mode: "setup",
    values: { token: "token", password: "secret", confirmPassword: "different" },
    request: async () => {
      requestCalls += 1;
      return new Response(null, { status: 204 });
    },
    onSuccess: () => {},
  });

  assert.deepEqual(mismatch, { ok: false, errorCode: "AUTH_PASSWORD_MISMATCH" });
  assert.equal(requestCalls, 0);

  const requests = [];
  const success = await submitAuthForm({
    mode: "setup",
    values: { token: "token", password: "secret", confirmPassword: "secret" },
    request: async (url, init) => {
      requests.push({ url, init });
      return new Response(null, { status: 204 });
    },
    onSuccess: () => {},
  });

  assert.deepEqual(success, { ok: true });
  assert.equal(requests[0].url, "/api/auth/setup");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    token: "token",
    password: "secret",
    confirmPassword: "secret",
  });
});

test("HTTP failures do not invoke the success callback, while successful requests do", async () => {
  let successCalls = 0;
  const failure = await submitAuthForm({
    mode: "login",
    values: { password: "secret" },
    request: async () => Response.json({ errorCode: "AUTH_LOGIN_FAILED", error: "Login failed" }, { status: 401 }),
    onSuccess: () => { successCalls += 1; },
  });

  assert.deepEqual(failure, { ok: false, errorCode: "AUTH_LOGIN_FAILED" });
  assert.equal(successCalls, 0);

  const success = await submitAuthForm({
    mode: "login",
    values: { password: "secret" },
    request: async () => new Response(null, { status: 204 }),
    onSuccess: () => { successCalls += 1; },
  });

  assert.deepEqual(success, { ok: true });
  assert.equal(successCalls, 1);
});

test("auth failures prefer the stable error code returned by the API", async () => {
  const result = await submitAuthForm({
    mode: "setup",
    values: { token: "token", password: "secret", confirmPassword: "secret" },
    request: async () => Response.json({ errorCode: "AUTH_SETUP_TOKEN_INVALID", error: "The setup token is invalid" }, { status: 401 }),
    onSuccess: () => {},
  });

  assert.deepEqual(result, { ok: false, errorCode: "AUTH_SETUP_TOKEN_INVALID" });
});

test("auth screens use i18n instead of hardcoded text", async () => {
  const [form, login, setup] = await Promise.all([
    source("components/AuthForms.tsx"),
    source("app/login/page.tsx"),
    source("app/setup/page.tsx"),
  ]);

  assert.match(form, /useI18n/);
  assert.match(login, /useI18n/);
  assert.match(setup, /useI18n/);
});

test("login and setup pages use the auth form and navigate", async () => {
  const [login, setup] = await Promise.all([
    source("app/login/page.tsx"),
    source("app/setup/page.tsx"),
  ]);

  assert.match(login, /mode="login"/);
  assert.match(login, /router\.replace\("\/"\)/);
  assert.match(setup, /mode="setup"/);
  assert.match(setup, /\/login/);
});

test("the settings password form preserves validation, submission, and localized errors", async () => {
  const [appShell, passwordForm, english, chinese] = await Promise.all([
    source("components/AppShell.tsx"),
    source("components/PasswordChangeForm.tsx"),
    source("lib/i18n/messages/en.ts"),
    source("lib/i18n/messages/zh-CN.ts"),
  ]);

  assert.match(appShell, /auth\.logout/);
  assert.match(appShell, /\/api\/auth\/logout/);
  assert.match(passwordForm, /auth\.error\.AUTH_PASSWORD_MISMATCH/);
  assert.match(passwordForm, /\/api\/auth\/password/);
  assert.match(passwordForm, /onSuccess\(\)/);
  assert.match(passwordForm, /body !== null && typeof body === "object" && typeof body\.errorCode === "string"/);
  assert.match(english, /"settings\.title": "Settings"/);
  assert.match(chinese, /"settings\.title": "\u8bbe\u7f6e"/);
  assert.match(english, /"settings\.projectRequired"/);
  assert.match(chinese, /"settings\.projectRequired"/);
});

test("regular logout failures stay on the current page, while password changes still force a redirect to login", async () => {
  const sourceText = await source("components/AppShell.tsx");

  assert.match(sourceText, /handleLogout\(forceRedirect = false\)/);
  assert.match(sourceText, /if \(forceRedirect\) router\.replace\("\/login"\)/);
  assert.match(sourceText, /onPasswordChanged=\{\(\) => \{ void handleLogout\(true\); \}\}/);
  assert.match(sourceText, /auth-sidebar-error/);
});

test("the logout API returns a stable error code and compatibility message", async () => {
  const sourceText = await source("app/api/auth/logout/route.ts");

  assert.match(sourceText, /AUTH_LOGOUT_FAILED/);
  assert.match(sourceText, /authError/);
});
