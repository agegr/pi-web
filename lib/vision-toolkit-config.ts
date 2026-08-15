import { accessSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { writePrivateFileAtomicSync } from "./atomic-file";

export type VisionProtocol = "chat_completions" | "responses" | "anthropic";

export type VisionToolkitSettings = {
  protocol: VisionProtocol;
  baseUrl: string;
  model: string;
  language: "zh" | "en" | "";
};

export type VisionToolkitSnapshot = {
  schemaVersion: 1;
  configPath: string;
  writable: boolean;
  settings: VisionToolkitSettings;
  credential: { configured: boolean; source?: "file" | "env"; writable: boolean };
  install: {
    extension: { present: boolean; path: string };
    skill: { present: boolean; path: string };
  };
};

const PROTOCOLS = new Set<VisionProtocol>(["chat_completions", "responses", "anthropic"]);
const KNOWN_KEYS = [
  "VISION_API_PROTOCOL",
  "VISION_BASE_URL",
  "VISION_MODEL",
  "VISION_API_KEY",
  "LANG",
] as const;

type KnownKey = (typeof KNOWN_KEYS)[number];

function expandUser(filePath: string): string {
  if (filePath === "~") return homedir();
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return join(homedir(), filePath.slice(2));
  }
  return filePath;
}

export function visionEnvPath(): string {
  const override = process.env.VISION_ENV_FILE?.trim();
  if (override) return expandUser(override);
  return join(homedir(), ".config", "agent-vision-toolkit", "env");
}

export function visionExtensionPath(): string {
  return join(homedir(), ".pi", "agent", "extensions", "vision.ts");
}

export function visionSkillPath(): string {
  return join(homedir(), ".pi", "agent", "skills", "vision-tools", "SKILL.md");
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'" || first === "`") && first === last) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function parseAssignment(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return undefined;
  const eq = trimmed.indexOf("=");
  const key = trimmed.slice(0, eq).trim();
  if (!key) return undefined;
  return { key, value: stripQuotes(trimmed.slice(eq + 1).trim()) };
}

function readEnvMap(path: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const assignment = parseAssignment(line);
    if (assignment) values.set(assignment.key, assignment.value);
  }
  return values;
}

function asProtocol(value: string | undefined): VisionProtocol {
  const normalized = value?.trim().toLowerCase() ?? "";
  return PROTOCOLS.has(normalized as VisionProtocol) ? normalized as VisionProtocol : "chat_completions";
}

function asLanguage(value: string | undefined): "zh" | "en" | "" {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized === "zh" || normalized === "en" ? normalized : "";
}

function settingsFromMap(values: Map<string, string>): VisionToolkitSettings {
  return {
    protocol: asProtocol(values.get("VISION_API_PROTOCOL")),
    baseUrl: values.get("VISION_BASE_URL")?.trim() ?? "",
    model: values.get("VISION_MODEL")?.trim() ?? "",
    language: asLanguage(values.get("LANG")),
  };
}

function fileKey(values: Map<string, string>): string {
  return values.get("VISION_API_KEY")?.trim() ?? "";
}

function processEnvKey(): string {
  return process.env.VISION_API_KEY?.trim() ?? "";
}

function canWrite(path: string): boolean {
  try {
    if (existsSync(path)) {
      accessSync(path, constants.W_OK);
      return true;
    }
    const parent = dirname(path);
    if (existsSync(parent)) {
      accessSync(parent, constants.W_OK);
      return true;
    }
    return true;
  } catch {
    return false;
  }
}

function credentialState(values: Map<string, string>, writable: boolean): VisionToolkitSnapshot["credential"] {
  if (fileKey(values)) {
    return { configured: true, source: "file", writable };
  }
  if (processEnvKey()) {
    return { configured: true, source: "env", writable: false };
  }
  return { configured: false, writable };
}

export function validateApiKey(raw: string): string | undefined {
  if (raw.length === 0) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "The API key cannot contain only spaces.";
  const quote = trimmed[0];
  const quoted = trimmed.length > 1
    && (quote === '"' || quote === "'" || quote === "`")
    && trimmed.endsWith(quote);
  const environmentLine = /^[A-Z][A-Z0-9_]*=[^=]/.test(trimmed);
  if (quoted || environmentLine || !/^[\x21-\x7E]+$/.test(trimmed)) {
    return "Paste only the key, without a variable name, quotes, spaces, or line breaks.";
  }
  return undefined;
}

export function readStoredVisionApiKey(): string | undefined {
  const fromFile = fileKey(readEnvMap(visionEnvPath()));
  if (fromFile) return fromFile;
  return processEnvKey() || undefined;
}

export function readVisionToolkitSnapshot(): VisionToolkitSnapshot {
  const configPath = visionEnvPath();
  const values = readEnvMap(configPath);
  const writable = canWrite(configPath);
  const extension = visionExtensionPath();
  const skill = visionSkillPath();
  return {
    schemaVersion: 1,
    configPath,
    writable,
    settings: settingsFromMap(values),
    credential: credentialState(values, writable),
    install: {
      extension: { present: existsSync(extension), path: extension },
      skill: { present: existsSync(skill), path: skill },
    },
  };
}

function valuesForWrite(settings: VisionToolkitSettings, storedKey: string, apiKey?: string): Partial<Record<KnownKey, string>> {
  const nextKey = apiKey && apiKey.length > 0 ? apiKey.trim() : storedKey;
  const next: Partial<Record<KnownKey, string>> = {
    VISION_API_PROTOCOL: settings.protocol,
    VISION_BASE_URL: settings.baseUrl.trim(),
    VISION_MODEL: settings.model.trim(),
    LANG: settings.language,
  };
  if (nextKey) next.VISION_API_KEY = nextKey;
  return next;
}

function serializeEnvFile(existing: string | undefined, next: Partial<Record<KnownKey, string>>): string {
  const known = new Set<string>(KNOWN_KEYS);
  const seen = new Set<KnownKey>();
  const lines = existing === undefined || existing.length === 0
    ? []
    : existing.split(/\r?\n/);
  const endsWithNewline = existing !== undefined && existing.length > 0 && /\r?\n$/.test(existing);
  if (lines.length > 0 && lines[lines.length - 1] === "" && endsWithNewline) {
    lines.pop();
  }

  const rewritten = lines.flatMap((line) => {
    const assignment = parseAssignment(line);
    if (!assignment || !known.has(assignment.key)) return [line];
    const key = assignment.key as KnownKey;
    seen.add(key);
    if (!Object.hasOwn(next, key) || next[key] === undefined) return [];
    return [`${key}=${next[key]}`];
  });

  for (const key of KNOWN_KEYS) {
    if (!seen.has(key) && Object.hasOwn(next, key) && next[key] !== undefined) {
      rewritten.push(`${key}=${next[key]}`);
    }
  }

  return `${rewritten.join("\n")}\n`;
}

function ensurePrivateDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function writeVisionToolkitSettings(
  settings: VisionToolkitSettings,
  apiKey?: string,
): VisionToolkitSnapshot {
  if (apiKey !== undefined && apiKey !== "") {
    const error = validateApiKey(apiKey);
    if (error) throw new Error(error);
  }

  const configPath = visionEnvPath();
  const dir = dirname(configPath);
  ensurePrivateDir(dir);

  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : undefined;
  const storedKey = fileKey(readEnvMap(configPath));
  const serialized = serializeEnvFile(existing, valuesForWrite(settings, storedKey, apiKey));
  writePrivateFileAtomicSync(configPath, serialized);
  return readVisionToolkitSnapshot();
}
