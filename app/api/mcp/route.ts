import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { NextResponse } from "next/server";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { loadCapability } from "@oh-my-pi/pi-coding-agent/capability";
import type { MCPServer } from "@oh-my-pi/pi-coding-agent/capability/mcp";
import { setMcpServerEnabled } from "@oh-my-pi/pi-coding-agent/mcp/config-writer";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import type { McpConfigResponse, McpScopeConfig, McpServerConfig, McpServerEntry } from "@/lib/settings-api";

export const dynamic = "force-dynamic";

const SERVER_NAME = /^[a-zA-Z0-9_.:-]{1,100}$/;
const REDACTED_VALUE = "••••••••";
const SECRET_ENV_KEY = /(token|key|secret|password|credential|auth)/i;
const SERVER_KEYS: Record<string, true> = {
  enabled: true,
  timeout: true,
  type: true,
  command: true,
  args: true,
  env: true,
  cwd: true,
  url: true,
  headers: true,
  auth: true,
  oauth: true,
};

type McpDocument = {
  $schema?: string;
  mcpServers?: Record<string, McpServerConfig>;
  disabledServers?: string[];
  enabledServers?: string[];
};

function redactNestedStrings(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    typeof item === "string"
      ? REDACTED_VALUE
      : item && typeof item === "object" && !Array.isArray(item)
        ? redactNestedStrings(item as Record<string, unknown>)
        : item,
  ]));
}

function redactConfig(config: McpServerConfig): McpServerConfig {
  return {
    ...config,
    ...(config.headers && {
      headers: Object.fromEntries(Object.keys(config.headers).map((key) => [key, REDACTED_VALUE])),
    }),
    ...(config.env && {
      env: Object.fromEntries(Object.entries(config.env).map(([key, value]) => [
        key,
        SECRET_ENV_KEY.test(key) ? REDACTED_VALUE : value,
      ])),
    }),
    ...(config.auth && { auth: redactNestedStrings(config.auth) }),
    ...(config.oauth && { oauth: redactNestedStrings(config.oauth) }),
  };
}

function restoreRedactedValues(submitted: unknown, existing: unknown, path: string): unknown {
  if (submitted === REDACTED_VALUE) {
    if (existing === undefined) throw new Error(`${path}: re-enter the stored secret after renaming this server`);
    return existing;
  }
  if (Array.isArray(submitted)) {
    const previous = Array.isArray(existing) ? existing : [];
    return submitted.map((item, index) => restoreRedactedValues(item, previous[index], `${path}[${index}]`));
  }
  if (submitted && typeof submitted === "object") {
    const previous = existing && typeof existing === "object" && !Array.isArray(existing)
      ? existing as Record<string, unknown>
      : {};
    return Object.fromEntries(Object.entries(submitted).map(([key, value]) => [
      key,
      restoreRedactedValues(value, previous[key], `${path}.${key}`),
    ]));
  }
  return submitted;
}

function configPath(scope: "user" | "project", cwd?: string): string {
  return scope === "user" ? join(getAgentDir(), "mcp.json") : join(cwd!, ".omp", "mcp.json");
}

