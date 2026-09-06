import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Credential } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import type { ProviderCredentialType } from "@/lib/provider-listing";

const AUTH_FILE_WRITE_OPTIONS = { encoding: "utf-8" as const, mode: 0o600 };

export type CredentialRemovalResult =
  | { status: "removed" }
  | { status: "not_found" }
  | { status: "type_mismatch"; storedType: string };

function ensureAuthFile(authPath: string): void {
  const parent = dirname(authPath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (!existsSync(authPath)) {
    writeFileSync(authPath, "{}", AUTH_FILE_WRITE_OPTIONS);
    chmodSync(authPath, 0o600);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function updateStoredCredentials<T>(
  authPath: string,
  update: (credentials: Record<string, unknown>) => { result: T; changed: boolean },
): Promise<T> {
  ensureAuthFile(authPath);

  let lockCompromisedError: Error | undefined;
  const release = await lockfile.lock(authPath, {
    retries: {
      retries: 10,
      factor: 2,
      minTimeout: 100,
      maxTimeout: 10_000,
      randomize: true,
    },
    stale: 30_000,
    onCompromised: (error) => {
      lockCompromisedError = error;
    },
  });

  const throwIfCompromised = () => {
    if (lockCompromisedError) throw lockCompromisedError;
  };

  try {
    throwIfCompromised();
    const parsed: unknown = JSON.parse(readFileSync(authPath, "utf-8"));
    if (!isRecord(parsed)) throw new Error("Invalid auth.json: expected an object");

    const { result, changed } = update(parsed);
    if (changed) {
      throwIfCompromised();
      writeFileSync(authPath, JSON.stringify(parsed, null, 2), AUTH_FILE_WRITE_OPTIONS);
      chmodSync(authPath, 0o600);
      throwIfCompromised();
    }
    return result;
  } finally {
    try {
      await release();
    } catch {
      // The compromised-lock error above is more useful than an unlock error.
    }
  }
}

/** Store a provider credential without triggering a model-catalog refresh. */
export function storeProviderCredential(
  providerId: string,
  credential: Credential,
  authPath = join(getAgentDir(), "auth.json"),
): Promise<void> {
  return updateStoredCredentials(authPath, (credentials) => {
    credentials[providerId] = credential;
    return { result: undefined, changed: true };
  });
}

/**
 * Removes a provider credential only when its current stored type matches.
 *
 * The comparison and write share the same proper-lockfile lock used by pi's
 * AuthStorage, so a concurrent login cannot be deleted by a stale UI request.
 */
export async function removeStoredCredentialIfType(
  providerId: string,
  expectedType: ProviderCredentialType,
  authPath = join(getAgentDir(), "auth.json"),
): Promise<CredentialRemovalResult> {
  return updateStoredCredentials<CredentialRemovalResult>(authPath, (credentials) => {
    if (!Object.hasOwn(credentials, providerId)) {
      return { result: { status: "not_found" }, changed: false };
    }

    const credential = credentials[providerId];
    const storedType = isRecord(credential) && typeof credential.type === "string"
      ? credential.type
      : "unknown";
    if (storedType !== expectedType) {
      return { result: { status: "type_mismatch", storedType }, changed: false };
    }

    delete credentials[providerId];
    return { result: { status: "removed" }, changed: true };
  });
}
