"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { McpActionResponse, McpServerInfo, McpServersResponse } from "@/lib/api-types";
import type { ToolEntry } from "@/lib/tool-presets";
import {
  getMcpServerStatus,
  getMcpServerToolCounts,
  type McpServerStatus,
} from "@/lib/mcp-server-status";

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface McpPanelProps {
  cwd: string | null;
  sessionId: string | null;
  sessionBusy: boolean;
  /** Live tools from get_tools; used to derive per-server activity. */
  tools: ToolEntry[] | null;
  /** Re-runs the session system-info loader (refreshes the tools list). */
  onRefreshTools?: () => void;
  translate: Translate;
}

const STATUS_DOT: Record<McpServerStatus, string> = {
  disabled: "var(--text-dim)",
  active: "#22c55e",
  inactive: "#eab308",
  "not-loaded": "#f97316",
};

export function McpPanel({ cwd, sessionId, sessionBusy, tools, onRefreshTools, translate: t }: McpPanelProps) {
  const [servers, setServers] = useState<McpServerInfo[] | null>(null);
  const [globalPath, setGlobalPath] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingServer, setPendingServer] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const adapterDetected = useMemo(() => {
    if (!tools) return null;
    return tools.some((tool) => tool.name === "mcp" || tool.name === "mcpScript" || tool.name.startsWith("mcp__"));
  }, [tools]);

  const load = useCallback(async () => {
    if (!cwd) {
      setServers(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/mcp?cwd=${encodeURIComponent(cwd)}`);
      const body = (await res.json().catch(() => ({}))) as Partial<McpServersResponse> & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      setServers(body.servers ?? []);
      setGlobalPath(body.globalPath ?? "");
      setProjectPath(body.projectPath ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setServers(null);
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(async (server: string, action: "enable" | "disable" | "reconnect") => {
    if (!cwd || pendingServer) return;
    setPendingServer(server);
    setActionError(null);
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, server, action, ...(sessionId ? { sessionId } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<McpActionResponse> & { error?: string };
      if (!res.ok || body.error || !body.success) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // Config changed and the live session reloaded (when idle); refresh
      // both the file list and the session tool surface.
      await load();
      onRefreshTools?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingServer(null);
    }
  }, [cwd, pendingServer, sessionId, load, onRefreshTools]);

  const rows = useMemo(() => (servers ?? []).map((server) => {
    const counts = getMcpServerToolCounts(tools, server.name);
    return { server, counts, status: getMcpServerStatus(server, counts) };
  }), [servers, tools]);

  const enabledCount = rows.filter(({ server }) => !server.disabled).length;

  return (
    <div style={{ background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", boxShadow: "0 10px 28px rgba(0,0,0,0.10)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 16px 6px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
          {t("mcp.title")}
          {servers !== null && (
            <span style={{ marginLeft: 8, fontWeight: 400, color: "var(--text-muted)", fontSize: 11 }}>
              {t("mcp.enabledCount", { enabled: enabledCount, total: servers.length })}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || !cwd}
          title={t("mcp.refresh")}
          aria-label={t("mcp.refresh")}
          style={{
            border: "1px solid var(--border)", borderRadius: 4, background: "transparent",
            color: "var(--text-muted)", cursor: loading || !cwd ? "default" : "pointer",
            fontSize: 11, padding: "3px 10px", opacity: loading || !cwd ? 0.5 : 1,
          }}
        >
          {t("mcp.refresh")}
        </button>
      </div>

      {!cwd && <div style={{ padding: "4px 16px 12px", fontSize: 12, color: "var(--text-muted)" }}>{t("mcp.noCwd")}</div>}

      {cwd && loading && servers === null && (
        <div style={{ padding: "4px 16px 12px", fontSize: 12, color: "var(--text-muted)" }}>{t("mcp.loading")}</div>
      )}

      {cwd && error && (
        <div style={{ padding: "4px 16px 12px", fontSize: 12, color: "#dc2626" }}>{error}</div>
      )}

      {cwd && servers !== null && !error && (
        <>
          {adapterDetected === false && (
            <div style={{ margin: "0 16px 8px", padding: "8px 10px", fontSize: 12, color: "var(--text-muted)", background: "var(--bg-hover)", borderRadius: 4 }}>
              {t("mcp.adapterMissing")}
            </div>
          )}
          {rows.length === 0 && (
            <div style={{ padding: "4px 16px 12px", fontSize: 12, color: "var(--text-muted)" }}>{t("mcp.empty")}</div>
          )}
          {rows.length > 0 && (
            <ul style={{ listStyle: "none", margin: 0, padding: "0 8px 4px", maxHeight: 320, overflowY: "auto" }}>
              {rows.map(({ server, counts, status }) => {
                const pending = pendingServer === server.name;
                const togglesDisabled = pending || sessionBusy;
                return (
                  <li
                    key={server.name}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "7px 8px",
                      borderRadius: 4, opacity: pending ? 0.6 : 1,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      title={t(`mcp.status.${status}`)}
                      style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[status], flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {server.name}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>
                          {server.source === "project" ? t("mcp.sourceProject") : t("mcp.sourceGlobal")}
                          {server.overridden ? t("mcp.overridden") : ""}
                          {server.detail ? ` · ${server.detail}` : ""}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {status === "active" && t("mcp.toolsActive", { count: counts.active })}
                        {status === "inactive" && t("mcp.toolsInactive", { count: counts.total })}
                        {status === "not-loaded" && t("mcp.status.not-loaded")}
                        {status === "disabled" && t("mcp.status.disabled")}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={togglesDisabled}
                      onClick={() => void runAction(server.name, "reconnect")}
                      title={sessionId ? t("mcp.reconnect") : t("mcp.reconnectNoSession")}
                      aria-label={`${t("mcp.reconnect")}: ${server.name}`}
                      style={{
                        border: "1px solid var(--border)", borderRadius: 4, background: "transparent",
                        color: "var(--text-muted)", cursor: togglesDisabled || !sessionId ? "default" : "pointer",
                        fontSize: 11, padding: "3px 8px", flexShrink: 0, opacity: togglesDisabled || !sessionId ? 0.45 : 1,
                      }}
                    >
                      {t("mcp.reconnect")}
                    </button>
                    <button
                      type="button"
                      disabled={togglesDisabled}
                      onClick={() => void runAction(server.name, server.disabled ? "enable" : "disable")}
                      title={sessionBusy ? t("mcp.busyHint") : server.disabled ? t("mcp.enable") : t("mcp.disable")}
                      aria-label={`${server.disabled ? t("mcp.enable") : t("mcp.disable")}: ${server.name}`}
                      aria-pressed={!server.disabled}
                      style={{
                        border: "1px solid var(--border)", borderRadius: 4,
                        background: server.disabled ? "transparent" : "var(--bg-selected)",
                        color: server.disabled ? "var(--text-muted)" : "var(--accent)",
                        cursor: togglesDisabled ? "default" : "pointer",
                        fontSize: 11, padding: "3px 8px", flexShrink: 0, minWidth: 64,
                        opacity: togglesDisabled ? 0.45 : 1,
                      }}
                    >
                      {server.disabled ? t("mcp.enable") : t("mcp.disable")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {actionError && (
            <div style={{ padding: "0 16px 8px", fontSize: 12, color: "#dc2626" }}>{actionError}</div>
          )}
          {sessionBusy && (
            <div style={{ padding: "0 16px 8px", fontSize: 11, color: "var(--text-muted)" }}>{t("mcp.busyHint")}</div>
          )}
          <div style={{ padding: "0 16px 10px", fontSize: 10, color: "var(--text-dim)", lineHeight: 1.5 }}>
            {t("mcp.paths", { project: projectPath, global: globalPath })}
          </div>
        </>
      )}
    </div>
  );
}
