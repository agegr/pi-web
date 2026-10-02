/** Sample `mcp.json` servers and the Settings › MCP overview the demo mock answers. */
import type { McpConfigFileInfo, McpResponse, McpServerInfo } from "@/lib/api-types";
import { AGENT_DIR, PROJECT_ROOT } from "../paths";

const GLOBAL_PATH = `${AGENT_DIR}/mcp.json`;
const PROJECT_PATH = `${PROJECT_ROOT}/.pi/mcp.json`;

// configKey stands in for the server's per-process HMAC (`mcpConfigKey()`); the
// demo has no config content to hash, so a stable per-entry string does.
// Every entry lists the four masked-name fields and `masked`; the helper fills
// them so a sample only states what it has. `status` is typed explicitly: a
// union of test and session reports cannot be inferred from an object literal.
type McpServerSample =
  Omit<McpServerInfo, "envNames" | "headerNames" | "commandFields" | "variableReferences" | "masked">
  & Partial<Pick<McpServerInfo, "envNames" | "headerNames" | "commandFields" | "variableReferences" | "masked">>;

function server(entry: McpServerSample): McpServerInfo {
  return { envNames: [], headerNames: [], commandFields: [], variableReferences: [], masked: false, ...entry };
}

export const MCP_FILES: McpConfigFileInfo[] = [
  { scope: "global", path: GLOBAL_PATH, exists: true, problems: [], autoEnableCodemode: true },
  { scope: "project", path: PROJECT_PATH, exists: true, problems: [], autoEnableCodemode: true },
];

export const MCP_SERVERS: McpResponse["servers"] = [
  server({
    name: "docs",
    scope: "global",
    sourcePath: GLOBAL_PATH,
    configKey: "demo-docs",
    enabled: true,
    validated: true,
    transport: "http",
    exposure: "codemode",
    url: "https://docs.example.com/mcp",
    usesOAuth: true,
    signedIn: true,
    oauthStateStored: true,
    shadowedByProject: true,
  }),
  server({
    name: "filesystem",
    scope: "global",
    sourcePath: GLOBAL_PATH,
    configKey: "demo-filesystem",
    enabled: true,
    validated: true,
    transport: "stdio",
    exposure: "direct",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", PROJECT_ROOT],
    envNames: ["MCP_LOG_LEVEL"],
    usesOAuth: false,
    variableReferences: [{ kind: "env", name: "MCP_LOG_LEVEL", variables: ["MCP_LOG_LEVEL"] }],
    status: {
      origin: "test",
      state: "connected",
      tools: [
        { name: "read_file", readOnly: true, exposure: "direct", description: "Read a file from the allowed roots" },
        { name: "write_file", readOnly: false, exposure: "direct", description: "Write a file inside the allowed roots" },
      ],
      toolCount: 2,
      serverInfo: { name: "filesystem", version: "0.6.2" },
      durationMs: 412,
      testedAt: Date.parse("2026-09-18T09:24:00Z"),
    },
  }),
  server({
    name: "linear",
    scope: "global",
    sourcePath: GLOBAL_PATH,
    configKey: "demo-linear",
    enabled: false,
    validated: true,
    transport: "http",
    exposure: "deferred",
    url: "https://mcp.linear.app/sse?token=•••",
    headerNames: ["Authorization"],
    commandFields: [{ kind: "header", name: "Authorization" }],
    masked: true,
    usesOAuth: false,
  }),
  server({
    name: "github",
    scope: "project",
    sourcePath: PROJECT_PATH,
    configKey: "demo-github",
    enabled: true,
    validated: true,
    transport: "stdio",
    exposure: "codemode",
    command: "docker",
    args: ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
    envNames: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    usesOAuth: false,
    variableReferences: [{ kind: "env", name: "GITHUB_PERSONAL_ACCESS_TOKEN", variables: ["GITHUB_PERSONAL_ACCESS_TOKEN"] }],
    replacesGlobal: true,
  }),
  server({
    name: "sentry",
    scope: "project",
    sourcePath: PROJECT_PATH,
    configKey: "demo-sentry",
    enabled: true,
    validated: true,
    transport: "http",
    exposure: "codemode-deferred",
    url: "https://mcp.sentry.dev/mcp",
    usesOAuth: true,
    signedIn: false,
    oauthStateStored: false,
  }),
];

/** A mutable copy the switches and Remove edit, so the panel's refetch shows the result. */
export const mcpServersState: McpServerInfo[] = structuredClone(MCP_SERVERS);

export function mcpOverview(cwd: string | null): McpResponse {
  const files = cwd ? MCP_FILES : MCP_FILES.filter((file) => file.scope === "global");
  const servers = mcpServersState.filter((entry) => cwd || entry.scope === "global");
  return {
    // The demo mirrors the real app's browser code only; it never loads the SDK's
    // MCP modules, so the panel says so instead of pretending servers connect.
    mcp: {
      available: false,
      reason: "internals-unavailable",
      error: "The static demo has no Pi Web server to connect MCP servers from",
      detail: "This is a demo limitation, not a problem with your mcp.json",
    },
    codemode: { preference: "automatic", sandbox: { state: "not-checked" }, builtinDisabled: false },
    files,
    servers,
    project: cwd
      ? { cwd, trust: { requiresTrust: true, trusted: true, decision: true, decisionPath: cwd, inherited: false } }
      : undefined,
  };
}
