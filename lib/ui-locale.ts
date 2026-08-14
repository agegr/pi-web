import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Locale } from "@/lib/i18n/types";

const FILE_NAME = "ui-locale";

export function parseUiLocale(value: unknown): Locale | null {
  return value === "en" || value === "zh-CN" ? value : null;
}

export function readUiLocale(agentDir = getAgentDir()): Locale | null {
  try {
    return parseUiLocale(readFileSync(join(agentDir, FILE_NAME), "utf8").trim());
  } catch {
    return null;
  }
}

export function writeUiLocale(value: unknown, agentDir = getAgentDir()): Locale | null {
  const locale = parseUiLocale(value);
  if (!locale) return null;
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, FILE_NAME), `${locale}\n`, "utf8");
  return locale;
}
