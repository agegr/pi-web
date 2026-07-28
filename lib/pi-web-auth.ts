import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { lstatSync, readFileSync } from "node:fs";
import { randomBytes, scrypt as scryptCallback, createHash, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";

const scrypt = (password: string, salt: Buffer, keyLength: number, options: typeof SCRYPT_CONFIG): Promise<Buffer> => new Promise((resolve, reject) => {
  scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
    if (error) reject(error);
    else resolve(derivedKey as Buffer);
  });
});
const SESSION_TTL = 24 * 60 * 60 * 1000;
const SOURCE_FAILURE_LIMIT = 5;
const GLOBAL_FAILURE_LIMIT = 100;
const MAX_CONCURRENT_LOGIN_ATTEMPTS = 4;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const SCRYPT_CONFIG = { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 } as const;
const COMMON_WEAK_PASSWORDS = new Set(["password", "password1", "12345678", "qwertyui", "letmein", "admin"]);

interface StoredAuthConfig {
  algorithm?: "scrypt";
  algorithmVersion?: 1;
  scrypt?: typeof SCRYPT_CONFIG;
  passwordHash: string;
  salt: string;
  generation: number;
  updatedAt: string;
}

/** 对调用方公开的认证状态，不包含密码凭据。 */
export interface AuthState {
  /** 是否已经完成认证初始化。 */
  initialized: boolean;
  /** 当前密码代次。 */
  generation: number;
  /** 配置最后更新时间。 */
  updatedAt?: string;
}

/** Session 校验结果。 */
export interface SessionValidation {
  /** session 是否有效。 */
  valid: boolean;
  /** 有效 session 使用的密码代次。 */
  generation?: number;
}

/** 登录限速判定结果。 */
export interface RateLimitDecision {
  /** 当前请求是否允许继续。 */
  allowed: boolean;
  /** 被拒绝时的剩余等待时间，单位为毫秒。 */
  retryAfterMs?: number;
  /** 允许请求前建议等待的渐进延迟，单位为毫秒。 */
  delayMs?: number;
}

interface SessionRecord {
  hash: string;
  createdAt: number;
  expiresAt: number;
  generation: number;
}

type SessionInvalidationListener = () => void;

interface AuthRuntimeState {
  sessionInvalidationListeners: Map<string, Set<SessionInvalidationListener>>;
  sessionInvalidationTimeouts: Map<string, ReturnType<typeof setTimeout>>;
  loginFailures: Map<string, { count: number; firstFailureAt: number }>;
  globalLoginFailures: { count: number; firstFailureAt: number } | null;
  activeLoginAttempts: number;
  authMutationQueue: Promise<void>;
  authGeneration: number;
  generationInitialized: boolean;
  initializationInProgress: boolean;
}

declare global {
  var __piWebAuthSetupState: { token: string | null; announced: boolean } | undefined;
  var __piWebAuthSessions: Map<string, SessionRecord> | undefined;
  var __piWebAuthRuntime: AuthRuntimeState | undefined;
}

const sessions = globalThis.__piWebAuthSessions ??= new Map<string, SessionRecord>();
const runtime = globalThis.__piWebAuthRuntime ??= {
  sessionInvalidationListeners: new Map(),
  sessionInvalidationTimeouts: new Map(),
  loginFailures: new Map(),
  globalLoginFailures: null,
  activeLoginAttempts: 0,
  authMutationQueue: Promise.resolve(),
  authGeneration: 1,
  generationInitialized: false,
  initializationInProgress: false,
};
runtime.activeLoginAttempts ??= 0;
const sessionInvalidationListeners = runtime.sessionInvalidationListeners;
const sessionInvalidationTimeouts = runtime.sessionInvalidationTimeouts;
const loginFailures = runtime.loginFailures;
// 使用 globalThis 让 instrumentation 和 API route 的独立 server bundle 共享首启 token。
const setupState = globalThis.__piWebAuthSetupState ??= {
  // brief 要求 token 在模块首次加载时生成；已有配置时不创建初始化凭据。
  token: configPathExists() ? null : randomBytes(32).toString("hex"),
  announced: false,
};

