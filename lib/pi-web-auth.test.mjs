import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
  await rm(process.env.PI_WEB_AUTH_CONFIG_PATH, { recursive: true, force: true });
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
  await revokeAllSessions();
  assert.equal(getSession(token).valid, false);
});

test("限速在失败后延迟并在阈值后拒绝", async () => {
  const { checkLoginRateLimit, recordLoginFailure } = await loadSubject();
  assert.equal(checkLoginRateLimit("source").allowed, true);
  for (let i = 0; i < 5; i += 1) recordLoginFailure("source");
  assert.equal(checkLoginRateLimit("source").allowed, false);
});

test("全局限速不能通过轮换来源绕过", async () => {
  const { checkLoginRateLimit, recordLoginFailure } = await loadSubject();
  for (let i = 0; i < 5; i += 1) recordLoginFailure(`source-${i}`);
  assert.equal(checkLoginRateLimit("new-source").allowed, false);
});

test("来源桶和全局桶分别在窗口过期后恢复", async () => {
  const { checkLoginRateLimit, recordLoginFailure } = await loadSubject();
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    for (let i = 0; i < 5; i += 1) recordLoginFailure("source");
    for (let i = 0; i < 5; i += 1) recordLoginFailure(`other-${i}`);
    assert.equal(checkLoginRateLimit("source").allowed, false);
    now += 15 * 60 * 1000 + 1;
    assert.equal(checkLoginRateLimit("source").allowed, true);
    assert.equal(checkLoginRateLimit("new-source").allowed, true);
  } finally {
    Date.now = originalNow;
  }
});

test("默认配置路径使用 PI_CODING_AGENT_DIR", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-auth-default-"));
  const script = `import { getAuthConfigPath } from ${JSON.stringify(new URL("./pi-web-auth.ts", import.meta.url).href)}; console.log(getAuthConfigPath())`;
  const result = await import("node:child_process").then(({ execFile }) => new Promise((resolve, reject) => {
    execFile(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, PI_CODING_AGENT_DIR: directory, PI_WEB_AUTH_CONFIG_PATH: "" },
    }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  }));
  assert.equal(result, join(directory, "pi-web-auth.json"));
  await rm(directory, { recursive: true, force: true });
});

test("配置文件权限为 0600 且写入内容不含临时文件", async () => {
  const { initializeAuth, getAuthConfigPath } = await loadSubject();
  await initializeAuth("setup-token", "password");
  const file = await stat(getAuthConfigPath());
  assert.equal(file.mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(getAuthConfigPath(), "utf8"))).sort(), ["generation", "passwordHash", "salt", "updatedAt"]);
  assert.equal(existsSync(`${getAuthConfigPath()}.tmp`), false);
});

test("损坏 JSON 读取会抛错而不是返回未初始化", async () => {
  await writeFile(process.env.PI_WEB_AUTH_CONFIG_PATH, "{");
  const { getAuthState } = await loadSubject();
  await assert.rejects(() => getAuthState(), SyntaxError);
});

test("session TTL 为 24 小时", async () => {
  const { createSession, getSession } = await loadSubject();
  const token = createSession();
  assert.equal(getSession(token).valid, true);
  const originalNow = Date.now;
  Date.now = () => originalNow() + 24 * 60 * 60 * 1000;
  try {
    assert.equal(getSession(token).valid, false);
  } finally {
    Date.now = originalNow;
  }
});

test("可以吊销单个 session", async () => {
  const { createSession, getSession, revokeSession } = await loadSubject();
  const token = createSession();
  const other = createSession();
  revokeSession(token);
  assert.equal(getSession(token).valid, false);
  assert.equal(getSession(other).valid, true);
});

