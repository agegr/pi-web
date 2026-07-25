import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { randomBytes, scrypt as scryptCallback, createHash, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { dirname, join } from "node:path";

const scrypt = promisify(scryptCallback);
const SESSION_TTL = 24 * 60 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;

interface StoredAuthConfig {
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
}

interface SessionRecord {
  hash: string;
  createdAt: number;
  expiresAt: number;
  generation: number;
}

const sessions = new Map<string, SessionRecord>();
const loginFailures = new Map<string, { count: number; firstFailureAt: number }>();
let globalLoginFailures: { count: number; firstFailureAt: number } | null = null;
// brief 要求 token 在模块首次加载时生成；已有配置时不创建初始化凭据。
let setupToken: string | null = hasRegularConfigFile() ? null : randomBytes(32).toString("hex");
let setupTokenAnnounced = false;

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
  if (Object.keys(config).sort().join(",") !== "generation,passwordHash,salt,updatedAt" ||
    typeof config.passwordHash !== "string" || !/^[0-9a-f]+$/i.test(config.passwordHash) || config.passwordHash.length !== 128 ||
    typeof config.salt !== "string" || !/^[0-9a-f]+$/i.test(config.salt) || config.salt.length !== 32 ||
    typeof config.generation !== "number" || !Number.isSafeInteger(config.generation) || config.generation < 1 ||
    typeof config.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(config.updatedAt) || !Number.isFinite(Date.parse(config.updatedAt))) {
    throw new Error("认证配置结构无效");
  }
}

