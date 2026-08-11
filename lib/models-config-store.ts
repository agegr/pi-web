import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { invalidateModelsCache } from "./models-cache";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeModelsConfig(data: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(data.providers)) return data;

  const providers = Object.fromEntries(Object.entries(data.providers).map(([providerId, provider]) => {
    if (!isRecord(provider) || !Array.isArray(provider.models)) return [providerId, provider];
    const models = provider.models.filter((model) => (
      !isRecord(model) || typeof model.id !== "string" || model.id.trim().length > 0
    ));
    return [providerId, { ...provider, models }];
  }));

  return { ...data, providers };
}

export function getModelsConfigPath(): string {
  return join(getAgentDir(), "models.json");
}

export function readModelsConfig(
  modelsPath = getModelsConfigPath(),
): Record<string, unknown> {
  if (!existsSync(modelsPath)) return { providers: {} };
  try {
    return JSON.parse(readFileSync(modelsPath, "utf8")) as Record<string, unknown>;
  } catch {
    return { providers: {} };
  }
}

export function writeModelsConfig(
  data: Record<string, unknown>,
  modelsPath = getModelsConfigPath(),
): void {
  const dir = dirname(modelsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writePrivateFileAtomicSync(modelsPath, JSON.stringify(sanitizeModelsConfig(data), null, 2));
  invalidateModelsCache();
}
