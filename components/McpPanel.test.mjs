import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const panelSource = await readFile(new URL("./McpPanel.tsx", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../app/api/mcp/route.ts", import.meta.url), "utf8");
const libSource = await readFile(new URL("../lib/mcp-servers.ts", import.meta.url), "utf8");
const statusSource = await readFile(new URL("../lib/mcp-server-status.ts", import.meta.url), "utf8");

test("plumbs MCP into the top bar next to the Tools action", () => {
  assert.match(appShellSource, /import \{ McpPanel \} from "\.\/McpPanel";/);
  assert.match(appShellSource, /"tools" \| "mcp" \| "session"/);
  assert.match(
    appShellSource,
    /handleSystemInfoToggle\("tools", mobile\)[\s\S]*?handleSystemInfoToggle\("mcp", mobile\)/,
  );
  assert.match(appShellSource, /data-mobile-toolbar-action=\{mobile \? "mcp" : undefined\}/);
  assert.match(appShellSource, /activeTopPanel === "mcp" && \(\s*<McpPanel/);
  assert.match(appShellSource, /<McpPanel[\s\S]*?onRefreshTools=\{refreshSystemInfo\}/);
});

test("refreshes session tools after MCP changes", () => {
  assert.match(appShellSource, /const refreshSystemInfo = useCallback\(\(\) => \{/);
  assert.match(appShellSource, /systemInfoLoaderRef\.current/);
  assert.match(panelSource, /onRefreshTools\?: \(\) => void/);
  assert.match(panelSource, /onRefreshTools\?\.\(\)/);
});

test("panel lists servers with status and posts toggle/reconnect actions", () => {
  assert.match(panelSource, /fetch\(`\/api\/mcp\?cwd=\$\{encodeURIComponent\(cwd\)\}`\)/);
  assert.match(panelSource, /fetch\("\/api\/mcp", \{[\s\S]*?method: "POST"/);
  assert.match(panelSource, /runAction\(server\.name, server\.disabled \? "enable" : "disable"\)/);
  assert.match(panelSource, /runAction\(server\.name, "reconnect"\)/);
  assert.match(panelSource, /getMcpServerToolCounts\(tools, server\.name\)/);
  assert.match(panelSource, /getMcpServerStatus\(server, counts\)/);
});

test("route authorizes cwd and guards busy sessions", () => {
  assert.match(routeSource, /isExistingFilePathAllowed\(cwd, allowedRoots\)/);
  assert.match(routeSource, /loadMcpServerList\(cwd\)/);
  assert.match(routeSource, /setMcpServerDisabled\(cwd, server, action === "disable"\)/);
  assert.match(routeSource, /getRpcSession\(sessionId\)/);
  assert.match(routeSource, /type: "get_commands"/);
  assert.match(routeSource, /MCP adapter is not installed in this session/);
  assert.match(routeSource, /wrapper\.isRunning\(\)/);
  assert.match(routeSource, /\/mcp reconnect \$\{server\}/);
  assert.match(routeSource, /\{ type: "reload" \}/);
  assert.match(routeSource, /isValidMcpServerName\(server\)/);
});

test("panel stays client-safe (no server-only imports in the client bundle)", () => {
  // Regression guard for `next build --webpack`: McpPanel is a "use client"
  // component, so importing lib/mcp-servers.ts (fs/os/path/pi-coding-agent)
  // breaks the client bundle with "Module not found: Can't resolve 'fs'".
  assert.match(panelSource, /from "@\/lib\/mcp-server-status"/);
  assert.doesNotMatch(panelSource, /from "@\/lib\/mcp-servers"/);
  assert.doesNotMatch(statusSource, /from\s+["'](node:)?fs["']/);
  assert.doesNotMatch(statusSource, /from\s+["'](node:)?os["']/);
  assert.doesNotMatch(statusSource, /from\s+["'](node:)?path["']/);
  assert.doesNotMatch(statusSource, /from\s+["'][^"']*pi-coding-agent[^"']*["']/);
  assert.doesNotMatch(statusSource, /from\s+["'][^"']*atomic-file[^"']*["']/);
});

test("lib mirrors the adapter enable/disable file semantics", () => {
  assert.match(libSource, /getProjectMcpPath/);
  assert.match(libSource, /mcp-servers/);
  assert.match(libSource, /next\.disabled = false/);
  assert.match(libSource, /writePrivateFileAtomicSync/);
  assert.match(libSource, /origin/);
});
