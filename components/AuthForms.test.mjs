import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { submitAuthForm } from "../lib/auth-form.ts";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("认证表单包含登录和初始化的安全行为", async () => {
  const sourceText = await source("components/AuthForms.tsx");

  assert.match(sourceText, /AuthFormMode = "login" \| "setup"/);
  assert.match(sourceText, /name="password"/);
  assert.match(sourceText, /required/);
  assert.match(sourceText, /name="token"/);
  assert.match(sourceText, /name="confirmPassword"/);
  assert.doesNotMatch(sourceText, /localStorage\.(setItem|getItem)/);
  assert.doesNotMatch(sourceText, /document\.cookie/);
});

test("登录提交正确的 payload 并在成功后调用回调", async () => {
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

test("初始化提交 token 和密码，但密码确认不匹配时不发请求", async () => {
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

test("HTTP 失败不调用成功回调，成功请求调用成功回调", async () => {
  let successCalls = 0;
  const failure = await submitAuthForm({
    mode: "login",
    values: { password: "secret" },
    request: async () => Response.json({ errorCode: "AUTH_LOGIN_FAILED", error: "登录失败" }, { status: 401 }),
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

test("认证失败优先使用 API 返回的稳定错误码", async () => {
  const result = await submitAuthForm({
    mode: "setup",
    values: { token: "token", password: "secret", confirmPassword: "secret" },
    request: async () => Response.json({ errorCode: "AUTH_SETUP_TOKEN_INVALID", error: "初始化 token 无效" }, { status: 401 }),
    onSuccess: () => {},
  });

  assert.deepEqual(result, { ok: false, errorCode: "AUTH_SETUP_TOKEN_INVALID" });
});

test("认证界面使用 i18n，而不是硬编码文案", async () => {
  const [form, login, setup] = await Promise.all([
    source("components/AuthForms.tsx"),
    source("app/login/page.tsx"),
    source("app/setup/page.tsx"),
  ]);

  assert.match(form, /useI18n/);
  assert.match(login, /useI18n/);
  assert.match(setup, /useI18n/);
});

test("登录和初始化页面使用认证表单并导航", async () => {
  const [login, setup] = await Promise.all([
    source("app/login/page.tsx"),
    source("app/setup/page.tsx"),
  ]);

  assert.match(login, /mode="login"/);
  assert.match(login, /router\.replace\("\/"\)/);
  assert.match(setup, /mode="setup"/);
  assert.match(setup, /\/login/);
});

test("AppShell 暴露改密和退出登录入口", async () => {
  const sourceText = await source("components/AppShell.tsx");

  assert.match(sourceText, /auth\.changePassword/);
  assert.match(sourceText, /auth\.logout/);
  assert.match(sourceText, /useI18n/);
  assert.match(sourceText, /auth\.error\.AUTH_PASSWORD_MISMATCH/);
  assert.doesNotMatch(sourceText, />修改访问密码</);
  assert.doesNotMatch(sourceText, />退出登录</);
  assert.match(sourceText, /\/api\/auth\/password/);
  assert.match(sourceText, /\/api\/auth\/logout/);
  assert.match(sourceText, /\/login/);
});

test("登出 API 返回稳定错误码和兼容文案", async () => {
  const sourceText = await source("app/api/auth/logout/route.ts");

  assert.match(sourceText, /AUTH_LOGOUT_FAILED/);
  assert.match(sourceText, /authError/);
});
