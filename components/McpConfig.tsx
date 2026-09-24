"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { sendAgentCommand } from "@/lib/agent-client";
import type { McpConfigScope, McpServerConfig, McpServersResponse, McpServerView } from "@/lib/api-types";
import { getLastSettingsSelection, setLastSettingsSelection } from "@/lib/settings-navigation";
import type { ToolEntry } from "@/lib/tool-presets";
import {
  ConfigButton,
  ConfigDetail,
  ConfigDetailActions,
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigEmptyState,
  ConfigField,
  ConfigFooter,
  ConfigListAction,
  ConfigPanelShell,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSplitView,
  ConfigStatusDot,
} from "./SettingsUi";

type Transport = "stdio" | "http";
type EditorMode = "view" | "create";

interface ServerDraft {
  name: string;
  scope: McpConfigScope;
  transport: Transport;
  command: string;
  /** One argument per line, so paths containing spaces stay unambiguous. */
  args: string;
  cwd: string;
  /** One `KEY=value` per line. */
  env: string;
  url: string;
}

const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 34,
  padding: "0 9px",
  border: "1px solid var(--border)",
  borderRadius: 5,
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 12,
  outline: "none",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  height: 72,
  padding: "7px 9px",
  fontFamily: "var(--font-mono)",
  resize: "vertical",
};

function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function serverKey(server: Pick<McpServerView, "scope" | "name">): string {
  return `${server.scope}:${server.name}`;
}

function joinLines(values: readonly string[] | undefined): string {
  return (values ?? []).join("\n");
}

function joinEnv(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {}).map(([key, value]) => `${key}=${value}`).join("\n");
}

function draftFromServer(server: McpServerView): ServerDraft {
  const config = server.config;
  return {
    name: server.name,
    scope: server.scope,
    transport: config.url !== undefined ? "http" : "stdio",
    command: config.command ?? "",
    args: joinLines(config.args),
    cwd: config.cwd ?? "",
    env: joinEnv(config.env),
    url: config.url ?? "",
  };
}

function parseArgs(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

function parseEnv(text: string): { env: Record<string, string>; error?: string } {
  const env: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) return { env, error: `invalid env line: ${line}` };
    env[line.slice(0, separator).trim()] = line.slice(separator + 1);
  }
  return { env };
}

function draftToConfig(draft: ServerDraft): { config?: McpServerConfig; error?: string } {
  if (draft.transport === "http") {
    if (!draft.url.trim()) return { error: "url" };
    return { config: { url: draft.url.trim() } };
  }
  if (!draft.command.trim()) return { error: "command" };
  const { env, error } = parseEnv(draft.env);
  if (error) return { error };
  const args = parseArgs(draft.args);
  const config: McpServerConfig = { command: draft.command.trim() };
  if (args.length > 0) config.args = args;
  if (draft.cwd.trim()) config.cwd = draft.cwd.trim();
  if (Object.keys(env).length > 0) config.env = env;
  return { config };
}

function emptyDraft(scope: McpConfigScope, existing: readonly McpServerView[]): ServerDraft {
  const taken = new Set(existing.map((server) => server.name));
  let name = "new-server";
  let suffix = 2;
  while (taken.has(name)) name = `new-server-${suffix++}`;
  return {
    name,
    scope,
    transport: "stdio",
    command: "",
    args: "",
    cwd: "",
    env: "",
    url: "",
  };
}

