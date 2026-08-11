import { NextResponse } from "next/server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { spawn } from "child_process";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getProjectTrustStatus } from "@/lib/project-trust";
import type { McpResponse, McpScope, McpServerInfo } from "@/lib/api-types";

export const dynamic = "force-dynamic";

type McpAction = "add" | "remove" | "enable" | "disable" | "update" | "move" | "test" | "get";

interface McpFileData {
  settings?: Record<string, unknown>;
  mcpServers?: Record<string, Record<string, unknown>>;
}

function mcpFilePath(cwd: string, scope: McpScope): string {
  return scope === "global" ? join(getAgentDir(), "mcp.json") : join(cwd, ".pi", "mcp.json");
}

function readMcpFile(file: string): McpFileData {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as McpFileData;
  } catch {
    return {};
  }
}

function writeMcpFile(file: string, data: McpFileData): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function serverInfoFromDef(
  name: string,
  def: Record<string, unknown>,
  scope: McpScope,
  source: string,
): McpServerInfo {
  const command = typeof def.command === "string" ? def.command : undefined;
  const url = typeof def.url === "string" ? def.url : undefined;
  const socket = typeof def.socket === "string" ? def.socket : undefined;
  const args = Array.isArray(def.args)
    ? def.args.filter((a): a is string => typeof a === "string")
    : [];
  const env =
    def.env && typeof def.env === "object"
      ? (def.env as Record<string, unknown>)
      : {};
  const options: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(def)) {
    if (!["command", "url", "socket", "args", "env", "disabled"].includes(k)) {
      options[k] = v;
    }
  }
  return {
    name,
    scope,
    disabled: def.disabled === true,
    kind: socket ? "socket" : url ? "url" : "command",
    command,
    args,
    url,
    socket,
    envKeys: Object.keys(env),
    options,
    source,
  };
}

async function readMcp(cwd: string): Promise<McpResponse> {
  const diagnostics: string[] = [];
  const globalFile = mcpFilePath(cwd, "global");
  const projectFile = mcpFilePath(cwd, "project");
  const global = readMcpFile(globalFile);
  const project = readMcpFile(projectFile);

  const merged: Record<string, Record<string, unknown>> = { ...(global.mcpServers ?? {}) };
  const scopeOf = new Map<string, McpScope>();
  const sourceOf = new Map<string, string>();
  for (const name of Object.keys(merged)) {
    scopeOf.set(name, "global");
    sourceOf.set(name, globalFile);
  }
  for (const [name, def] of Object.entries(project.mcpServers ?? {})) {
    merged[name] = def;
    scopeOf.set(name, "project");
    sourceOf.set(name, projectFile);
  }
  if (!existsSync(globalFile) && Object.keys(project.mcpServers ?? {}).length === 0) {
    diagnostics.push('No MCP config file found (global ~/.pi/agent/mcp.json or project .pi/mcp.json). Click "Add MCP" to create one.');
  }

  const servers = Object.entries(merged).map(([name, def]) =>
    serverInfoFromDef(name, def, scopeOf.get(name) ?? "global", sourceOf.get(name) ?? globalFile),
  );
  const settings = { ...(global.settings ?? {}), ...(project.settings ?? {}) };
  const projectTrust = getProjectTrustStatus(cwd, getAgentDir());
  return { servers, settings, diagnostics, projectResourcesLoaded: projectTrust.trusted };
}

function testMcpServer(def: Record<string, unknown>): Promise<{ ok: boolean; detail: string }> {
  const url = typeof def.url === "string" ? def.url : undefined;
  const command = typeof def.command === "string" ? def.command : undefined;
  const args = Array.isArray(def.args)
    ? def.args.filter((a): a is string => typeof a === "string")
    : [];
  const env =
    def.env && typeof def.env === "object"
      ? (def.env as Record<string, string>)
      : {};

  if (url) {
    return (async () => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "pi-web-mcp-test", version: "1.0" },
            },
          }),
          signal: AbortSignal.timeout(15000),
        });
        const text = await res.text();
        return res.ok && text
          ? { ok: true, detail: `Connected (HTTP ${res.status})` }
          : { ok: false, detail: `HTTP ${res.status}` };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    })();
  }

  if (command) {
    return new Promise((resolve) => {
      let child: ReturnType<typeof spawn> | undefined;
      let info: { name?: string; version?: string } | undefined;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child?.kill(); } catch { /* */ }
        resolve({ ok: false, detail: "Connection timed out (20s)" });
      }, 20000);
      try {
        child = spawn([command, ...args].join(" "), [], {
          shell: true,
          stdio: ["pipe", "pipe", "inherit"],
          windowsHide: true,
          env: { ...process.env, ...env },
        });
      } catch (error) {
        clearTimeout(timer);
        resolve({ ok: false, detail: error instanceof Error ? error.message : String(error) });
        return;
      }
      let buf = "";
      child.stdout?.on("data", (d) => {
        buf += d.toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          try {
            const m = JSON.parse(l);
            if (m.id === 1) {
              info = m.result?.serverInfo;
              child?.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
              setTimeout(() => {
                child?.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
              }, 300);
            } else if (m.id === 2) {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              try { child?.kill(); } catch { /* */ }
              const tools = Array.isArray(m.result?.tools) ? m.result.tools : [];
              resolve({ ok: true, detail: `Connected · ${info?.name ?? "server"} ${info?.version ?? ""} · ${tools.length} tools` });
            }
          } catch { /* ignore non-JSON lines */ }
        }
      });
      child.stdin?.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "pi-web-mcp-test", version: "1.0" },
          },
        }) + "\n",
      );
      child.on("error", (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, detail: e.message });
      });
      child.on("exit", (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ ok: false, detail: `Process exited with code ${code}` });
        }
      });
    });
  }

  if (typeof def.socket === "string") {
    return Promise.resolve({ ok: false, detail: "Socket type does not support automatic testing yet" });
  }
  return Promise.resolve({ ok: false, detail: "Missing command or url" });
}

