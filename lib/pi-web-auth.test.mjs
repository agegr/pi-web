import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const configDirectory = await mkdtemp(join(tmpdir(), "pi-web-auth-"));
process.env.PI_WEB_AUTH_CONFIG_PATH = join(configDirectory, "auth.json");

async function loadSubject() {
  return import("./pi-web-auth.ts");
}

test.after(async () => {
  await rm(configDirectory, { recursive: true, force: true });
});

test.beforeEach(async () => {
  const { resetAuthStateForTests } = await loadSubject();
  await resetAuthStateForTests();
});

test("密码哈希可以校验且错误密码失败", async () => {
  const { initializeAuth, verifyPassword } = await loadSubject();
  await initializeAuth("setup-token", "correct-password");
  assert.equal(await verifyPassword("correct-password"), true);
  assert.equal(await verifyPassword("wrong-password"), false);
});

test("初始化 token 只能消费一次", async () => {
  const { consumeSetupToken } = await loadSubject();
  assert.equal(consumeSetupToken("setup-token"), true);
  assert.equal(consumeSetupToken("setup-token"), false);
});

test("改密代次会使已有 session 失效", async () => {
  const { createSession, getSession, revokeAllSessions } = await loadSubject();
  const token = createSession();
  assert.equal(getSession(token).valid, true);
  revokeAllSessions();
  assert.equal(getSession(token).valid, false);
});

test("限速在失败后延迟并在阈值后拒绝", async () => {
  const { checkLoginRateLimit, recordLoginFailure } = await loadSubject();
  assert.equal(checkLoginRateLimit("source").allowed, true);
  for (let i = 0; i < 5; i += 1) recordLoginFailure("source");
  assert.equal(checkLoginRateLimit("source").allowed, false);
});
