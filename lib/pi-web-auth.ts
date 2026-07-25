import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
  initialized: boolean;
  generation: number;
  updatedAt?: string;
}

/** Session 校验结果。 */
export interface SessionValidation {
  valid: boolean;
  generation?: number;
}

/** 登录限速判定结果。 */
export interface RateLimitDecision {
  allowed: boolean;
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
let setupToken: string | null = existsSync(configPath()) ? null : randomBytes(32).toString("hex");

function configPath(): string {
  return process.env.PI_WEB_AUTH_CONFIG_PATH ?? join(process.env.HOME ?? ".", ".pi", "web-auth.json");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function readConfig(): Promise<StoredAuthConfig | null> {
  try {
    return JSON.parse(await readFile(configPath(), "utf8")) as StoredAuthConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeConfig(config: StoredAuthConfig): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
}

/** 返回认证配置文件的实际路径。
 * @returns 认证配置文件路径。
 */
export function getAuthConfigPath(): string {
  return configPath();
}

/** 读取认证状态；配置损坏或其他读取错误会直接抛出。
 * @returns 不包含凭据的认证状态。
 * @throws 配置文件读取失败或 JSON 损坏时抛出原始错误。
 */
export async function getAuthState(): Promise<AuthState> {
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
  const existing = await readConfig();
  if (existing) throw new Error("认证已经初始化");
  if (!consumeSetupToken(token)) throw new Error("初始化 token 无效");
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as Buffer;
  await writeConfig({
    passwordHash: derived.toString("hex"),
    salt: salt.toString("hex"),
    generation: 1,
    updatedAt: new Date().toISOString(),
  });
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

/** 创建一个仅以哈希形式保存在内存中的 session，并返回原始 token。
 * @returns 仅供 cookie 使用的原始随机 token。
 */
export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const stateGeneration = currentGeneration();
  sessions.set(hashToken(token), {
    hash: hashToken(token),
    createdAt: now,
    expiresAt: now + SESSION_TTL,
    generation: stateGeneration,
  });
  return token;
}

/** 校验 session 的存在性、过期时间和密码代次。 */
export function getSession(token: string): SessionValidation {
  const record = sessions.get(hashToken(token));
  if (!record || record.expiresAt <= Date.now() || record.generation !== currentGeneration()) {
    if (record) sessions.delete(record.hash);
    return { valid: false };
  }
  return { valid: true, generation: record.generation };
}

/** 增加密码代次并使全部已有 session 失效。 */
export function revokeAllSessions(): void {
  sessions.clear();
  void bumpGeneration();
}

/** 使指定 session 失效。
 * @param token 要失效的原始 session token。
 */
export function revokeSession(token: string): void {
  sessions.delete(hashToken(token));
}

/** 消费一次性初始化 token；成功后该 token 会从内存删除。
 * @param token 待消费的初始化 token。
 * @returns token 是否有效且已成功消费。
 */
export function consumeSetupToken(token: string): boolean {
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
  if (!failure || Date.now() - failure.firstFailureAt >= RATE_LIMIT_WINDOW) {
    if (failure) loginFailures.delete(key);
    return { allowed: true };
  }
  if (failure.count >= MAX_LOGIN_FAILURES) {
    return { allowed: false, retryAfterMs: RATE_LIMIT_WINDOW - (Date.now() - failure.firstFailureAt) };
  }
  return { allowed: true };
}

/** 记录一次登录失败。
 * @param key 登录来源标识。
 */
export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const existing = loginFailures.get(key);
  if (!existing || now - existing.firstFailureAt >= RATE_LIMIT_WINDOW) {
    loginFailures.set(key, { count: 1, firstFailureAt: now });
  } else {
    existing.count += 1;
  }
}

function currentGeneration(): number {
  return authGeneration;
}

let authGeneration = 1;
function bumpGeneration(): void {
  authGeneration += 1;
}

/** 清理测试状态；仅供测试使用。 */
export async function resetAuthStateForTests(): Promise<void> {
  sessions.clear();
  loginFailures.clear();
  setupToken = "setup-token";
  authGeneration = 1;
  const config = await readConfig();
  if (config) {
    const { unlink } = await import("node:fs/promises");
    await unlink(configPath());
  }
}
