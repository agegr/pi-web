import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const configDirectory = await mkdtemp(join(tmpdir(), "pi-web-auth-"));
process.env.PI_WEB_AUTH_CONFIG_PATH = join(configDirectory, "auth.json");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

async function loadSubject() {
  return jiti.import("./pi-web-auth.ts");
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

test("初始化和改密拒绝空密码、弱密码和超长密码", async () => {
  const { initializeAuth, changePassword } = await loadSubject();
  for (const password of ["", "short", "a".repeat(129), "aaaaaaaa", "11111111", "\n".repeat(8), "password", "12345678"]) {
    await assert.rejects(() => initializeAuth("setup-token", password), /密码(长度无效|格式无效)/);
  }
  await initializeAuth("setup-token", "a-secure-password");
  for (const password of ["", "short", "b".repeat(129), "bbbbbbbb", "qwertyui"]) {
    await assert.rejects(() => changePassword("a-secure-password", password), /密码(长度无效|格式无效)/);
  }
});

test("认证配置持久化显式 scrypt 算法版本和成本参数", async () => {
  const { initializeAuth, getAuthConfigPath } = await loadSubject();
  await initializeAuth("setup-token", "a-secure-password");
  const config = JSON.parse(await readFile(getAuthConfigPath(), "utf8"));
  assert.equal(config.algorithm, "scrypt");
  assert.equal(config.algorithmVersion, 1);
  assert.deepEqual(config.scrypt, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
});

test("旧认证配置在密码 mutation 后迁移到版本化 scrypt 参数", async () => {
  const { changePassword, getAuthConfigPath } = await loadSubject();
  const { scrypt } = await import("node:crypto");
  const { promisify } = await import("node:util");
  const derive = promisify(scrypt);
  const salt = Buffer.from("b".repeat(32), "hex");
  const hash = await derive("a-secure-password", salt, 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  await writeFile(getAuthConfigPath(), JSON.stringify({
    passwordHash: hash.toString("hex"), salt: salt.toString("hex"), generation: 1, updatedAt: new Date().toISOString(),
  }));
  await changePassword("a-secure-password", "another-secure-password");
  const config = JSON.parse(await readFile(getAuthConfigPath(), "utf8"));
  assert.equal(config.algorithmVersion, 1);
  assert.deepEqual(config.scrypt, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
});

test("登录校验和创建 session 与改密共享认证事务队列", async () => {
  const { authenticateAndCreateSession, changePassword, initializeAuth, getSession } = await loadSubject();
  await initializeAuth("setup-token", "a-secure-password");
  const login = authenticateAndCreateSession("a-secure-password");
  const change = changePassword("a-secure-password", "another-secure-password");
  const [loginResult] = await Promise.all([login, change]);
  assert.ok(loginResult);
  assert.equal(getSession(loginResult).valid, false);
  assert.equal(await authenticateAndCreateSession("a-secure-password"), null);
  const current = await authenticateAndCreateSession("another-secure-password");
  assert.ok(current);
  assert.equal(getSession(current).valid, true);
});

test("来源限速不会锁死正常来源且全局保护有更高独立阈值", async () => {
  const { checkLoginRateLimit, recordLoginFailure } = await loadSubject();
  for (let i = 0; i < 5; i += 1) recordLoginFailure("attacker");
  assert.equal(checkLoginRateLimit("attacker").allowed, false);
  assert.equal(checkLoginRateLimit("normal-user").allowed, true);
  for (let i = 0; i < 100; i += 1) recordLoginFailure(`rotating-${i}`);
  assert.equal(checkLoginRateLimit("normal-user").allowed, false);
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

test("没有认证配置时全量吊销也通知 session invalidation subscriber", async () => {
  const { createSession, revokeAllSessions, subscribeSessionInvalidation } = await loadSubject();
  const token = createSession();
  let invalidations = 0;
  subscribeSessionInvalidation(token, () => { invalidations += 1; });

  await revokeAllSessions();

  assert.equal(invalidations, 1);
});

test("同一 session 的 invalidation subscribers 共用一个 expiration timer", async () => {
  const { createSession, subscribeSessionInvalidation } = await loadSubject();
  const token = createSession();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let scheduled = 0;
  let cleared = 0;
  globalThis.setTimeout = (...args) => {
    scheduled += 1;
    return originalSetTimeout(...args);
  };
  globalThis.clearTimeout = (handle) => {
    cleared += 1;
    return originalClearTimeout(handle);
  };
  try {
    const unsubscribeFirst = subscribeSessionInvalidation(token, () => {});
    const unsubscribeSecond = subscribeSessionInvalidation(token, () => {});
    assert.equal(scheduled, 1);
    unsubscribeFirst();
    assert.equal(cleared, 0);
    unsubscribeSecond();
    assert.equal(cleared, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("限速在失败后延迟并在阈值后拒绝", async () => {
  const { checkLoginRateLimit, recordLoginFailure } = await loadSubject();
  assert.equal(checkLoginRateLimit("source").allowed, true);
  for (let i = 0; i < 5; i += 1) recordLoginFailure("source");
  assert.equal(checkLoginRateLimit("source").allowed, false);
});

test("全局限速不能通过轮换来源绕过", async () => {
  const { checkLoginRateLimit, recordLoginFailure } = await loadSubject();
  for (let i = 0; i < 100; i += 1) recordLoginFailure(`source-${i}`);
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
  await initializeAuth("setup-token", "test-password");
  const file = await stat(getAuthConfigPath());
  assert.equal(file.mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(getAuthConfigPath(), "utf8"))).sort(), ["algorithm", "algorithmVersion", "generation", "passwordHash", "salt", "scrypt", "updatedAt"]);
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
  await initializeAuth("setup-token", "test-password");
  assert.equal(getSession(token).valid, false);
  assert.equal((await getAuthState()).generation, 2);
});

test("进程重启后新 session 使用持久化 generation", async () => {
  const { initializeAuth, getAuthState } = await loadSubject();
  await initializeAuth("setup-token", "test-password");
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
  await initializeAuth("setup-token", "test-password");
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
  await initializeAuth("setup-token", "test-password");
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

test("并发全量吊销会为每个调用递增持久化 generation", async () => {
  const { getAuthState, initializeAuth, revokeAllSessions } = await loadSubject();
  await initializeAuth("setup-token", "test-password");
  const before = await getAuthState();

  await Promise.all([revokeAllSessions(), revokeAllSessions()]);

  const persisted = JSON.parse(await readFile(process.env.PI_WEB_AUTH_CONFIG_PATH, "utf8"));
  assert.equal(persisted.generation, before.generation + 2);
  assert.equal((await getAuthState()).generation, before.generation + 2);
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

test("初始化和全量吊销共享事务队列并保持内存磁盘 generation 一致", async () => {
  const { getAuthState, initializeAuth, revokeAllSessions } = await loadSubject();
  const initialization = initializeAuth("setup-token", "test-password");
  const revocation = revokeAllSessions();
  await Promise.all([initialization, revocation]);

  const persisted = JSON.parse(await readFile(process.env.PI_WEB_AUTH_CONFIG_PATH, "utf8"));
  const state = await getAuthState();
  assert.equal(state.generation, persisted.generation);
  assert.equal(state.generation, 3);

  const moduleUrl = new URL("./pi-web-auth.ts", import.meta.url).href;
  const script = `import { createSession, getAuthState, getSession } from ${JSON.stringify(moduleUrl)}; const token = createSession(); console.log(JSON.stringify({ session: getSession(token), state: await getAuthState() }));`;
  const result = await import("node:child_process").then(({ execFile }) => new Promise((resolve, reject) => {
    execFile(process.execPath, ["--input-type=module", "-e", script], { env: process.env }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  }));
  assert.deepEqual(JSON.parse(result), {
    session: { valid: true, generation: 3 },
    state: { initialized: true, generation: 3, updatedAt: state.updatedAt },
  });
});

test("初始化事务失败后不会污染后续全量吊销状态", async () => {
  const { getAuthState, initializeAuth, revokeAllSessions } = await loadSubject();
  const original = process.env.PI_WEB_AUTH_CONFIG_PATH;
  const brokenParent = join(configDirectory, "interleaved-broken-parent");
  await writeFile(brokenParent, "not-a-directory");
  process.env.PI_WEB_AUTH_CONFIG_PATH = join(brokenParent, "auth.json");
  try {
    const failedInitialization = initializeAuth("setup-token", "test-password");
    const failedRevocation = revokeAllSessions();
    const results = await Promise.allSettled([failedInitialization, failedRevocation]);
    assert.equal(results[0].status, "rejected");
    assert.equal(results[1].status, "rejected");
  } finally {
    process.env.PI_WEB_AUTH_CONFIG_PATH = original;
    await rm(brokenParent, { force: true });
  }
  assert.deepEqual(await getAuthState(), { initialized: false, generation: 0 });
});

test("初始化在消费 token 后因目标目录写入失败仍可重试", async () => {
  const { initializeAuth, getAuthConfigPath } = await loadSubject();
  const original = process.env.PI_WEB_AUTH_CONFIG_PATH;
  const brokenParent = join(configDirectory, "broken-parent");
  await writeFile(brokenParent, "not-a-directory");
  process.env.PI_WEB_AUTH_CONFIG_PATH = join(brokenParent, "auth.json");
  await assert.rejects(() => initializeAuth("setup-token", "test-password"));
  await rm(brokenParent, { force: true });
  process.env.PI_WEB_AUTH_CONFIG_PATH = original;
  await initializeAuth("setup-token", "test-password");
  assert.equal(existsSync(getAuthConfigPath()), true);
  process.env.PI_WEB_AUTH_CONFIG_PATH = original;
});

test("初始化读取配置路径为目录时按损坏配置拒绝", async () => {
  const { initializeAuth } = await loadSubject();
  const original = process.env.PI_WEB_AUTH_CONFIG_PATH;
  const directoryPath = join(configDirectory, "config-directory");
  await rm(directoryPath, { recursive: true, force: true });
  await import("node:fs/promises").then(({ mkdir }) => mkdir(directoryPath));
  process.env.PI_WEB_AUTH_CONFIG_PATH = directoryPath;
  try {
    await assert.rejects(() => initializeAuth("setup-token", "test-password"), /认证配置路径不是普通文件/);
  } finally {
    process.env.PI_WEB_AUTH_CONFIG_PATH = original;
    await rm(directoryPath, { recursive: true, force: true });
  }
});

test("配置状态 stat 出错时不能接受 setup token", async () => {
  const { consumeSetupToken } = await loadSubject();
  const original = process.env.PI_WEB_AUTH_CONFIG_PATH;
  const brokenParent = join(configDirectory, "stat-broken-parent");
  await writeFile(brokenParent, "not-a-directory");
  process.env.PI_WEB_AUTH_CONFIG_PATH = join(brokenParent, "auth.json");
  try {
    assert.throws(() => consumeSetupToken("setup-token"), { code: "ENOTDIR" });
  } finally {
    process.env.PI_WEB_AUTH_CONFIG_PATH = original;
    await rm(brokenParent, { force: true });
  }
});

test("消费 setup token 后测试辅助不能重新生成或复活 token", async () => {
  const { consumeSetupToken, getSetupTokenForTests } = await loadSubject();
  assert.equal(consumeSetupToken("setup-token"), true);
  assert.throws(() => getSetupTokenForTests(), /初始化 token 不可用/);
  assert.equal(consumeSetupToken("setup-token"), false);
});

test("getAuthState 与排队 mutation 并发时不会回写旧 generation", async () => {
  const { getAuthState, initializeAuth, revokeAllSessions } = await loadSubject();
  await initializeAuth("setup-token", "test-password");
  const revocation = revokeAllSessions();
  const stateRead = getAuthState();
  const [state] = await Promise.all([stateRead, revocation]);
  const sessionModule = await loadSubject();
  const token = sessionModule.createSession();
  assert.equal(state.generation, 3);
  assert.equal(sessionModule.getSession(token).generation, 3);
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

test("没有配置时模块加载会生成 setup token", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-auth-load-token-"));
  const moduleUrl = new URL("./pi-web-auth.ts", import.meta.url).href;
  const script = `import { getSetupTokenForTests } from ${JSON.stringify(moduleUrl)}; console.log(getSetupTokenForTests())`;
  const result = await import("node:child_process").then(({ execFile }) => new Promise((resolve, reject) => {
    execFile(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, PI_WEB_AUTH_CONFIG_PATH: join(directory, "auth.json") } }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  }));
  assert.equal(result.length, 64);
  await rm(directory, { recursive: true, force: true });
});

test("已有有效配置时模块加载静默且不生成 setup token", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-auth-existing-config-"));
  const configPath = join(directory, "auth.json");
  await writeFile(configPath, JSON.stringify({
    passwordHash: "a".repeat(128),
    salt: "b".repeat(32),
    generation: 1,
    updatedAt: new Date().toISOString(),
  }));
  const moduleUrl = new URL("./pi-web-auth.ts", import.meta.url).href;
  const script = `import { getSetupTokenForTests } from ${JSON.stringify(moduleUrl)}; try { getSetupTokenForTests(); console.log("unexpected-token"); } catch (error) { console.log(error.message); }`;
  const result = await import("node:child_process").then(({ execFile }) => new Promise((resolve, reject) => {
    execFile(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, NODE_NO_WARNINGS: "1", PI_WEB_AUTH_CONFIG_PATH: configPath },
    }, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout: stdout.trim(), stderr }));
  }));
  assert.equal(result.stdout, "认证已经初始化");
  assert.equal(result.stderr, "");
  await rm(directory, { recursive: true, force: true });
});

test("启动初始化钩子只向服务端 stderr 输出一次 token，不进入 HTTP 或配置文件", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-auth-startup-"));
  const configPath = join(directory, "auth.json");
  const moduleUrl = new URL("./pi-web-auth.ts", import.meta.url).href;
  const routeUrl = new URL("../app/api/auth/status/route.ts", import.meta.url).href;
  const script = `import { announceSetupToken, getAuthConfigPath } from ${JSON.stringify(moduleUrl)}; import { createJiti } from "jiti"; const { GET } = await createJiti(import.meta.url, { tsconfigPaths: true }).import(${JSON.stringify(routeUrl)}); announceSetupToken(); announceSetupToken(); const response = await GET(new Request("http://localhost/api/auth/status")); console.log(JSON.stringify({ configPath: getAuthConfigPath(), http: await response.text() }));`;
  const result = await import("node:child_process").then(({ execFile }) => new Promise((resolve, reject) => {
    execFile(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, PI_WEB_AUTH_CONFIG_PATH: configPath },
    }, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
  }));
  const { stdout, stderr } = result;
  const lines = stderr.trim().split("\n").filter((line) => line.includes("Pi Web setup token:"));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Pi Web setup token:/);
  const token = lines[0].split(": ").at(-1);
  assert.equal(token?.length, 64);
  assert.doesNotMatch(stdout, /setup token|[0-9a-f]{64}/i);
  assert.equal(existsSync(configPath), false);
  await rm(directory, { recursive: true, force: true });
});

test("启动发现损坏配置时输出本地恢复路径而不生成 setup token", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-auth-corrupt-startup-"));
  const configPath = join(directory, "auth.json");
  await writeFile(configPath, "{");
  const moduleUrl = new URL("./pi-web-auth.ts", import.meta.url).href;
  const script = `import { announceSetupToken } from ${JSON.stringify(moduleUrl)}; announceSetupToken();`;
  const result = await import("node:child_process").then(({ execFile }) => new Promise((resolve, reject) => {
    execFile(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, PI_WEB_AUTH_CONFIG_PATH: configPath },
    }, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
  }));
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /损坏|恢复/);
  assert.match(result.stderr, new RegExp(configPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(result.stderr, /setup token: [0-9a-f]{64}/);
  await rm(directory, { recursive: true, force: true });
});

test("配置路径存在但不是普通文件时视为损坏且不接受 setup token", async () => {
  const { mkdir } = await import("node:fs/promises");
  const { consumeSetupToken, getSetupTokenForTests } = await loadSubject();
  const original = process.env.PI_WEB_AUTH_CONFIG_PATH;
  const directoryPath = join(configDirectory, "non-regular-config");
  await mkdir(directoryPath);
  process.env.PI_WEB_AUTH_CONFIG_PATH = directoryPath;
  try {
    assert.equal(consumeSetupToken("setup-token"), false);
    assert.throws(() => getSetupTokenForTests(), /认证配置损坏/);
  } finally {
    process.env.PI_WEB_AUTH_CONFIG_PATH = original;
    await rm(directoryPath, { recursive: true, force: true });
  }
});

test("broken symlink 配置路径视为损坏且不能初始化覆盖", async () => {
  const { symlink } = await import("node:fs/promises");
  const { consumeSetupToken, getSetupTokenForTests, initializeAuth } = await loadSubject();
  const original = process.env.PI_WEB_AUTH_CONFIG_PATH;
  const symlinkPath = join(configDirectory, "broken-config-symlink");
  const missingTarget = join(configDirectory, "missing-auth-target");
  await symlink(missingTarget, symlinkPath);
  process.env.PI_WEB_AUTH_CONFIG_PATH = symlinkPath;
  try {
    assert.equal(consumeSetupToken("setup-token"), false);
    assert.throws(() => getSetupTokenForTests(), /认证配置损坏/);
    await assert.rejects(() => initializeAuth("setup-token", "test-password"), /认证配置损坏|认证配置路径/);
    assert.equal((await import("node:fs/promises").then(({ lstat }) => lstat(symlinkPath))).isSymbolicLink(), true);
  } finally {
    process.env.PI_WEB_AUTH_CONFIG_PATH = original;
    await rm(symlinkPath, { force: true });
  }
});

async function loadRoutes() {
  return {
    status: await jiti.import("../app/api/auth/status/route.ts"),
    setup: await jiti.import("../app/api/auth/setup/route.ts"),
    login: await jiti.import("../app/api/auth/login/route.ts"),
    providerLogout: await jiti.import("../app/api/auth/logout/[provider]/route.ts"),
    logout: await jiti.import("../app/api/auth/logout/route.ts"),
    password: await jiti.import("../app/api/auth/password/route.ts"),
  };
}

test("provider logout accepts the frontend's authenticated empty-body request", async () => {
  const routes = await loadRoutes();
  const auth = await loadSubject();
  await auth.initializeAuth("setup-token", "safe-password");
  const token = auth.createSession();
  const response = await routes.providerLogout.POST(
    new Request("http://localhost/api/auth/logout/unknown", {
      method: "POST",
      headers: { cookie: `pi_web_session=${token}` },
    }),
    { params: Promise.resolve({ provider: "unknown" }) },
  );
  assert.notEqual(response.status, 415);
});

function jsonRequest(url, body, headers = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function oversizedStreamingRequest(url, headers = {}) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{" + "x".repeat(16 * 1024) + "}"));
      controller.close();
    },
  });
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    duplex: "half",
  });
}