export function McpConfig({
  cwd,
  sessionId = null,
  onClose,
  onReloaded,
  embedded = false,
}: {
  cwd: string;
  sessionId?: string | null;
  onClose: () => void;
  onReloaded?: () => void;
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [diagnostics, setDiagnostics] = useState<McpServersResponse["diagnostics"]>([]);
  const [projectResourcesLoaded, setProjectResourcesLoaded] = useState(true);
  const [liveTools, setLiveTools] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => getLastSettingsSelection("mcp", cwd));
  const [draft, setDraft] = useState<ServerDraft | null>(null);
  const [mode, setMode] = useState<EditorMode>("view");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const selected = useMemo(
    () => servers.find((server) => serverKey(server) === selectedKey) ?? null,
    [servers, selectedKey],
  );

  const refreshLiveTools = useCallback(async () => {
    if (!sessionId) {
      setLiveTools([]);
      return;
    }
    try {
      const tools = await sendAgentCommand<ToolEntry[]>(sessionId, { type: "get_tools" });
      setLiveTools(tools.filter((tool) => tool.name.startsWith("mcp_")).map((tool) => tool.name));
    } catch {
      // The session may not be running; live tools are advisory only.
      setLiveTools([]);
    }
  }, [sessionId]);

  const load = useCallback(async (preferredKey?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/mcp?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const data = await response.json() as Partial<McpServersResponse> & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      const next = data.servers ?? [];
      setServers(next);
      setDiagnostics(data.diagnostics ?? []);
      setProjectResourcesLoaded(data.projectResourcesLoaded !== false);

      const remembered = preferredKey ?? getLastSettingsSelection("mcp", cwd);
      const chosen = next.find((server) => serverKey(server) === remembered)
        ?? next.find((server) => server.scope === "project")
        ?? next.find((server) => server.scope === "global")
        ?? null;
      setSelectedKey(chosen ? serverKey(chosen) : null);
      setDraft(chosen ? draftFromServer(chosen) : null);
      setMode("view");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
    await refreshLiveTools();
  }, [cwd, refreshLiveTools]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedKey) setLastSettingsSelection("mcp", selectedKey, cwd);
  }, [cwd, selectedKey]);

  const selectServer = (server: McpServerView) => {
    setSelectedKey(serverKey(server));
    setDraft(draftFromServer(server));
    setMode("view");
    setError(null);
    setStatus(null);
  };

  const beginCreate = (scope: McpConfigScope) => {
    setSelectedKey(null);
    setDraft(emptyDraft(scope, servers));
    setMode("create");
    setError(null);
    setStatus(null);
  };

  const applyResponse = (data: McpServersResponse, preferredKey: string | null) => {
    setServers(data.servers);
    setDiagnostics(data.diagnostics);
    setProjectResourcesLoaded(data.projectResourcesLoaded);
    const chosen = preferredKey
      ? data.servers.find((server) => serverKey(server) === preferredKey) ?? null
      : null;
    setSelectedKey(chosen ? serverKey(chosen) : null);
    setDraft(chosen ? draftFromServer(chosen) : null);
    setMode("view");
  };

  const save = async () => {
    if (!draft) return;
    const built = draftToConfig(draft);
    if (!built.config) {
      setError(built.error === "command"
        ? t("mcp.errorCommandRequired")
        : built.error === "url"
          ? t("mcp.errorUrlRequired")
          : t("mcp.errorEnvFormat", { line: built.error ?? "" }));
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          cwd,
          scope: draft.scope,
          name: draft.name.trim(),
          config: built.config,
        }),
      });
      const data = await response.json() as Partial<McpServersResponse> & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      applyResponse(data as McpServersResponse, `${draft.scope}:${draft.name.trim()}`);
      setStatus(t("mcp.saved"));
      await reloadSession();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", cwd, scope: selected.scope, name: selected.name }),
      });
      const data = await response.json() as Partial<McpServersResponse> & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      applyResponse(data as McpServersResponse, null);
      setStatus(t("mcp.removed"));
      await reloadSession();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Apply the new config to the running session.
   *
   * `reload` re-emits session_shutdown/session_start, which is what makes the
   * MCP extension re-read mcp.json and reconnect its servers.
   */
  const reloadSession = async () => {
    if (!sessionId) return;
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      await refreshLiveTools();
      onReloaded?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const globalServers = servers.filter((server) => server.scope === "global");
  const projectServers = servers.filter((server) => server.scope === "project");
  const projectEditable = projectResourcesLoaded;

  const renderGroup = (label: string, scope: McpConfigScope, group: McpServerView[], addable: boolean) => (
    <>
      <ConfigSidebarGroupLabel>{label}</ConfigSidebarGroupLabel>
      {group.map((server) => (
        <ConfigSidebarItem
          key={serverKey(server)}
          active={serverKey(server) === selectedKey}
          onClick={() => selectServer(server)}
        >
          <ConfigStatusDot active={liveTools.some((tool) => tool.startsWith(`mcp_${server.name}`))} />
          <ConfigSidebarText>{server.name}</ConfigSidebarText>
          <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
            {server.config.url !== undefined ? t("mcp.transportHttp") : t("mcp.transportStdio")}
          </span>
        </ConfigSidebarItem>
      ))}
      {addable && (
        <ConfigListAction onClick={() => beginCreate(scope)}>{t("mcp.addServer")}</ConfigListAction>
      )}
    </>
  );

  return (
    <ConfigPanelShell
      embedded={embedded}
      title={t("common.mcp")}
      subtitle={shortenPath(cwd)}
      closeLabel={t("i18n.close")}
      onClose={onClose}
    >
      {!projectResourcesLoaded && (
        <div role="status" className="config-trust-notice">
          {t("trust.mcpNotLoaded")}
        </div>
      )}

      <ConfigSplitView>
        <ConfigSidebar>
          <ConfigSidebarList>
            {loading ? (
              <div className="config-sidebar-message">{t("i18n.loading")}</div>
            ) : servers.length === 0 && liveTools.length === 0 && mode !== "create" ? (
              <div className="config-sidebar-message is-empty">{t("mcp.empty")}</div>
            ) : (
              <>
                {renderGroup(t("mcp.scopeGlobal"), "global", globalServers, true)}
                {renderGroup(t("mcp.scopeProject"), "project", projectServers, projectEditable)}
                {liveTools.length > 0 && (
                  <>
                    <ConfigSidebarGroupLabel>{t("mcp.liveTools")}</ConfigSidebarGroupLabel>
                    {liveTools.map((tool) => (
                      <ConfigSidebarItem key={tool} disabled>
                        <ConfigStatusDot active />
                        <ConfigSidebarText>{tool}</ConfigSidebarText>
                      </ConfigSidebarItem>
                    ))}
                  </>
                )}
              </>
            )}
          </ConfigSidebarList>
        </ConfigSidebar>

        <ConfigDetail>
          {!draft ? (
            <ConfigEmptyState>
              {servers.length === 0 ? t("mcp.emptyHint") : t("mcp.selectHint")}
            </ConfigEmptyState>
          ) : (
            <ConfigDetailStack>
              <ConfigDetailHeader>
                <ConfigDetailHeaderInfo>
                  <div className="config-detail-title">
                    {mode === "create" ? t("mcp.addServer") : draft.name}
                  </div>
                  <div style={{ color: "var(--text-dim)", fontSize: 11 }}>
                    {draft.scope === "project" ? t("mcp.scopeProject") : t("mcp.scopeGlobal")}
                    {selected ? ` · ${shortenPath(selected.path)}` : ""}
                  </div>
                </ConfigDetailHeaderInfo>
                <ConfigDetailActions>
                  <ConfigButton variant="primary" size="small" disabled={busy} onClick={() => void save()}>
                    {busy ? t("i18n.saving") : t("i18n.save")}
                  </ConfigButton>
                  {mode === "view" && selected && (
                    <ConfigButton variant="danger" size="small" disabled={busy} onClick={() => void remove()}>
                      {t("i18n.remove")}
                    </ConfigButton>
                  )}
                </ConfigDetailActions>
              </ConfigDetailHeader>

              <ConfigField label={t("mcp.fieldName")}>
                <input
                  style={mode === "create" ? inputStyle : { ...inputStyle, color: "var(--text-dim)" }}
                  value={draft.name}
                  readOnly={mode !== "create"}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </ConfigField>

              <ConfigField label={t("mcp.fieldTransport")}>
                <select
                  style={inputStyle}
                  value={draft.transport}
                  onChange={(event) => setDraft({ ...draft, transport: event.target.value as Transport })}
                >
                  <option value="stdio">{t("mcp.transportStdio")}</option>
                  <option value="http">{t("mcp.transportHttp")}</option>
                </select>
              </ConfigField>

              {draft.transport === "stdio" ? (
                <>
                  <ConfigField label={t("mcp.fieldCommand")}>
                    <input
                      style={inputStyle}
                      value={draft.command}
                      placeholder="npx"
                      onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                    />
                  </ConfigField>
                  <ConfigField label={t("mcp.fieldArgs")}>
                    <textarea
                      style={textareaStyle}
                      value={draft.args}
                      placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/tmp"}
                      onChange={(event) => setDraft({ ...draft, args: event.target.value })}
                    />
                  </ConfigField>
                  <ConfigField label={t("mcp.fieldCwd")}>
                    <input
                      style={inputStyle}
                      value={draft.cwd}
                      onChange={(event) => setDraft({ ...draft, cwd: event.target.value })}
                    />
                  </ConfigField>
                  <ConfigField label={t("mcp.fieldEnv")}>
                    <textarea
                      style={textareaStyle}
                      value={draft.env}
                      placeholder="GITHUB_TOKEN=..."
                      onChange={(event) => setDraft({ ...draft, env: event.target.value })}
                    />
                  </ConfigField>
                </>
              ) : (
                <ConfigField label={t("mcp.fieldUrl")}>
                  <input
                    style={inputStyle}
                    value={draft.url}
                    placeholder="https://mcp.example.com/mcp"
                    onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                  />
                </ConfigField>
              )}

              <div style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.6 }}>
                {t("mcp.securityNote")}
              </div>

              {diagnostics.length > 0 && (
                <div role="alert" className="config-sidebar-message is-error">
                  {diagnostics.map((diagnostic) => (
                    <div key={`${diagnostic.path}:${diagnostic.message}`}>
                      {shortenPath(diagnostic.path)}: {diagnostic.message}
                    </div>
                  ))}
                </div>
              )}
            </ConfigDetailStack>
          )}
        </ConfigDetail>
      </ConfigSplitView>

      <ConfigFooter
        status={
          error
            ? <span style={{ color: "var(--text)" }}>{error}</span>
            : status ?? (liveTools.length > 0 ? t("mcp.liveCount", { count: String(liveTools.length) }) : undefined)
        }
      >
        <ConfigButton size="small" disabled={busy || !sessionId} onClick={() => void reloadSession()}>
          {t("mcp.reloadSession")}
        </ConfigButton>
      </ConfigFooter>
    </ConfigPanelShell>
  );
}
