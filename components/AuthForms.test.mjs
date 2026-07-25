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

  assert.deepEqual(mismatch, { ok: false, error: "两次密码不一致" });
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
    request: async () => new Response(null, { status: 401 }),
    onSuccess: () => { successCalls += 1; },
  });

  assert.deepEqual(failure, { ok: false, error: "认证失败，请稍后再试" });
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

  assert.match(sourceText, /修改访问密码/);
  assert.match(sourceText, /退出登录/);
  assert.match(sourceText, /\/api\/auth\/password/);
  assert.match(sourceText, /\/api\/auth\/logout/);
  assert.match(sourceText, /\/login/);
});