function configPath(): string {
  return process.env.PI_WEB_AUTH_CONFIG_PATH || join(
    process.env.PI_CODING_AGENT_DIR || join(process.env.HOME ?? ".", ".pi", "agent"),
    "pi-web-auth.json",
  );
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function readConfig(): Promise<StoredAuthConfig | null> {
  try {
    if (configPathExists() && !hasRegularConfigFile()) {
      throw new Error("认证配置路径不是普通文件");
    }
  const parsed: unknown = JSON.parse(await readFile(configPath(), "utf8"));
    validateConfig(parsed);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readConfigForInitialization(): Promise<StoredAuthConfig | null> {
  return await readConfig();
}

function validateConfig(value: unknown): asserts value is StoredAuthConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("认证配置结构无效");
  }
  const config = value as Record<string, unknown>;
  const keys = Object.keys(config).sort().join(",");
  const legacy = keys === "generation,passwordHash,salt,updatedAt";
  const versioned = keys === "algorithm,algorithmVersion,generation,passwordHash,salt,scrypt,updatedAt";
  if ((!legacy && !versioned) ||
    (versioned && (config.algorithm !== "scrypt" || config.algorithmVersion !== 1 || !isScryptConfig(config.scrypt))) ||
    typeof config.passwordHash !== "string" || !/^[0-9a-f]+$/i.test(config.passwordHash) || config.passwordHash.length !== 128 ||
    typeof config.salt !== "string" || !/^[0-9a-f]+$/i.test(config.salt) || config.salt.length !== 32 ||
    typeof config.generation !== "number" || !Number.isSafeInteger(config.generation) || config.generation < 1 ||
    typeof config.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(config.updatedAt) || !Number.isFinite(Date.parse(config.updatedAt))) {
    throw new Error("认证配置结构无效");
  }
}

function isScryptConfig(value: unknown): value is typeof SCRYPT_CONFIG {
  return typeof value === "object" && value !== null
    && (value as Record<string, unknown>).N === SCRYPT_CONFIG.N
    && (value as Record<string, unknown>).r === SCRYPT_CONFIG.r
    && (value as Record<string, unknown>).p === SCRYPT_CONFIG.p
    && (value as Record<string, unknown>).maxmem === SCRYPT_CONFIG.maxmem;
}

function getScryptConfig(config: StoredAuthConfig): typeof SCRYPT_CONFIG {
  return config.scrypt && isScryptConfig(config.scrypt) ? config.scrypt : SCRYPT_CONFIG;
}

function validatePassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH
    || /^([\s\S])\1+$/.test(password) || COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) {
    throw new Error("密码格式无效");
  }
}