test("认证状态 route 返回未初始化状态", async () => {
  const { status } = await loadRoutes();
  const response = await status.GET(new Request("http://localhost/api/auth/status"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { initialized: false, authenticated: false });
});

test("setup route 拒绝错误 token 并允许成功初始化", async () => {
  const routes = await loadRoutes();
  const invalid = await routes.setup.POST(jsonRequest("http://localhost/api/auth/setup", {
    token: "wrong-token", password: "safe-password", confirmPassword: "safe-password",
  }));
  assert.equal(invalid.status, 401);

  const valid = await routes.setup.POST(jsonRequest("http://localhost/api/auth/setup", {
    token: "setup-token", password: "safe-password", confirmPassword: "safe-password",
  }));
  assert.ok([200, 204].includes(valid.status));

  const duplicate = await routes.setup.POST(jsonRequest("http://localhost/api/auth/setup", {
    token: "setup-token", password: "another-password", confirmPassword: "another-password",
  }));
  assert.equal(duplicate.status, 409);
});

test("setup token 错误复用登录限速且成功初始化不污染失败计数", async () => {
  const routes = await loadRoutes();
  const auth = await loadSubject();
  const previousTrustedProxy = process.env.PI_WEB_TRUSTED_PROXY;
  process.env.PI_WEB_TRUSTED_PROXY = "true";
  try {
    const request = (token, source) => jsonRequest("http://localhost/api/auth/setup", {
      token, password: "safe-password", confirmPassword: "safe-password",
    }, { "x-forwarded-for": source });
    for (let i = 0; i < 5; i += 1) {
      const response = await routes.setup.POST(request("wrong-token", "attacker"));
      assert.equal(response.status, 401);
    }
    const limited = await routes.setup.POST(request("wrong-token", "attacker"));
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("Retry-After")) >= 1);

    const rotated = await routes.setup.POST(request("wrong-token", "another-attacker"));
    assert.equal(rotated.status, 401);
    for (let i = 0; i < 95; i += 1) {
      await routes.setup.POST(request("wrong-token", `rotating-${i}`));
    }
    const globalLimited = await routes.setup.POST(request("wrong-token", "fresh-source"));
    assert.equal(globalLimited.status, 429);
    assert.ok(Number(globalLimited.headers.get("Retry-After")) >= 1);
  } finally {
    process.env.PI_WEB_TRUSTED_PROXY = previousTrustedProxy;
  }

  await auth.resetAuthStateForTests();
  const valid = await routes.setup.POST(jsonRequest("http://localhost/api/auth/setup", {
    token: "setup-token", password: "safe-password", confirmPassword: "safe-password",
  }));
  assert.ok([200, 204].includes(valid.status));

  const { checkLoginRateLimit } = await loadSubject();
  assert.equal(checkLoginRateLimit("anonymous").delayMs, 0);
});