function readScope(scope: unknown): McpScope {
  return scope === "project" ? "project" : "global";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json(await readMcp(cwd));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/mcp body: { action, cwd, scope?, name?, def?, fromScope?, toScope? }
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = (await req.json()) as {
      action?: McpAction;
      cwd?: string;
      scope?: McpScope;
      name?: string;
      fromScope?: McpScope;
      toScope?: McpScope;
      def?: Record<string, unknown>;
    };
    if (!body.cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (!body.action) return NextResponse.json({ error: "action required" }, { status: 400 });
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(body.cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const cwd = body.cwd;
    const projectTrust = getProjectTrustStatus(cwd, getAgentDir());

    if (body.action === "test") {
      const scope = readScope(body.scope);
      const def =
        body.def ??
        readMcpFile(mcpFilePath(cwd, scope)).mcpServers?.[body.name ?? ""];
      if (!def) return NextResponse.json({ error: "server not found" }, { status: 404 });
      const result = await testMcpServer(def);
      return NextResponse.json({ ok: result.ok, message: result.detail });
    }

    if (body.action === "get") {
      const scope = readScope(body.scope);
      const def = readMcpFile(mcpFilePath(cwd, scope)).mcpServers?.[body.name ?? ""];
      if (!def) return NextResponse.json({ error: "server not found" }, { status: 404 });
      // Return the full raw definition (including env values) for advanced JSON editing
      return NextResponse.json({ def });
    }

    if (body.action === "add" || body.action === "update") {
      const scope = readScope(body.scope);
      if (scope === "project" && !projectTrust.trusted) {
        return NextResponse.json(
          { error: "Project must be trusted before modifying project MCP config" },
          { status: 403 },
        );
      }
      const name = body.name?.trim();
      const def = body.def;
      if (!name || !def || typeof def !== "object") {
        return NextResponse.json({ error: "name and def required" }, { status: 400 });
      }
      if (!def.command && !def.url && !def.socket) {
        return NextResponse.json({ error: "Requires one of command, url or socket" }, { status: 400 });
      }
      const file = mcpFilePath(cwd, scope);
      const data = readMcpFile(file);
      data.mcpServers ??= {};
      data.mcpServers[name] = def;
      writeMcpFile(file, data);
    } else if (body.action === "remove") {
      const scope = readScope(body.scope);
      if (scope === "project" && !projectTrust.trusted) {
        return NextResponse.json(
          { error: "Project must be trusted before modifying project MCP config" },
          { status: 403 },
        );
      }
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
      const file = mcpFilePath(cwd, scope);
      const data = readMcpFile(file);
      if (data.mcpServers?.[name]) {
        delete data.mcpServers[name];
        writeMcpFile(file, data);
      }
    } else if (body.action === "enable" || body.action === "disable") {
      const scope = readScope(body.scope);
      if (scope === "project" && !projectTrust.trusted) {
        return NextResponse.json(
          { error: "Project must be trusted before modifying project MCP config" },
          { status: 403 },
        );
      }
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
      const file = mcpFilePath(cwd, scope);
      const data = readMcpFile(file);
      if (data.mcpServers?.[name]) {
        data.mcpServers[name].disabled = body.action === "disable";
        writeMcpFile(file, data);
      }
    } else if (body.action === "move") {
      const from = readScope(body.fromScope);
      const to = readScope(body.toScope);
      if (from === to) return NextResponse.json({ error: "same scope" }, { status: 400 });
      if (to === "project" && !projectTrust.trusted) {
        return NextResponse.json(
          { error: "Project must be trusted before modifying project MCP config" },
          { status: 403 },
        );
      }
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
      const fromFile = mcpFilePath(cwd, from);
      const toFile = mcpFilePath(cwd, to);
      const fromData = readMcpFile(fromFile);
      const def = fromData.mcpServers?.[name];
      if (!def) return NextResponse.json({ error: "server not found in source scope" }, { status: 404 });
      if (fromData.mcpServers) delete fromData.mcpServers[name];
      writeMcpFile(fromFile, fromData);
      const toData = readMcpFile(toFile);
      toData.mcpServers ??= {};
      toData.mcpServers[name] = def;
      writeMcpFile(toFile, toData);
    } else {
      return NextResponse.json({ error: `Unsupported action: ${body.action}` }, { status: 400 });
    }

    return NextResponse.json(await readMcp(cwd));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