function readScope(scope: "user" | "project", cwd?: string): McpScopeConfig {
  const path = configPath(scope, cwd);
  if (!existsSync(path)) return { scope, path, servers: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as McpDocument;
    const servers = parsed.mcpServers && typeof parsed.mcpServers === "object"
      ? Object.entries(parsed.mcpServers).map(([name, config]) => ({
          name,
          config: redactConfig(config),
          enabled: config.enabled !== false,
          editable: true,
          source: { path, provider: "OMP", level: scope },
        }))
      : [];
    return { scope, path, servers };
  } catch (error) {
    return { scope, path, servers: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function discoveredConfig(server: MCPServer): McpServerConfig {
  return redactConfig({
    ...(server.enabled !== undefined && { enabled: server.enabled }),
    ...(server.timeout !== undefined && { timeout: server.timeout }),
    ...(server.transport && { type: server.transport }),
    ...(server.command !== undefined && { command: server.command }),
    ...(server.args !== undefined && { args: server.args }),
    ...(server.env !== undefined && {
      env: Object.fromEntries(Object.keys(server.env).map((key) => [key, REDACTED_VALUE])),
    }),
    ...(server.cwd !== undefined && { cwd: server.cwd }),
    ...(server.url !== undefined && { url: server.url }),
    ...(server.headers !== undefined && { headers: server.headers }),
    ...(server.auth !== undefined && { auth: server.auth }),
    ...(server.oauth !== undefined && { oauth: server.oauth }),
  });
}

async function addDiscoveredServers(response: McpConfigResponse, cwd?: string): Promise<void> {
  const discovered = await loadCapability<MCPServer>("mcps", {
    cwd: cwd ?? process.cwd(),
    includeDisabled: true,
    includeInvalid: true,
  });
  for (const server of discovered.items) {
    const target = server._source.level === "project"
      ? response.project
      : server._source.level === "user"
        ? response.user
        : null;
    if (!target || target.servers.some((entry) => entry.name === server.name)) continue;
    target.servers.push({
      name: server.name,
      config: discoveredConfig(server),
      enabled: server.enabled !== false,
      editable: false,
      source: {
        path: server._source.path,
        provider: server._source.providerName,
        level: server._source.level,
      },
    });
  }
}

function applyEffectiveEnabledState(response: McpConfigResponse): void {
  const userPath = configPath("user");
  let document: McpDocument = {};
  if (existsSync(userPath)) {
    try {
      document = JSON.parse(readFileSync(userPath, "utf8")) as McpDocument;
    } catch {
      return;
    }
  }
  const disabled = new Set(document.disabledServers ?? []);
  const forced = new Set(document.enabledServers ?? []);
  for (const scope of [response.user, response.project]) {
    for (const server of scope?.servers ?? []) {
      server.enabled = !disabled.has(server.name) && (server.config.enabled !== false || forced.has(server.name));
    }
  }
}

function validateStringRecord(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  if (Object.values(value).some((item) => typeof item !== "string")) throw new Error(`${label} values must be strings`);
}

function validateServer(entry: McpServerEntry): McpServerEntry {
  const name = entry.name.trim();
  if (!SERVER_NAME.test(name)) throw new Error(`Invalid MCP server name: ${name || "(empty)"}`);
  const config = entry.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(`${name}: config must be an object`);
  const unknown = Object.keys(config).find((key) => !SERVER_KEYS[key]);
  if (unknown) throw new Error(`${name}: unknown property ${unknown}`);
  if (config.enabled !== undefined && typeof config.enabled !== "boolean") throw new Error(`${name}: enabled must be boolean`);
  if (config.timeout !== undefined && (typeof config.timeout !== "number" || !Number.isFinite(config.timeout) || config.timeout < 0)) {
    throw new Error(`${name}: timeout must be a non-negative number`);
  }
  if (config.command && config.url) throw new Error(`${name}: choose command or URL, not both`);
  if (!config.command && !config.url) throw new Error(`${name}: command or URL is required`);
  if (config.command) {
    if (typeof config.command !== "string" || !config.command.trim()) throw new Error(`${name}: command is required`);
    if (config.type !== undefined && config.type !== "stdio") throw new Error(`${name}: command transport must be stdio`);
    if (config.args !== undefined && (!Array.isArray(config.args) || config.args.some((arg) => typeof arg !== "string"))) {
      throw new Error(`${name}: args must be a string array`);
    }
    if (config.cwd !== undefined && typeof config.cwd !== "string") throw new Error(`${name}: cwd must be text`);
    validateStringRecord(config.env, `${name}: env`);
  } else {
    if (typeof config.url !== "string" || !config.url.trim()) throw new Error(`${name}: URL is required`);
    if (config.type !== "http" && config.type !== "sse") throw new Error(`${name}: URL transport must be http or sse`);
    validateStringRecord(config.headers, `${name}: headers`);
  }
  if (config.auth !== undefined && (!config.auth || typeof config.auth !== "object" || Array.isArray(config.auth))) {
    throw new Error(`${name}: auth must be an object`);
  }
  if (config.oauth !== undefined && (!config.oauth || typeof config.oauth !== "object" || Array.isArray(config.oauth))) {
    throw new Error(`${name}: oauth must be an object`);
  }
  return { name, config, enabled: config.enabled !== false };
}

async function validatedCwd(req: Request): Promise<string | undefined> {
  const cwd = new URL(req.url).searchParams.get("cwd") ?? undefined;
  if (!cwd) return undefined;
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) throw new Error("Access denied");
  return cwd;
}

export async function GET(req: Request) {
  try {
    const cwd = await validatedCwd(req);
    const response: McpConfigResponse = {
      user: readScope("user"),
      project: cwd ? readScope("project", cwd) : null,
    };
    await addDiscoveredServers(response, cwd);
    applyEffectiveEnabledState(response);
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const cwd = await validatedCwd(req);
    const body = await req.json() as {
      scope?: "user" | "project";
      name?: string;
      enabled?: boolean;
    };
    if (body.scope !== "user" && body.scope !== "project") throw new Error("Invalid MCP scope");
    if (body.scope === "project" && !cwd) throw new Error("cwd required for project MCP settings");
    if (typeof body.name !== "string" || !SERVER_NAME.test(body.name)) throw new Error("Invalid MCP server name");
    if (typeof body.enabled !== "boolean") throw new Error("enabled must be a boolean");

    const userPath = configPath("user");
    const projectPath = configPath("project", cwd ?? process.cwd());
    const scopedPath = body.scope === "user" ? userPath : projectPath;
    let sourcePath: string | undefined;
    if (existsSync(scopedPath)) {
      const document = JSON.parse(readFileSync(scopedPath, "utf8")) as McpDocument;
      if (document.mcpServers?.[body.name]) sourcePath = scopedPath;
    }

    await setMcpServerEnabled({
      userPath,
      projectPath,
      sourcePath,
      name: body.name,
      enabled: body.enabled,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const cwd = await validatedCwd(req);
    const body = await req.json() as { scope?: "user" | "project"; servers?: McpServerEntry[] };
    if (body.scope !== "user" && body.scope !== "project") throw new Error("Invalid MCP scope");
    if (body.scope === "project" && !cwd) throw new Error("cwd required for project MCP settings");
    if (!Array.isArray(body.servers)) throw new Error("servers must be an array");
    const servers = body.servers.map(validateServer);
    if (new Set(servers.map(({ name }) => name)).size !== servers.length) throw new Error("MCP server names must be unique");

    const path = configPath(body.scope, cwd);
    let existing: McpDocument = {};
    if (existsSync(path)) {
      try {
        existing = JSON.parse(readFileSync(path, "utf8")) as McpDocument;
      } catch {
        throw new Error(`Cannot overwrite invalid JSON: ${path}`);
      }
    }
    const restoredServers = servers.map(({ name, config }) => ({
      name,
      config: restoreRedactedValues(config, existing.mcpServers?.[name], name) as McpServerConfig,
    }));
    const document: McpDocument = {
      ...existing,
      $schema: existing.$schema ?? "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
      mcpServers: Object.fromEntries(restoredServers.map(({ name, config }) => [name, config])),
    };
    mkdirSync(dirname(path), { recursive: true });
    writePrivateFileAtomicSync(path, `${JSON.stringify(document, null, 2)}\n`);
    return NextResponse.json({ success: true, scope: readScope(body.scope, cwd) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
