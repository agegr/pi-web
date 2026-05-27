import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

interface PiWebConfig {
  webToken?: string;
  remote?: boolean;
  cookieSecure?: boolean;
}

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function readUserEnv(): Record<string, string> {
  const envPath = join(homedir(), ".pi", "web.env");
  if (!existsSync(envPath)) return {};
  try {
    return parseEnvFile(readFileSync(envPath, "utf8"));
  } catch {
    return {};
  }
}

function readUserConfig(): PiWebConfig {
  const configPath = join(homedir(), ".pi", "web.json");
  if (!existsSync(configPath)) return {};
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    return {
      webToken: typeof raw.webToken === "string" ? raw.webToken : undefined,
      remote: typeof raw.remote === "boolean" ? raw.remote : undefined,
      cookieSecure: typeof raw.cookieSecure === "boolean" ? raw.cookieSecure : undefined,
    };
  } catch {
    return {};
  }
}

function envFlag(name: string): boolean | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  return undefined;
}

function stringFlag(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  return undefined;
}

export function getPiWebConfig(): Required<PiWebConfig> {
  const userEnv = readUserEnv();
  const userConfig = readUserConfig();
  return {
    webToken: process.env.WEB_TOKEN?.trim() || process.env.PI_WEB_TOKEN?.trim() || userEnv.WEB_TOKEN || userEnv.PI_WEB_TOKEN || userConfig.webToken || "",
    remote: envFlag("PI_WEB_REMOTE") ?? stringFlag(userEnv.PI_WEB_REMOTE) ?? userConfig.remote ?? false,
    cookieSecure: envFlag("PI_WEB_COOKIE_SECURE") ?? stringFlag(userEnv.PI_WEB_COOKIE_SECURE) ?? userConfig.cookieSecure ?? false,
  };
}
