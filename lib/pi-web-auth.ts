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

/** Authentication state exposed to callers without password credentials. */
export interface AuthState {
  /** Whether authentication setup has completed. */
  initialized: boolean;
  /** Current password generation. */
  generation: number;
  /** Last configuration update time. */
  updatedAt?: string;
}

/** Session validation result. */
export interface SessionValidation {
  /** Whether the session is valid. */
  valid: boolean;
  /** Password generation used by the valid session. */
  generation?: number;
}

/** Login rate-limit decision. */
export interface RateLimitDecision {
  /** Whether the current request may continue. */
  allowed: boolean;
  /** Remaining wait time when rejected, in milliseconds. */
  retryAfterMs?: number;
  /** Suggested progressive delay before allowing the request, in milliseconds. */
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
// Use globalThis so the instrumentation and API route server bundles share the first-run token.
const setupState = globalThis.__piWebAuthSetupState ??= {
  // The brief requires generating the token on first module load; do not create credentials when config exists.
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
      throw new Error("Authentication config path is not a regular file");
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
    throw new Error("Invalid authentication config structure");
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
     throw new Error("Invalid authentication config structure");
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
    throw new Error("Invalid password format");
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

/** Return the actual authentication configuration file path.
 * @returns Authentication configuration file path.
 */
export function getAuthConfigPath(): string {
  return configPath();
}

/** Print the one-time setup token at server startup; it is not exposed over HTTP or persisted.
 * @returns Nothing.
 */
export function announceSetupToken(): void {
  if (setupState.announced) return;
  if (configPathExists()) {
    try {
      if (!hasRegularConfigFile()) throw new Error("Authentication config path is not a regular file");
      validateConfig(JSON.parse(readFileSync(configPath(), "utf8")));
    } catch {
      setupState.announced = true;
      console.error(`[pi-web] Authentication config is corrupt; refusing automatic reset. Stop the service, then back up or repair the config file: ${configPath()}`);
    }
    return;
  }
  if (setupState.token === null) return;
  setupState.announced = true;
  console.error(`[pi-web] Pi Web setup token: ${setupState.token}`);
}

/** Read authentication state; config corruption and other read errors are rethrown.
 * @returns Authentication state without credentials.
 * @throws Rethrows the original error when reading the config fails or its JSON is corrupt.
 */
export async function getAuthState(): Promise<AuthState> {
  await runtime.authMutationQueue;
  const config = await readConfig();
  if (!config) return { initialized: false, generation: 0 };
  return { initialized: true, generation: config.generation, updatedAt: config.updatedAt };
}

/** Set the password with a one-time setup token and persist authentication config.
 * @param token One-time setup token.
 * @param password Password to set.
 * @returns Promise fulfilled when the config is written.
 * @throws Throws when the token is invalid, authentication is already initialized, or config writing fails.
 */
export async function initializeAuth(token: string, password: string): Promise<void> {
  const operation = runtime.authMutationQueue.then(() => initializeAuthNow(token, password), () => initializeAuthNow(token, password));
  runtime.authMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function initializeAuthNow(token: string, password: string): Promise<void> {
  if (runtime.initializationInProgress) throw new Error("Authentication setup is already in progress");
  runtime.initializationInProgress = true;
  let tokenConsumed = false;
  let writeAttempted = false;
  let configWriteCompleted = false;
  try {
    validatePassword(password);
    const existing = await readConfigForInitialization();
    if (existing) throw new Error("Authentication is already initialized");
    if (!consumeSetupToken(token)) throw new Error("Invalid setup token");
    tokenConsumed = true;
    const salt = randomBytes(16);
    const derived = await scrypt(password, salt, 64, SCRYPT_CONFIG) as Buffer;
    // Recheck after the expensive hash to prevent concurrent requests from overwriting the config.
    if (await readConfigForInitialization()) throw new Error("Authentication is already initialized");
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

/** Verify a password; return false when config is absent and throw on corrupt config.
 * @param password Password to verify.
 * @returns Whether the password matches.
 * @throws Rethrows the original error when reading the config fails or its JSON is corrupt.
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

/** Verify the password and create a session serially to avoid interleaving with password changes.
 * @param password Password to verify.
 * @returns Session token on success, or null on failure.
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

/** Atomically update the password and revoke all existing sessions.
 * @param currentPassword Current password.
 * @param newPassword New password.
 * @returns Promise fulfilled when the password is updated.
 * @throws Throws when the current password is wrong, authentication is uninitialized, or config writing fails; a write failure leaves the old password unchanged.
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
  if (!config) throw new Error("Authentication is not initialized");
  const expected = Buffer.from(config.passwordHash, "hex");
  const actual = await scrypt(currentPassword, Buffer.from(config.salt, "hex"), expected.length, getScryptConfig(config)) as Buffer;
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Current password is incorrect");
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

/** Create a session stored only as a hash in memory and return the raw token.
 * @returns Raw random token intended only for the cookie.
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

/** Validate session existence, expiration, and password generation.
 * @param token Raw session token to validate.
 * @returns Session validation result.
 */
export function getSession(token: string): SessionValidation {
  const record = sessions.get(hashToken(token));
  if (!record || record.expiresAt <= Date.now() || record.generation !== currentGeneration()) {
    if (record) sessions.delete(record.hash);
    return { valid: false };
  }
  return { valid: true, generation: record.generation };
}

/** Increment the password generation, persist authentication config, and invalidate all existing sessions.
 * @returns Promise fulfilled when revocation and config writing complete.
 * @throws Throws when reading authentication config or atomically writing it fails; memory generation and sessions remain unchanged on failure.
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

/** Invalidate the specified session.
 * @param token Raw session token to invalidate.
 * @returns Nothing.
 * @throws The current implementation does not throw proactively.
 */
export function revokeSession(token: string): void {
  const tokenHash = hashToken(token);
  sessions.delete(tokenHash);
  notifySessionInvalidation(tokenHash);
}

/** Subscribe to invalidation events for a Web session without touching AgentSession lifecycle.
 * @param token Raw Web session token to monitor.
 * @param listener Callback invoked when the session is invalidated.
 * @returns Unsubscribe function that is safe to call repeatedly.
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

/** Consume a one-time setup token; remove it from memory after success.
 * @param token Setup token to consume.
 * @returns Whether the token was valid and successfully consumed.
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

/** Determine whether a source may still attempt to log in.
 * @param key Login source identifier.
 * @returns Current rate-limit decision and optional retry delay.
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

/** Atomically reserve a login attempt before password verification.
 * @param key Login source identifier.
 * @returns Current rate-limit decision and optional retry delay.
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

/** Release a login attempt slot and record credential failure when needed.
 * @param key Login source identifier.
 * @param failed Whether credential verification failed.
 * @returns Nothing.
 */
export function finishLoginAttempt(key: string, failed: boolean): void {
  runtime.activeLoginAttempts = Math.max(0, runtime.activeLoginAttempts - 1);
  if (failed) recordLoginFailure(key);
}

/** Record a login failure.
 * @param key Login source identifier.
 * @returns Nothing.
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
      throw new Error("Authentication config path is not a regular file");
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

/** Reset authentication state for tests only.
 * @returns Promise fulfilled when test config cleanup completes.
 * @throws Throws when deleting the test config fails.
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

/** Return the current process setup token for entropy tests only.
 * @returns Setup token.
 */
export function getSetupTokenForTests(): string {
  if (configPathExists() && !hasRegularConfigFile()) throw new Error("Authentication config is corrupt");
  if (hasRegularConfigFile()) throw new Error("Authentication is already initialized");
  if (setupState.token === null) throw new Error("Setup token is unavailable");
  return setupState.token;
}
