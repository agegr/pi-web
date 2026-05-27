import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { assertTrustedRequest } from "@/app/api/_security/api-auth";

export const dynamic = "force-dynamic";

const REDACTED_SECRET = "********";
const SECRET_KEY_RE = /(?:api[_-]?key|authorization|token|secret|password)/i;

function getModelsPath(): string {
  return join(getAgentDir(), "models.json");
}

function readModelsJson(): Record<string, unknown> {
  const path = getModelsPath();
  if (!existsSync(path)) return { providers: {} };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return { providers: {} };
  }
}

function writeModelsJson(data: Record<string, unknown>): void {
  const path = getModelsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function redactSecrets(value: unknown, key = ""): unknown {
  if (typeof value === "string" && SECRET_KEY_RE.test(key)) {
    return value ? REDACTED_SECRET : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactSecrets(entryValue, entryKey)]),
    );
  }
  return value;
}

function restoreRedactedSecrets(next: unknown, current: unknown): unknown {
  if (next === REDACTED_SECRET && typeof current === "string") {
    return current;
  }
  if (Array.isArray(next)) {
    const currentArray = Array.isArray(current) ? current : [];
    return next.map((item, index) => restoreRedactedSecrets(item, currentArray[index]));
  }
  if (isPlainObject(next)) {
    const currentObject = isPlainObject(current) ? current : {};
    return Object.fromEntries(
      Object.entries(next).map(([entryKey, entryValue]) => [
        entryKey,
        restoreRedactedSecrets(entryValue, currentObject[entryKey]),
      ]),
    );
  }
  return next;
}

export async function GET(req: Request) {
  const blocked = assertTrustedRequest(req);
  if (blocked) return blocked;

  return NextResponse.json(redactSecrets(readModelsJson()));
}

export async function PUT(req: Request) {
  const blocked = assertTrustedRequest(req);
  if (blocked) return blocked;

  try {
    const body = await req.json() as Record<string, unknown>;
    const current = readModelsJson();
    const next = restoreRedactedSecrets(body, current) as Record<string, unknown>;
    writeModelsJson(next);
    // Model registry refreshes on each /api/models request (no local cache to invalidate)
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
