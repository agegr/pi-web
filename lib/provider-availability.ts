import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const MODELS_UI_STATE_FILE = "models-ui.json";

export interface ModelsUiState {
  disabledProviders: string[];
}

export function normalizeDisabledProviders(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const name = entry.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

export function getModelsUiPath(agentDir = getAgentDir()): string {
  return join(agentDir, MODELS_UI_STATE_FILE);
}

export function readModelsUiState(agentDir = getAgentDir()): ModelsUiState {
  try {
    const path = getModelsUiPath(agentDir);
    if (!existsSync(path)) return { disabledProviders: [] };
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { disabledProviders?: unknown };
    return { disabledProviders: normalizeDisabledProviders(parsed.disabledProviders) };
  } catch {
    return { disabledProviders: [] };
  }
}

export function getDisabledProviders(agentDir = getAgentDir()): ReadonlySet<string> {
  return new Set(readModelsUiState(agentDir).disabledProviders);
}