test("login route 错误密码返回 401，成功登录设置安全 cookie", async () => {
  const routes = await loadRoutes();
  await routes.setup.POST(jsonRequest("http://localhost/api/auth/setup", {
    token: "setup-token", password: "safe-password", confirmPassword: "safe-password",
  }));

  const invalid = await routes.login.POST(jsonRequest("https://localhost/api/auth/login", { password: "wrong-password" }, {
    "x-forwarded-for": "203.0.113.10",
  }));
  assert.equal(invalid.status, 401);
  assert.doesNotMatch(await invalid.text(), /wrong-password/);

  const valid = await routes.login.POST(jsonRequest("https://localhost/api/auth/login", { password: "safe-password" }));
  assert.equal(valid.status, 200);
  const cookie = valid.headers.get("set-cookie");
  assert.match(cookie ?? "", /^pi_web_session=[^;]+;/);
  assert.match(cookie ?? "", /HttpOnly/);
  assert.match(cookie ?? "", /SameSite=Lax/);
  assert.match(cookie ?? "", /Path=\//);
  assert.match(cookie ?? "", /Max-Age=86400/);
  assert.match(cookie ?? "", /Secure/);
});

test("login route 对全局临时拒绝返回 Retry-After", async () => {
  const routes = await loadRoutes();
  const auth = await loadSubject();
  await auth.initializeAuth("setup-token", "safe-password");
  for (let i = 0; i < 100; i += 1) {
    auth.recordLoginFailure(`rotating-${i}`);
  }
  const response = await routes.login.POST(jsonRequest("http://localhost/api/auth/login", { password: "safe-password" }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "900");
});

test("status route 识别有效、过期和登出后的 session", async () => {
  const routes = await loadRoutes();
  const auth = await loadSubject();
  await auth.initializeAuth("setup-token", "safe-password");
  const token = auth.createSession();
  const headers = { cookie: `pi_web_session=${token}` };

  assert.deepEqual(await (await routes.status.GET(new Request("http://localhost/api/auth/status", { headers }))).json(), {
    initialized: true, authenticated: true,
  });
  const logout = await routes.logout.POST(new Request("http://localhost/api/auth/logout", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}" }));
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.deepEqual(await (await routes.status.GET(new Request("http://localhost/api/auth/status", { headers }))).json(), {
    initialized: true, authenticated: false,
  });
});

test("password route 改密后吊销旧 session，写入失败保留旧密码", async () => {
  const routes = await loadRoutes();
  const auth = await loadSubject();
  await auth.initializeAuth("setup-token", "old-password");
  const token = auth.createSession();
  const headers = { cookie: `pi_web_session=${token}` };

  const changed = await routes.password.POST(jsonRequest("http://localhost/api/auth/password", {
    currentPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password",
  }, headers));
  assert.equal(changed.status, 200);
  assert.equal(auth.getSession(token).valid, false);
  assert.equal(await auth.verifyPassword("new-password"), true);
  const replacement = auth.createSession();
  const replacementHeaders = { cookie: `pi_web_session=${replacement}` };

  const originalPath = process.env.PI_WEB_AUTH_CONFIG_PATH;
  const brokenParent = join(configDirectory, "route-password-broken-parent");
  await writeFile(brokenParent, "not-a-directory");
  process.env.PI_WEB_AUTH_CONFIG_PATH = join(brokenParent, "auth.json");
  try {
    const failed = await routes.password.POST(jsonRequest("http://localhost/api/auth/password", {
      currentPassword: "new-password", newPassword: "third-password", confirmPassword: "third-password",
    }, replacementHeaders));
    assert.equal(failed.status, 500);
  } finally {
    process.env.PI_WEB_AUTH_CONFIG_PATH = originalPath;
    await rm(brokenParent, { force: true });
  }
  assert.equal(await auth.verifyPassword("new-password"), true);
});

test("所有 JSON route 拒绝错误 Content-Type 和超大 body", async () => {
  const routes = await loadRoutes();
  for (const route of [routes.setup, routes.login, routes.logout, routes.password]) {
    const response = await route.POST(new Request("http://localhost/api/auth/test", {
      method: "POST", headers: { "content-type": "text/plain", cookie: "pi_web_session=invalid" }, body: "{}",
    }));
    assert.equal(response.status, 415);
  }
  const response = await routes.login.POST(new Request("http://localhost/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "x".repeat(20_000) }),
  }));
  assert.equal(response.status, 413);
});

test("logout 和 password 在认证判断前拒绝无 Content-Length 的超大 body", async () => {
  const routes = await loadRoutes();
  const logout = await routes.logout.POST(oversizedStreamingRequest("http://localhost/api/auth/logout"));
  assert.equal(logout.status, 413);

  const password = await routes.password.POST(oversizedStreamingRequest("http://localhost/api/auth/password"));
  assert.equal(password.status, 413);
});

test("所有 JSON route 拒绝带参数的非法 media type", async () => {
  const routes = await loadRoutes();
  for (const route of [routes.setup, routes.login, routes.logout, routes.password]) {
    const response = await route.POST(new Request("http://localhost/api/auth/test", {
      method: "POST",
      headers: { "content-type": "application/jsonfoo", cookie: "pi_web_session=invalid" },
      body: "{}",
    }));
    assert.equal(response.status, 415);
  }
});

test("setup route 服务端拒绝弱密码并返回统一错误", async () => {
  const { setup } = await loadRoutes();
  const response = await setup.POST(jsonRequest("http://localhost/api/auth/setup", {
    token: "setup-token", password: "short", confirmPassword: "short",
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "密码格式无效" });
});