function hasRegularConfigFile(): boolean {
  try {
    return lstatSync(configPath()).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function configPathExists(): boolean {
  try {
    lstatSync(configPath());
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function writeConfig(config: StoredAuthConfig): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

/** 返回认证配置文件的实际路径。
 * @returns 认证配置文件路径。
 */
export function getAuthConfigPath(): string {
  return configPath();
}

/** 在服务端启动输出一次性初始化 token；不会通过 HTTP 或持久化配置暴露。
 * @returns 无返回值。
 */
export function announceSetupToken(): void {
  if (setupState.announced) return;
  if (configPathExists()) {
    try {
      if (!hasRegularConfigFile()) throw new Error("认证配置路径不是普通文件");
      validateConfig(JSON.parse(readFileSync(configPath(), "utf8")));
    } catch {
      setupState.announced = true;
      console.error(`[pi-web] 认证配置损坏，拒绝自动重置。请停止服务后备份或修复配置文件：${configPath()}`);
    }
    return;
  }
  if (setupState.token === null) return;
  setupState.announced = true;
  console.error(`[pi-web] Pi Web setup token: ${setupState.token}`);
}

/** 读取认证状态；配置损坏或其他读取错误会直接抛出。
 * @returns 不包含凭据的认证状态。
 * @throws 配置文件读取失败或 JSON 损坏时抛出原始错误。
 */
export async function getAuthState(): Promise<AuthState> {
  await runtime.authMutationQueue;
  const config = await readConfig();
  if (!config) return { initialized: false, generation: 0 };
  return { initialized: true, generation: config.generation, updatedAt: config.updatedAt };
}

/** 使用一次性初始化 token 设置密码并持久化认证配置。
 * @param token 一次性初始化 token。
 * @param password 要设置的密码。
 * @returns 配置写入完成的 Promise。
 * @throws token 无效、认证已初始化或配置写入失败时抛出错误。
 */
export async function initializeAuth(token: string, password: string): Promise<void> {
  const operation = runtime.authMutationQueue.then(() => initializeAuthNow(token, password), () => initializeAuthNow(token, password));
  runtime.authMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function initializeAuthNow(token: string, password: string): Promise<void> {
  if (runtime.initializationInProgress) throw new Error("认证初始化进行中");
  runtime.initializationInProgress = true;
  let tokenConsumed = false;
  let writeAttempted = false;
  let configWriteCompleted = false;
  try {
    validatePassword(password);
    const existing = await readConfigForInitialization();
    if (existing) throw new Error("认证已经初始化");
    if (!consumeSetupToken(token)) throw new Error("初始化 token 无效");
    tokenConsumed = true;
    const salt = randomBytes(16);
    const derived = await scrypt(password, salt, 64, SCRYPT_CONFIG) as Buffer;
    // 在耗时的哈希计算后再次检查，避免并发请求覆盖已创建的配置。
    if (await readConfigForInitialization()) throw new Error("认证已经初始化");
    writeAttempted = true;
    await writeConfig({
        algorithm: "scrypt",
        algorithmVersion: 1,
        scrypt: SCRYPT_CONFIG,
        passwordHash: derived.toString("hex"),
      salt: salt.toString("hex"),
      generation: runtime.authGeneration + 1,
      updatedAt: new Date().toISOString(),
    });
    configWriteCompleted = true;
    sessions.clear();
    notifyAllSessionInvalidations();
    bumpGeneration();
  } catch (error) {
    if (tokenConsumed && writeAttempted && !configWriteCompleted) setupState.token = token;
    throw error;
  } finally {
    runtime.initializationInProgress = false;
  }
}

/** 校验密码，认证配置不存在时返回 false，读取损坏配置时抛出错误。
 * @param password 待校验的密码。
 * @returns 密码是否匹配。
 * @throws 配置文件读取失败或 JSON 损坏时抛出原始错误。
 */
export async function verifyPassword(password: string): Promise<boolean> {
  return await runtime.authMutationQueue.then(() => verifyPasswordNow(password), () => verifyPasswordNow(password));
}

async function verifyPasswordNow(password: string): Promise<boolean> {
  const config = await readConfig();
  if (!config) return false;
  const expected = Buffer.from(config.passwordHash, "hex");
  const actual = await scrypt(password, Buffer.from(config.salt, "hex"), expected.length, getScryptConfig(config)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** 串行校验密码并创建 session，避免与改密事务交错。
 * @param password 待校验的密码。
 * @returns 成功时返回 session token，失败时返回 null。
 */
export async function authenticateAndCreateSession(password: string): Promise<string | null> {
  const operation = runtime.authMutationQueue.then(async () => {
    const config = await readConfig();
    if (!config || !(await verifyPasswordNow(password))) return null;
    return createSessionForGeneration(config.generation);
  }, async () => null);
  runtime.authMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

/** 原子更新密码并吊销全部已有 session。
 * @param currentPassword 当前密码。
 * @param newPassword 新密码。
 * @returns 密码更新完成的 Promise。
 * @throws 当前密码错误、认证未初始化或配置写入失败时抛出错误；写入失败不会改变旧密码。
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const operation = runtime.authMutationQueue.then(
    () => changePasswordNow(currentPassword, newPassword),
    () => changePasswordNow(currentPassword, newPassword),
  );
  runtime.authMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function changePasswordNow(currentPassword: string, newPassword: string): Promise<void> {
  validatePassword(newPassword);
  const config = await readConfig();
  if (!config) throw new Error("认证尚未初始化");
  const expected = Buffer.from(config.passwordHash, "hex");
  const actual = await scrypt(currentPassword, Buffer.from(config.salt, "hex"), expected.length, getScryptConfig(config)) as Buffer;
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("当前密码错误");
  }
  const salt = randomBytes(16);
  const derived = await scrypt(newPassword, salt, 64, SCRYPT_CONFIG) as Buffer;
  await writeConfig({
    ...config,
    algorithm: "scrypt",
    algorithmVersion: 1,
    scrypt: SCRYPT_CONFIG,
    passwordHash: derived.toString("hex"),
    salt: salt.toString("hex"),
    generation: config.generation + 1,
    updatedAt: new Date().toISOString(),
  });
  sessions.clear();
  notifyAllSessionInvalidations();
  runtime.authGeneration = config.generation + 1;
  runtime.generationInitialized = true;
}

/** 创建一个仅以哈希形式保存在内存中的 session，并返回原始 token。
 * @returns 仅供 cookie 使用的原始随机 token。
 */
export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const stateGeneration = currentGeneration();
  return storeSession(token, now, stateGeneration);
}

function createSessionForGeneration(stateGeneration: number): string {
  const token = randomBytes(32).toString("hex");
  return storeSession(token, Date.now(), stateGeneration);
}

function storeSession(token: string, now: number, stateGeneration: number): string {
  const tokenHash = hashToken(token);
  sessions.set(tokenHash, {
    hash: tokenHash,
    createdAt: now,
    expiresAt: now + SESSION_TTL,
    generation: stateGeneration,
  });
  return token;
}

/** 校验 session 的存在性、过期时间和密码代次。
 * @param token 要校验的原始 session token。
 * @returns session 校验结果。
 */
export function getSession(token: string): SessionValidation {
  const record = sessions.get(hashToken(token));
  if (!record || record.expiresAt <= Date.now() || record.generation !== currentGeneration()) {
    if (record) sessions.delete(record.hash);
    return { valid: false };
  }
  return { valid: true, generation: record.generation };
}

/** 增加密码代次、持久化认证配置并使全部已有 session 失效。
 * @returns 吊销和配置写入完成的 Promise。
 * @throws 认证配置读取或原子写入失败时抛出错误；失败时内存代次和 session 保持不变。
 */
export async function revokeAllSessions(): Promise<void> {
  const operation = runtime.authMutationQueue.then(revokeAllSessionsNow, revokeAllSessionsNow);
  runtime.authMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function revokeAllSessionsNow(): Promise<void> {
  const previousGeneration = runtime.authGeneration;
  const previousInitialization = runtime.generationInitialized;
  const config = syncGenerationFromConfig();
  if (!config) {
    sessions.clear();
    notifyAllSessionInvalidations();
    bumpGeneration();
    return;
  }

  const nextGeneration = config.generation + 1;
  try {
    await writeConfig({
      ...config,
      generation: nextGeneration,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    runtime.authGeneration = previousGeneration;
    runtime.generationInitialized = previousInitialization;
    throw error;
  }
  sessions.clear();
  notifyAllSessionInvalidations();
  runtime.authGeneration = nextGeneration;
  runtime.generationInitialized = true;
}

/** 使指定 session 失效。
 * @param token 要失效的原始 session token。
 * @returns 无返回值。
 * @throws 当前实现不会主动抛出异常。
 */
export function revokeSession(token: string): void {
  const tokenHash = hashToken(token);
  sessions.delete(tokenHash);
  notifySessionInvalidation(tokenHash);
}

/** 订阅指定 Web session 的失效事件；不会触碰 AgentSession 生命周期。
 * @param token 要监听的原始 Web session token。
 * @param listener session 失效时调用的回调。
 * @returns 取消订阅函数；可安全重复调用。
 */
export function subscribeSessionInvalidation(token: string, listener: SessionInvalidationListener): () => void {
  const tokenHash = hashToken(token);
  const record = sessions.get(tokenHash);
  if (!record || record.expiresAt <= Date.now() || record.generation !== currentGeneration()) {
    listener();
    return () => {};
  }
  let listeners = sessionInvalidationListeners.get(tokenHash);
  if (!listeners) {
    listeners = new Set();
    sessionInvalidationListeners.set(tokenHash, listeners);
  }
  listeners.add(listener);
  if (!sessionInvalidationTimeouts.has(tokenHash)) {
    const timeout = setTimeout(() => notifySessionInvalidation(tokenHash), Math.max(0, record.expiresAt - Date.now()));
    sessionInvalidationTimeouts.set(tokenHash, timeout);
  }
  const unsubscribe = () => {
    const current = sessionInvalidationListeners.get(tokenHash);
    current?.delete(listener);
    if (current?.size === 0) {
      sessionInvalidationListeners.delete(tokenHash);
      clearTimeout(sessionInvalidationTimeouts.get(tokenHash));
      sessionInvalidationTimeouts.delete(tokenHash);
    }
  };
  return unsubscribe;
}

function notifySessionInvalidation(tokenHash: string): void {
  clearTimeout(sessionInvalidationTimeouts.get(tokenHash));
  sessionInvalidationTimeouts.delete(tokenHash);
  const listeners = sessionInvalidationListeners.get(tokenHash);
  if (!listeners) return;
  sessionInvalidationListeners.delete(tokenHash);
  for (const listener of listeners) listener();
}

function notifyAllSessionInvalidations(): void {
  for (const tokenHash of sessionInvalidationListeners.keys()) notifySessionInvalidation(tokenHash);
}

/** 消费一次性初始化 token；成功后该 token 会从内存删除。
 * @param token 待消费的初始化 token。
 * @returns token 是否有效且已成功消费。
 */
export function consumeSetupToken(token: string): boolean {
  if (configPathExists()) {
    setupState.token = null;
    return false;
  }
  if (setupState.token === null || token !== setupState.token) return false;
  setupState.token = null;
  return true;
}

/** 判断来源是否仍可尝试登录。
 * @param key 登录来源标识。
 * @returns 当前限速判定和可选的重试等待时间。
 */
export function checkLoginRateLimit(key: string): RateLimitDecision {
  const now = Date.now();
  for (const [source, failure] of loginFailures) {
    if (now - failure.firstFailureAt >= RATE_LIMIT_WINDOW) loginFailures.delete(source);
  }
  const globalFailure = runtime.globalLoginFailures;
  if (globalFailure && now - globalFailure.firstFailureAt >= RATE_LIMIT_WINDOW) {
    runtime.globalLoginFailures = null;
  }
  const activeFailure = loginFailures.get(key);
  if (key !== "anonymous" && activeFailure && activeFailure.count >= SOURCE_FAILURE_LIMIT) {
    return { allowed: false, retryAfterMs: RATE_LIMIT_WINDOW - (now - activeFailure.firstFailureAt) };
  }
  const activeGlobalFailure = runtime.globalLoginFailures;
  if (activeGlobalFailure && activeGlobalFailure.count >= GLOBAL_FAILURE_LIMIT) {
    return { allowed: false, retryAfterMs: RATE_LIMIT_WINDOW - (now - activeGlobalFailure.firstFailureAt) };
  }
  return { allowed: true, delayMs: activeFailure ? Math.min(activeFailure.count * 100, 500) : 0 };
}

/** 在密码校验前原子预留一次登录尝试配额。
 * @param key 登录来源标识。
 * @returns 当前限速判定和可选的重试等待时间。
 */
export function beginLoginAttempt(key: string): RateLimitDecision {
  const decision = checkLoginRateLimit(key);
  if (!decision.allowed) return decision;
  if (runtime.activeLoginAttempts >= MAX_CONCURRENT_LOGIN_ATTEMPTS) {
    return { allowed: false, retryAfterMs: 1000 };
  }
  runtime.activeLoginAttempts += 1;
  return decision;
}

/** 释放登录尝试配额，并按需记录凭据失败。
 * @param key 登录来源标识。
 * @param failed 是否为凭据校验失败。
 * @returns 无返回值。
 */
export function finishLoginAttempt(key: string, failed: boolean): void {
  runtime.activeLoginAttempts = Math.max(0, runtime.activeLoginAttempts - 1);
  if (failed) recordLoginFailure(key);
}

/** 记录一次登录失败。
 * @param key 登录来源标识。
 * @returns 无返回值。
 */
export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const existing = loginFailures.get(key);
  if (!existing || now - existing.firstFailureAt >= RATE_LIMIT_WINDOW) {
    loginFailures.set(key, { count: 1, firstFailureAt: now });
  } else {
    existing.count += 1;
  }
  if (!runtime.globalLoginFailures || now - runtime.globalLoginFailures.firstFailureAt >= RATE_LIMIT_WINDOW) {
    runtime.globalLoginFailures = { count: 1, firstFailureAt: now };
  } else {
    runtime.globalLoginFailures.count += 1;
  }
}

function currentGeneration(): number {
  if (!runtime.generationInitialized) syncGenerationFromConfig();
  return runtime.authGeneration;
}

function syncGenerationFromConfig(): StoredAuthConfig | null {
  try {
    if (configPathExists() && !hasRegularConfigFile()) {
      throw new Error("认证配置路径不是普通文件");
    }
    const content = readFileSync(configPath(), "utf8");
    const parsed: unknown = JSON.parse(content);
    validateConfig(parsed);
    runtime.authGeneration = parsed.generation;
    runtime.generationInitialized = true;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      runtime.generationInitialized = true;
      return null;
    }
    throw error;
  }
}

function bumpGeneration(): void {
  runtime.authGeneration += 1;
}

/** 清理测试状态；仅供测试使用。
 * @returns 清理完成的 Promise。
 * @throws 删除测试配置失败时抛出错误。
 */
export async function resetAuthStateForTests(): Promise<void> {
  sessions.clear();
  notifyAllSessionInvalidations();
  loginFailures.clear();
  runtime.globalLoginFailures = null;
  runtime.activeLoginAttempts = 0;
  setupState.token = "setup-token";
  setupState.announced = false;
  runtime.authGeneration = 1;
  runtime.generationInitialized = false;
  runtime.initializationInProgress = false;
  runtime.authMutationQueue = Promise.resolve();
  await import("node:fs/promises").then(({ unlink }) => unlink(configPath()).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  }));
}

/** 返回当前进程中的初始化 token，仅供测试验证熵值。
 * @returns 初始化 token。
 */
export function getSetupTokenForTests(): string {
  if (configPathExists() && !hasRegularConfigFile()) throw new Error("认证配置损坏");
  if (hasRegularConfigFile()) throw new Error("认证已经初始化");
  if (setupState.token === null) throw new Error("初始化 token 不可用");
  return setupState.token;
}