function hasRegularConfigFile(): boolean {
  try {
    return statSync(configPath()).isFile();
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
  if (setupTokenAnnounced || setupToken === null || hasRegularConfigFile()) return;
  setupTokenAnnounced = true;
  console.error(`[pi-web] Pi Web setup token: ${setupToken}`);
}

/** 读取认证状态；配置损坏或其他读取错误会直接抛出。
 * @returns 不包含凭据的认证状态。
 * @throws 配置文件读取失败或 JSON 损坏时抛出原始错误。
 */
export async function getAuthState(): Promise<AuthState> {
  await authMutationQueue;
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
  const operation = authMutationQueue.then(() => initializeAuthNow(token, password), () => initializeAuthNow(token, password));
  authMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function initializeAuthNow(token: string, password: string): Promise<void> {
  if (initializationInProgress) throw new Error("认证初始化进行中");
  initializationInProgress = true;
  let tokenConsumed = false;
  let writeAttempted = false;
  let configWriteCompleted = false;
  try {
    const existing = await readConfigForInitialization();
    if (existing) throw new Error("认证已经初始化");
    if (!consumeSetupToken(token)) throw new Error("初始化 token 无效");
    tokenConsumed = true;
    const salt = randomBytes(16);
    const derived = await scrypt(password, salt, 64) as Buffer;
    // 在耗时的哈希计算后再次检查，避免并发请求覆盖已创建的配置。
    if (await readConfigForInitialization()) throw new Error("认证已经初始化");
    writeAttempted = true;
    await writeConfig({
      passwordHash: derived.toString("hex"),
      salt: salt.toString("hex"),
      generation: authGeneration + 1,
      updatedAt: new Date().toISOString(),
    });
    configWriteCompleted = true;
    sessions.clear();
    bumpGeneration();
  } catch (error) {
    if (tokenConsumed && writeAttempted && !configWriteCompleted) setupToken = token;
    throw error;
  } finally {
    initializationInProgress = false;
  }
}

/** 校验密码，认证配置不存在时返回 false，读取损坏配置时抛出错误。
 * @param password 待校验的密码。
 * @returns 密码是否匹配。
 * @throws 配置文件读取失败或 JSON 损坏时抛出原始错误。
 */
export async function verifyPassword(password: string): Promise<boolean> {
  const config = await readConfig();
  if (!config) return false;
  const expected = Buffer.from(config.passwordHash, "hex");
  const actual = await scrypt(password, Buffer.from(config.salt, "hex"), expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** 原子更新密码并吊销全部已有 session。
 * @param currentPassword 当前密码。
 * @param newPassword 新密码。
 * @returns 密码更新完成的 Promise。
 * @throws 当前密码错误、认证未初始化或配置写入失败时抛出错误；写入失败不会改变旧密码。
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const operation = authMutationQueue.then(
    () => changePasswordNow(currentPassword, newPassword),
    () => changePasswordNow(currentPassword, newPassword),
  );
  authMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function changePasswordNow(currentPassword: string, newPassword: string): Promise<void> {
  const config = await readConfig();
  if (!config) throw new Error("认证尚未初始化");
  const expected = Buffer.from(config.passwordHash, "hex");
  const actual = await scrypt(currentPassword, Buffer.from(config.salt, "hex"), expected.length) as Buffer;
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("当前密码错误");
  }
  const salt = randomBytes(16);
  const derived = await scrypt(newPassword, salt, 64) as Buffer;
  await writeConfig({
    ...config,
    passwordHash: derived.toString("hex"),
    salt: salt.toString("hex"),
    generation: config.generation + 1,
    updatedAt: new Date().toISOString(),
  });
  sessions.clear();
  authGeneration = config.generation + 1;
  generationInitialized = true;
}

/** 创建一个仅以哈希形式保存在内存中的 session，并返回原始 token。
 * @returns 仅供 cookie 使用的原始随机 token。
 */
export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const stateGeneration = currentGeneration();
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
  const operation = authMutationQueue.then(revokeAllSessionsNow, revokeAllSessionsNow);
  authMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

let authMutationQueue: Promise<void> = Promise.resolve();

async function revokeAllSessionsNow(): Promise<void> {
  const previousGeneration = authGeneration;
  const previousInitialization = generationInitialized;
  const config = syncGenerationFromConfig();
  if (!config) {
    sessions.clear();
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
    authGeneration = previousGeneration;
    generationInitialized = previousInitialization;
    throw error;
  }
  sessions.clear();
  authGeneration = nextGeneration;
  generationInitialized = true;
}

/** 使指定 session 失效。
 * @param token 要失效的原始 session token。
 * @returns 无返回值。
 * @throws 当前实现不会主动抛出异常。
 */
export function revokeSession(token: string): void {
  sessions.delete(hashToken(token));
}

/** 消费一次性初始化 token；成功后该 token 会从内存删除。
 * @param token 待消费的初始化 token。
 * @returns token 是否有效且已成功消费。
 */
export function consumeSetupToken(token: string): boolean {
  if (hasRegularConfigFile()) {
    setupToken = null;
    return false;
  }
  if (setupToken === null || token !== setupToken) return false;
  setupToken = null;
  return true;
}

/** 判断来源是否仍可尝试登录。
 * @param key 登录来源标识。
 * @returns 当前限速判定和可选的重试等待时间。
 */
export function checkLoginRateLimit(key: string): RateLimitDecision {
  const failure = loginFailures.get(key);
  const now = Date.now();
  if (!failure || now - failure.firstFailureAt >= RATE_LIMIT_WINDOW) {
    if (failure) loginFailures.delete(key);
  }
  const globalFailure = globalLoginFailures;
  if (globalFailure && now - globalFailure.firstFailureAt >= RATE_LIMIT_WINDOW) {
    globalLoginFailures = null;
  }
  const activeFailure = loginFailures.get(key);
  if (activeFailure?.count >= MAX_LOGIN_FAILURES) {
    return { allowed: false, retryAfterMs: RATE_LIMIT_WINDOW - (now - activeFailure.firstFailureAt) };
  }
  if (globalLoginFailures?.count >= MAX_LOGIN_FAILURES) {
    return { allowed: false, retryAfterMs: RATE_LIMIT_WINDOW - (now - globalLoginFailures.firstFailureAt) };
  }
  return { allowed: true };
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
  if (!globalLoginFailures || now - globalLoginFailures.firstFailureAt >= RATE_LIMIT_WINDOW) {
    globalLoginFailures = { count: 1, firstFailureAt: now };
  } else {
    globalLoginFailures.count += 1;
  }
}

function currentGeneration(): number {
  if (!generationInitialized) syncGenerationFromConfig();
  return authGeneration;
}

let generationInitialized = false;

function syncGenerationFromConfig(): StoredAuthConfig | null {
  try {
    const content = readFileSync(configPath(), "utf8");
    const parsed: unknown = JSON.parse(content);
    validateConfig(parsed);
    authGeneration = parsed.generation;
    generationInitialized = true;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      generationInitialized = true;
      return null;
    }
    throw error;
  }
}

let authGeneration = 1;
let initializationInProgress = false;
function bumpGeneration(): void {
  authGeneration += 1;
}

/** 清理测试状态；仅供测试使用。
 * @returns 清理完成的 Promise。
 * @throws 删除测试配置失败时抛出错误。
 */
export async function resetAuthStateForTests(): Promise<void> {
  sessions.clear();
  loginFailures.clear();
  globalLoginFailures = null;
  setupToken = "setup-token";
  setupTokenAnnounced = false;
  authGeneration = 1;
  generationInitialized = false;
  initializationInProgress = false;
  authMutationQueue = Promise.resolve();
  await import("node:fs/promises").then(({ unlink }) => unlink(configPath()).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  }));
}

/** 返回当前进程中的初始化 token，仅供测试验证熵值。
 * @returns 初始化 token。
 */
export function getSetupTokenForTests(): string {
  if (hasRegularConfigFile()) throw new Error("认证已经初始化");
  if (setupToken === null) throw new Error("初始化 token 不可用");
  return setupToken;
}