test("进程重启后旧 session 自然失效", async () => {
  const moduleUrl = new URL("./pi-web-auth.ts", import.meta.url).href;
  const script = `import { createSession } from ${JSON.stringify(moduleUrl)}; console.log(createSession())`;
  const token = await import("node:child_process").then(({ execFile }) => new Promise((resolve, reject) => {
    execFile(process.execPath, ["--input-type=module", "-e", script], { env: process.env }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  }));
  const checkScript = `import { getSession } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(getSession(${JSON.stringify(token)})))`;
  const result = await import("node:child_process").then(({ execFile }) => new Promise((resolve, reject) => {
    execFile(process.execPath, ["--input-type=module", "-e", checkScript], { env: process.env }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  }));
  assert.deepEqual(JSON.parse(result), { valid: false });
});

test("初始化成功会吊销已有 session 并提升 generation", async () => {
  const { createSession, getSession, initializeAuth, getAuthState } = await loadSubject();
  const token = createSession();
  await initializeAuth("setup-token", "password");
  assert.equal(getSession(token).valid, false);
  assert.equal((await getAuthState()).generation, 2);
});

test("进程重启后新 session 使用持久化 generation", async () => {
  const { initializeAuth, getAuthState } = await loadSubject();
  await initializeAuth("setup-token", "password");
  assert.equal((await getAuthState()).generation, 2);

  const moduleUrl = new URL("./pi-web-auth.ts", import.meta.url).href;
  const script = `import { createSession, getSession, getAuthState } from ${JSON.stringify(moduleUrl)}; const token = createSession(); console.log(JSON.stringify({ session: getSession(token), state: await getAuthState() }));`;
  const result = await import("node:child_process").then(({ execFile }) => new Promise((resolve, reject) => {
    execFile(process.execPath, ["--input-type=module", "-e", script], { env: process.env }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  }));
  assert.deepEqual(JSON.parse(result), {
    session: { valid: true, generation: 2 },
    state: { initialized: true, generation: 2, updatedAt: (await getAuthState()).updatedAt },
  });
});

test("全量吊销后重启进程使用新的持久化 generation", async () => {
  const { createSession, getAuthState, initializeAuth, revokeAllSessions } = await loadSubject();
  await initializeAuth("setup-token", "password");
  const oldToken = createSession();
  const before = await getAuthState();

  await revokeAllSessions();

  const persisted = JSON.parse(await readFile(process.env.PI_WEB_AUTH_CONFIG_PATH, "utf8"));
  assert.equal(persisted.generation, before.generation + 1);
  assert.match(persisted.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const moduleUrl = new URL("./pi-web-auth.ts", import.meta.url).href;
  const script = `import { createSession, getAuthState, getSession } from ${JSON.stringify(moduleUrl)}; const token = createSession(); console.log(JSON.stringify({ session: getSession(token), state: await getAuthState() }));`;
  const result = await import("node:child_process").then(({ execFile }) => new Promise((resolve, reject) => {
    execFile(process.execPath, ["--input-type=module", "-e", script], { env: process.env }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  }));
  assert.deepEqual(JSON.parse(result), {
    session: { valid: true, generation: before.generation + 1 },
    state: { initialized: true, generation: before.generation + 1, updatedAt: (await getAuthState()).updatedAt },
  });
  assert.equal((await getAuthState()).generation, persisted.generation);
  assert.equal(typeof oldToken, "string");
});

test("全量吊销写入失败时不提交内存代次", async () => {
  const { createSession, getSession, initializeAuth, revokeAllSessions } = await loadSubject();
  await initializeAuth("setup-token", "password");
  const token = createSession();
  const original = process.env.PI_WEB_AUTH_CONFIG_PATH;
  const brokenParent = join(configDirectory, "revoke-broken-parent");
  await writeFile(brokenParent, "not-a-directory");
  process.env.PI_WEB_AUTH_CONFIG_PATH = join(brokenParent, "auth.json");
  try {
    await assert.rejects(() => revokeAllSessions());
  } finally {
    process.env.PI_WEB_AUTH_CONFIG_PATH = original;
    await rm(brokenParent, { force: true });
  }
  assert.equal(getSession(token).valid, true);
});

test("并发初始化只有一个请求成功且不会覆盖配置", async () => {
  const { initializeAuth, verifyPassword, getAuthState } = await loadSubject();
  const results = await Promise.allSettled([
    initializeAuth("setup-token", "first-password"),
    initializeAuth("setup-token", "second-password"),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await getAuthState()).initialized, true);
  assert.equal((await verifyPassword("first-password")) !== (await verifyPassword("second-password")), true);
});

test("初始化在消费 token 后因目标目录写入失败仍可重试", async () => {
  const { initializeAuth, getAuthConfigPath } = await loadSubject();
  const original = process.env.PI_WEB_AUTH_CONFIG_PATH;
  const brokenParent = join(configDirectory, "broken-parent");
  await writeFile(brokenParent, "not-a-directory");
  process.env.PI_WEB_AUTH_CONFIG_PATH = join(brokenParent, "auth.json");
  await assert.rejects(() => initializeAuth("setup-token", "password"));
  await rm(brokenParent, { force: true });
  process.env.PI_WEB_AUTH_CONFIG_PATH = original;
  await initializeAuth("setup-token", "password");
  assert.equal(existsSync(getAuthConfigPath()), true);
  process.env.PI_WEB_AUTH_CONFIG_PATH = original;
});

test("认证配置结构损坏会明确抛错", async () => {
  const invalidConfigs = [
    {},
    { passwordHash: "zz", salt: "00", generation: 1, updatedAt: new Date().toISOString() },
    { passwordHash: "a".repeat(128), salt: "b".repeat(32), generation: 0, updatedAt: "not-a-date" },
  ];
  const { getAuthState } = await loadSubject();
  for (const config of invalidConfigs) {
    await writeFile(process.env.PI_WEB_AUTH_CONFIG_PATH, JSON.stringify(config));
    await assert.rejects(() => getAuthState(), /认证配置结构无效/);
    await rm(process.env.PI_WEB_AUTH_CONFIG_PATH, { force: true });
  }
});

test("配置出现后 setup token 会被拒绝", async () => {
  const { consumeSetupToken } = await loadSubject();
  await writeFile(process.env.PI_WEB_AUTH_CONFIG_PATH, "{}");
  assert.equal(consumeSetupToken("setup-token"), false);
});

test("setup token 具有高熵", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-auth-entropy-"));
  const script = `import { getSetupTokenForTests } from ${JSON.stringify(new URL("./pi-web-auth.ts", import.meta.url).href)}; console.log(getSetupTokenForTests())`;
  const result = await import("node:child_process").then(({ execFile }) => new Promise((resolve, reject) => {
    execFile(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, PI_WEB_AUTH_CONFIG_PATH: join(directory, "auth.json") } }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  }));
  assert.equal(result.length, 64);
  assert.match(result, /^[0-9a-f]+$/);
  await rm(directory, { recursive: true, force: true });
});
