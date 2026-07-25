import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(sourceText, /两次密码不一致/);
  assert.match(sourceText, /认证失败/);
  assert.match(sourceText, /onSuccess\(\)/);
  assert.doesNotMatch(sourceText, /localStorage\.(setItem|getItem)/);
  assert.doesNotMatch(sourceText, /document\.cookie/);
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
