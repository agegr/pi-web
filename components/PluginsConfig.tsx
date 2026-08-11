"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { McpResponse, McpScope, McpServerInfo, PluginPackageInfo, PluginsResponse } from "@/lib/api-types";
import { useI18n } from "@/hooks/useI18n";

type PluginScope = PluginPackageInfo["scope"];
type PluginAction = "install" | "remove" | "update" | "disable" | "enable";

function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function normalizePluginSourceInput(value: string): string {
  const match = value.trim().match(/^\$?\s*pi\s+install\s+(\S+)\s*$/);
  return match?.[1] ?? value;
}

function packageKey(pkg: Pick<PluginPackageInfo, "source" | "scope">): string {
  return `${pkg.scope}\0${pkg.source}`;
}

function resourceSummary(pkg: PluginPackageInfo, t: ReturnType<typeof useI18n>["t"]): string {
  if (pkg.disabled) return t("i18n.disabled");
  const parts = [
    pkg.counts.extensions ? t("i18n.resourceCount", { count: pkg.counts.extensions, label: t("i18n.extensionShort") }) : "",
    pkg.counts.skills ? t("i18n.resourceCount", { count: pkg.counts.skills, label: t("i18n.skillShort") }) : "",
    pkg.counts.prompts ? t("i18n.resourceCount", { count: pkg.counts.prompts, label: t("i18n.promptShort") }) : "",
    pkg.counts.themes ? t("i18n.resourceCount", { count: pkg.counts.themes, label: t("i18n.themeShort") }) : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : t("i18n.noResources");
}

function versionSummary(pkg: PluginPackageInfo, t: ReturnType<typeof useI18n>["t"]): string {
  const parts = [];
  if (pkg.version) parts.push(t("i18n.installedVersion", { version: pkg.version }));
  if (pkg.configuredVersion) parts.push(t("i18n.configuredVersion", { version: pkg.configuredVersion }));
  return parts.length ? parts.join(" · ") : t("i18n.unknown");
}

function installLocation(scope: PluginScope, cwd: string): string {
  return scope === "project"
    ? `${shortenPath(cwd)}/.pi/agent/{npm,git}`
    : "~/.pi/agent/{npm,git}";
}

function findInstalledPackage(
  packages: PluginPackageInfo[],
  source: string,
  scope: PluginScope,
): PluginPackageInfo | undefined {
  const trimmed = source.trim();
  const withoutNpmPrefix = trimmed.startsWith("npm:") ? trimmed.slice(4) : trimmed;
  return packages.find((pkg) => pkg.scope === scope && pkg.source === trimmed)
    ?? packages.find((pkg) => pkg.scope === scope && pkg.source === `npm:${withoutNpmPrefix}`)
    ?? packages.find((pkg) => pkg.scope === scope && pkg.source.endsWith(trimmed));
}

function statusColor(status: PluginPackageInfo["status"]): string {
  if (status === "loaded") return "var(--accent)";
  if (status === "installed") return "#f59e0b";
  if (status === "disabled") return "var(--text-dim)";
  return "#ef4444";
}

function ResourceList({ pkg }: { pkg: PluginPackageInfo }) {
  const { t } = useI18n();
  const groups = ([
    ["extension", t("i18n.extensions")],
    ["skill", t("i18n.skills")],
    ["prompt", t("i18n.prompts")],
    ["theme", t("i18n.themes")],
  ] as const)
    .map(([kind, label]) => ({
      kind,
      label,
      resources: pkg.resources.filter((resource) => resource.kind === kind),
    }))
    .filter((group) => group.resources.length > 0);

  if (groups.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
        {pkg.disabled ? t("i18n.packageDisabled") : t("i18n.noResolvedResources")}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {groups.map((group, groupIndex) => (
        <div
          key={group.kind}
          style={{
            borderTop: groupIndex === 0 ? "none" : "1px solid var(--border)",
            paddingTop: groupIndex === 0 ? 0 : 12,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--text-dim)",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            {group.label}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {group.resources.map((resource) => (
              <div key={`${resource.kind}:${resource.path}`} style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={resource.path}
                >
                  {resource.name}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text-dim)",
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginTop: 1,
                  }}
                  title={resource.path}
                >
                  {resource.relativePath}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ScopeTag({ scope }: { scope: PluginScope }) {
  return (
    <span
      style={{
        fontSize: 10,
        padding: "1px 5px",
        borderRadius: 3,
        flexShrink: 0,
        background: scope === "project" ? "rgba(99,102,241,0.12)" : "rgba(120,120,120,0.12)",
        color: scope === "project" ? "rgba(99,102,241,0.85)" : "var(--text-dim)",
      }}
    >
      {scope}
    </span>
  );
}

function buttonStyle(disabled?: boolean, danger?: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    background: danger ? "rgba(239,68,68,0.08)" : "none",
    border: "1px solid var(--border)",
    borderRadius: 6,
    color: danger ? "#ef4444" : "var(--text-muted)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
    opacity: disabled ? 0.5 : 1,
  };
}

function Toggle({
  enabled,
  loading,
  onToggle,
  label,
}: {
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={loading}
      title={label}
      aria-label={label}
      aria-pressed={enabled}
      style={{
        flexShrink: 0,
        width: 40,
        height: 22,
        borderRadius: 11,
        border: "none",
        padding: 0,
        cursor: loading ? "wait" : "pointer",
        background: enabled ? "var(--accent)" : "var(--border)",
        position: "relative",
        transition: "background 0.18s",
        outline: "none",
        opacity: loading ? 0.65 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: enabled ? 21 : 3,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--bg)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
          transition: "left 0.18s cubic-bezier(.4,0,.2,1)",
        }}
      />
    </button>
  );
}

function SegmentedScope({
  value,
  projectResourcesLoaded,
  onChange,
}: {
  value: PluginScope;
  projectResourcesLoaded: boolean;
  onChange: (scope: PluginScope) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid var(--border)",
        borderRadius: 7,
        overflow: "hidden",
        height: 30,
      }}
    >
      {(["global", "project"] as PluginScope[]).map((scope) => {
        const active = value === scope;
        const disabled = scope === "project" && !projectResourcesLoaded;
        return (
          <button
            key={scope}
            onClick={() => {
              if (!disabled) onChange(scope);
            }}
            disabled={disabled}
            title={disabled ? t("trust.projectScopeUnavailable") : undefined}
            style={{
              width: 76,
              border: "none",
              borderRight: scope === "global" ? "1px solid var(--border)" : "none",
              background: active ? "var(--bg-selected)" : "none",
              color: active ? "var(--text)" : "var(--text-muted)",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.45 : 1,
              fontSize: 12,
            }}
          >
            {scope}
          </button>
        );
      })}
    </div>
  );
}

function AddPluginPanel({
  cwd,
  source,
  scope,
  projectResourcesLoaded,
  busy,
  actionError,
  onSourceChange,
  onScopeChange,
  onInstall,
}: {
  cwd: string;
  source: string;
  scope: PluginScope;
  projectResourcesLoaded: boolean;
  busy: boolean;
  actionError: string | null;
  onSourceChange: (value: string) => void;
  onScopeChange: (scope: PluginScope) => void;
  onInstall: () => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const examples = ["npm:@scope/pi-plugin", "git:https://github.com/user/repo", "/absolute/path/to/plugin"];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 660, minHeight: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
            {t("i18n.addPlugin")}
          </div>
          <a
            href="https://pi.dev/packages"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              color: "var(--accent)",
              fontSize: 12,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 800 800" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
              <path
                fill="#000"
                fillRule="evenodd"
                d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
              />
              <path fill="#000" d="M517.36 400H634.72V634.72H517.36Z" />
            </svg>
            pi.dev/packages
          </a>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
          {installLocation(scope, cwd)}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <label htmlFor="plugin-source" style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
          Source
        </label>
        <input
          id="plugin-source"
          ref={inputRef}
          value={source}
          onChange={(e) => onSourceChange(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            const normalized = normalizePluginSourceInput(pasted);
            if (normalized === pasted) return;
            e.preventDefault();
            onSourceChange(normalized);
          }}
          onBlur={(e) => onSourceChange(normalizePluginSourceInput(e.currentTarget.value))}
          placeholder="npm:@scope/package"
          style={{
            width: "100%",
            height: 36,
            padding: "0 11px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg-panel)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            outline: "none",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && source.trim() && !busy) onInstall();
          }}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <SegmentedScope
          value={scope}
          projectResourcesLoaded={projectResourcesLoaded}
          onChange={onScopeChange}
        />
        <button
          type="button"
          onClick={onInstall}
          disabled={busy || !source.trim()}
          style={{
            ...buttonStyle(busy || !source.trim()),
            background: "var(--accent)",
            color: "white",
            borderColor: "var(--accent)",
          }}
        >
          {busy ? t("i18n.installing") : t("i18n.install")}
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
          Examples
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onSourceChange(example)}
              style={{
                width: "100%",
                minHeight: 30,
                textAlign: "left",
                padding: "6px 9px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg-panel)",
                color: "var(--text-dim)",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-panel)";
                e.currentTarget.style.color = "var(--text-dim)";
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <div style={{ fontSize: 12, color: "#ef4444", whiteSpace: "pre-wrap" }}>
          {actionError}
        </div>
      )}
    </div>
  );
}

function PackageDetail({
  pkg,
  cwd,
  busyKey,
  actionError,
  actionMessage,
  sessionId,
  onAction,
  onReloadSession,
}: {
  pkg: PluginPackageInfo;
  cwd: string;
  busyKey: string | null;
  actionError: string | null;
  actionMessage: string | null;
  sessionId: string | null;
  onAction: (action: PluginAction, pkg: PluginPackageInfo) => void;
  onReloadSession: () => void;
}) {
  const { t } = useI18n();
  const key = packageKey(pkg);
  const busy = busyKey?.endsWith(key) ?? false;
  const reloadBusy = busyKey === "reload";
  const enabled = !pkg.disabled;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 680 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, minWidth: 0, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 180, flex: 1 }}>
          <Toggle
            enabled={enabled}
            loading={busy || reloadBusy}
            onToggle={() => onAction(pkg.disabled ? "enable" : "disable", pkg)}
            label={pkg.disabled ? t("i18n.enablePackage") : t("i18n.disablePackage")}
          />
          <ScopeTag scope={pkg.scope} />
          {pkg.disabled ? (
            <span
              style={{
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 3,
                background: "rgba(120,120,120,0.12)",
                color: "var(--text-dim)",
              }}
            >
              {t("i18n.disabled")}
            </span>
          ) : pkg.filtered && (
            <span
              style={{
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 3,
                background: "rgba(245,158,11,0.12)",
                color: "#d97706",
              }}
            >
              {t("i18n.filtered")}
            </span>
          )}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {pkg.source}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => onAction("update", pkg)}
            disabled={busy || reloadBusy}
            style={buttonStyle(busy || reloadBusy)}
          >
             {busyKey === `update:${key}` ? t("i18n.updating") : t("i18n.update")}
          </button>
          <button
            onClick={onReloadSession}
            disabled={!sessionId || reloadBusy || busy}
            style={buttonStyle(!sessionId || reloadBusy || busy)}
             title={sessionId ? t("i18n.reloadSession") : t("i18n.openSessionToReload")}
          >
             {reloadBusy ? t("i18n.reloading") : t("i18n.reloadSession")}
          </button>
          <button
            onClick={() => onAction("remove", pkg)}
            disabled={busy || reloadBusy}
            style={buttonStyle(busy || reloadBusy, true)}
          >
             {busyKey === `remove:${key}` ? t("i18n.removing") : t("i18n.remove")}
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(96px, 130px) minmax(0, 1fr)",
          gap: "9px 14px",
          fontSize: 12,
          lineHeight: 1.45,
        }}
      >
        <div style={{ color: "var(--text-dim)" }}>{t("i18n.status")}</div>
        <div style={{ color: statusColor(pkg.status), textTransform: "capitalize" }}>{pkg.status}</div>
        <div style={{ color: "var(--text-dim)" }}>{t("i18n.version")}</div>
         <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{versionSummary(pkg, t)}</div>
        <div style={{ color: "var(--text-dim)" }}>{t("i18n.package")}</div>
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
          {pkg.packageName ?? t("i18n.unknown")}
        </div>
        <div style={{ color: "var(--text-dim)" }}>{t("i18n.resources")}</div>
         <div style={{ color: "var(--text-muted)" }}>{resourceSummary(pkg, t)}</div>
        <div style={{ color: "var(--text-dim)" }}>{t("i18n.installedPath")}</div>
        <div
          style={{
            color: pkg.installedPath ? "var(--text-muted)" : "#ef4444",
            fontFamily: "var(--font-mono)",
            overflowWrap: "anywhere",
          }}
        >
          {pkg.installedPath ? shortenPath(pkg.installedPath) : t("i18n.notFound")}
        </div>
        <div style={{ color: "var(--text-dim)" }}>{t("i18n.cwd")}</div>
        <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
          {shortenPath(cwd)}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
          {t("i18n.resolvedResources")}
        </div>
        <ResourceList pkg={pkg} />
      </div>

      {actionMessage && (
        <div style={{ fontSize: 12, color: "#16a34a" }}>
          {actionMessage}
        </div>
      )}
      {actionError && (
        <div style={{ fontSize: 12, color: "#ef4444", whiteSpace: "pre-wrap" }}>
          {actionError}
        </div>
      )}
    </div>
  );
}

function McpServerDetail({
  server,
  cwd,
  busy,
  actionError,
  actionMessage,
  onToggle,
  onRemove,
  onMove,
  onTest,
  onEdit,
}: {
  server: McpServerInfo;
  cwd: string;
  busy: boolean;
  actionError: string | null;
  actionMessage: string | null;
  onToggle: () => void;
  onRemove: () => void;
  onMove: () => void;
  onTest: () => void;
  onEdit: () => void;
}) {
  const enabled = !server.disabled;
  const otherScope = server.scope === "project" ? "global" : "project";
  const target =
    server.kind === "url" ? server.url : server.kind === "socket" ? server.socket : server.command;
  const row: React.CSSProperties = { color: "var(--text-dim)" };
  const val: React.CSSProperties = {
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono)",
    overflowWrap: "anywhere",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 680 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          minWidth: 0,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 180, flex: 1 }}>
          <Toggle
            enabled={enabled}
            loading={busy}
            onToggle={onToggle}
            label={enabled ? "禁用" : "启用"}
          />
          <ScopeTag scope={server.scope} />
          {server.disabled && (
            <span
              style={{
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 3,
                background: "rgba(120,120,120,0.12)",
                color: "var(--text-dim)",
              }}
            >
              已禁用
            </span>
          )}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {server.name}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onTest} disabled={busy} style={buttonStyle(busy)}>
            {busy ? "测试中..." : "测试连接"}
          </button>
          <button onClick={onEdit} disabled={busy} style={buttonStyle(busy)}>
            编辑
          </button>
          <button onClick={onMove} disabled={busy} style={buttonStyle(busy)}>
            移动至{otherScope}
          </button>
          <button onClick={onRemove} disabled={busy} style={buttonStyle(busy, true)}>
            删除
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(96px, 130px) minmax(0, 1fr)",
          gap: "9px 14px",
          fontSize: 12,
          lineHeight: 1.45,
        }}
      >
        <div style={row}>类型</div>
        <div style={val}>{server.kind}</div>
        <div style={row}>{server.kind === "url" ? "URL" : server.kind === "socket" ? "Socket" : "命令"}</div>
        <div style={val}>{target ?? "—"}</div>
        {server.kind === "command" && (
          <>
            <div style={row}>参数</div>
            <div style={val}>{server.args.length ? server.args.join(" ") : "—"}</div>
          </>
        )}
        <div style={row}>环境变量</div>
        <div style={val}>{server.envKeys.length ? server.envKeys.join(", ") : "—"}</div>
        <div style={row}>选项</div>
        <div style={val}>
          {Object.keys(server.options).length ? JSON.stringify(server.options) : "—"}
        </div>
        <div style={row}>来源</div>
        <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
          {shortenPath(server.source)}
        </div>
        <div style={row}>CWD</div>
        <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
          {shortenPath(cwd)}
        </div>
      </div>

      {actionMessage && (
        <div style={{ fontSize: 12, color: "#16a34a", whiteSpace: "pre-wrap" }}>{actionMessage}</div>
      )}
      {actionError && (
        <div style={{ fontSize: 12, color: "#ef4444", whiteSpace: "pre-wrap" }}>{actionError}</div>
      )}
    </div>
  );
}

function AddMcpServer({
  cwd,
  scope,
  projectResourcesLoaded,
  busy,
  actionError,
  initial,
  onScopeChange,
  onSave,
  onFetchDef,
  onCancel,
}: {
  cwd: string;
  scope: McpScope;
  projectResourcesLoaded: boolean;
  busy: boolean;
  actionError: string | null;
  initial?: McpServerInfo | null;
  onScopeChange: (scope: McpScope) => void;
  onSave: (name: string, def: Record<string, unknown>) => void;
  onFetchDef: (name: string, serverScope: McpScope) => Promise<Record<string, unknown> | null>;
  onCancel: () => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(isEdit && initial ? initial.name : "");
  const [spec, setSpec] = useState(() => {
    if (!initial) return "";
    if (initial.kind === "command") return [initial.command, ...initial.args].join(" ");
    return initial.url ?? initial.socket ?? "";
  });
  const [argsText, setArgsText] = useState("");
  const [mode, setMode] = useState<"basic" | "json">("basic");
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [loadingJson, setLoadingJson] = useState(false);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: 36,
    padding: "0 11px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-panel)",
    color: "var(--text)",
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    outline: "none",
  };
  const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--text-muted)" };
  const isUrl = /^https?:\/\//.test(spec.trim());

  const buildBasicDef = (): Record<string, unknown> => {
    const specTrim = spec.trim();
    if (/^https?:\/\//.test(specTrim)) return { url: specTrim };
    const tokens = specTrim.split(/\s+/);
    const command = tokens[0] ?? "";
    const extra = argsText.trim() ? argsText.trim().split(/\s+/) : [];
    return { command, args: [...tokens.slice(1), ...extra] };
  };

  const switchToJson = async (): Promise<void> => {
    setJsonError(null);
    if (jsonText !== null) {
      setMode("json");
      return;
    }
    if (isEdit && initial) {
      setMode("json");
      setLoadingJson(true);
      try {
        const def = await onFetchDef(initial.name, initial.scope);
        setJsonText(JSON.stringify(def ?? buildBasicDef(), null, 2));
      } finally {
        setLoadingJson(false);
      }
    } else {
      setJsonText(JSON.stringify(buildBasicDef(), null, 2));
      setMode("json");
    }
  };

  const handleSave = (): void => {
    setJsonError(null);
    if (mode === "json") {
      const text = jsonText ?? "";
      if (!text.trim()) {
        setJsonError("JSON 不能为空");
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        setJsonError(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setJsonError('JSON 必须是对象，如 {"command":"npx","args":["-y","..."]}');
        return;
      }
      const def = parsed as Record<string, unknown>;
      if (!def.command && !def.url && !def.socket) {
        setJsonError("JSON 需要包含 command、url 或 socket 之一");
        return;
      }
      onSave(name, def);
      return;
    }
    onSave(name, buildBasicDef());
  };

  const canSave =
    name.trim() &&
    (mode === "json" ? (jsonText ?? "").trim().length > 0 : spec.trim().length > 0);

  const jsonEditorStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 200,
    padding: "9px 11px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-panel)",
    color: "var(--text)",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    lineHeight: 1.5,
    outline: "none",
    resize: "vertical",
    whiteSpace: "pre",
    overflow: "auto",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 660, minHeight: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
          {isEdit ? `编辑 MCP：${initial?.name ?? ""}` : "添加 MCP 服务器"}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
          {scope === "project" ? `${shortenPath(cwd)}/.pi/mcp.json` : "~/.pi/agent/mcp.json"}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {(["basic", "json"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => (m === "json" ? void switchToJson() : setMode("basic"))}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              cursor: "pointer",
              fontSize: 12,
              background: mode === m ? "var(--accent)" : "none",
              color: mode === m ? "white" : "var(--text-muted)",
            }}
          >
            {m === "basic" ? "基础配置" : "JSON 高级"}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <label style={labelStyle}>名称</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如 github"
          style={inputStyle}
        />
      </div>

      {mode === "json" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <label style={labelStyle}>
            服务器定义（JSON）—— 支持 command/url/socket、args、env、lifecycle、directTools、timeout 等全部字段
          </label>
          {loadingJson ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>加载配置中...</div>
          ) : (
            <textarea
              value={jsonText ?? ""}
              onChange={(e) => setJsonText(e.target.value)}
              spellCheck={false}
              placeholder={
                '{\n  "command": "npx",\n  "args": ["-y", "@modelcontextprotocol/server-github"],\n  "env": {}\n}'
              }
              style={jsonEditorStyle}
            />
          )}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <label style={labelStyle}>命令 或 URL（http/https 开头识别为 URL）</label>
            <input
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              placeholder="npx -y @modelcontextprotocol/server-github  或  https://example.com/mcp"
              style={inputStyle}
            />
          </div>

          {!isUrl && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <label style={labelStyle}>附加参数（可选，空格分隔）</label>
              <input value={argsText} onChange={(e) => setArgsText(e.target.value)} style={inputStyle} />
            </div>
          )}
        </>
      )}

      {jsonError && (
        <div style={{ fontSize: 12, color: "#ef4444", whiteSpace: "pre-wrap" }}>{jsonError}</div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <SegmentedScope
          value={scope}
          projectResourcesLoaded={projectResourcesLoaded}
          onChange={onScopeChange}
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={busy || !canSave}
          style={{
            ...buttonStyle(busy || !canSave),
            background: "var(--accent)",
            color: "white",
            borderColor: "var(--accent)",
          }}
        >
          {busy ? "保存中..." : isEdit ? "保存修改" : "保存"}
        </button>
        <button type="button" onClick={onCancel} style={buttonStyle(false)}>
          取消
        </button>
      </div>

      {actionError && (
        <div style={{ fontSize: 12, color: "#ef4444", whiteSpace: "pre-wrap" }}>{actionError}</div>
      )}
    </div>
  );
}

export function PluginsConfig({
  cwd,
  sessionId,
  onClose,
  onReloaded,
}: {
  cwd: string;
  sessionId: string | null;
  onClose: () => void;
  onReloaded?: () => void;
}) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [data, setData] = useState<PluginsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [installSource, setInstallSource] = useState("");
  const [installScope, setInstallScope] = useState<PluginScope>("global");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  // MCP-related state
  const [view, setView] = useState<"plugins" | "mcp">("plugins");
  const [mcpData, setMcpData] = useState<McpResponse | null>(null);
  const [mcpLoading, setMcpLoading] = useState(true);
  const [mcpSelected, setMcpSelected] = useState<string | null>(null);
  const [mcpAddMode, setMcpAddMode] = useState(false);
  const [mcpScope, setMcpScope] = useState<McpScope>("global");
  const [mcpEditTarget, setMcpEditTarget] = useState<McpServerInfo | null>(null);
  const [mcpActionError, setMcpActionError] = useState<string | null>(null);
  const [mcpActionMessage, setMcpActionMessage] = useState<string | null>(null);
  const [mcpTesting, setMcpTesting] = useState<string | null>(null);

  const packages = useMemo(() => data?.packages ?? [], [data?.packages]);
  const selectedPackage = packages.find((pkg) => packageKey(pkg) === selected) ?? null;
  const projectResourcesLoaded = data?.projectResourcesLoaded ?? true;
  const selectedMcp = useMemo(
    () => mcpData?.servers.find((s) => s.name === mcpSelected) ?? null,
    [mcpData, mcpSelected],
  );
  const groupedMcp = useMemo(() => {
    return (["project", "global"] as McpScope[])
      .map((scope) => ({ scope, servers: (mcpData?.servers ?? []).filter((s) => s.scope === scope) }))
      .filter((group) => group.servers.length > 0);
  }, [mcpData]);

  const groupedPackages = useMemo(() => {
    return (["project", "global"] as PluginScope[])
      .map((scope) => ({ scope, packages: packages.filter((pkg) => pkg.scope === scope) }))
      .filter((group) => group.packages.length > 0);
  }, [packages]);

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/plugins?cwd=${encodeURIComponent(cwd)}`);
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      setAddMode((current) => next.packages.length === 0 || current);
      setSelected((current) => {
        if (current && next.packages.some((pkg) => packageKey(pkg) === current)) return current;
        return next.packages[0] ? packageKey(next.packages[0]) : null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const loadMcp = useCallback(async () => {
    setMcpLoading(true);
    setMcpActionError(null);
    try {
      const res = await fetch(`/api/mcp?cwd=${encodeURIComponent(cwd)}`);
      const next = (await res.json()) as McpResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setMcpData(next);
      setMcpSelected((current) =>
        current && next.servers.some((s) => s.name === current)
          ? current
          : next.servers[0]?.name ?? null,
      );
    } catch (err) {
      setMcpActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadMcp();
  }, [loadMcp]);

  const runMcpAction = useCallback(
    async (action: string, payload: Record<string, unknown>): Promise<McpResponse | null> => {
      setBusyKey(`mcp:${action}`);
      setMcpActionError(null);
      setMcpActionMessage(null);
      try {
        const res = await fetch("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, action, ...payload }),
        });
        const next = (await res.json()) as McpResponse & { error?: string };
        if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
        setMcpData(next);
        return next;
      } catch (err) {
        setMcpActionError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setBusyKey(null);
      }
    },
    [cwd],
  );

  const toggleMcp = useCallback(
    async (server: McpServerInfo) => {
      const next = await runMcpAction(server.disabled ? "enable" : "disable", {
        name: server.name,
        scope: server.scope,
      });
      if (next) {
        setMcpActionMessage(
          server.disabled
            ? `已启用 ${server.name}（执行 /reload 生效）`
            : `已禁用 ${server.name}（执行 /reload 生效）`,
        );
      }
    },
    [runMcpAction],
  );

  const removeMcp = useCallback(
    async (server: McpServerInfo) => {
      const next = await runMcpAction("remove", { name: server.name, scope: server.scope });
      if (next) {
        setMcpSelected(next.servers[0]?.name ?? null);
        setMcpActionMessage(`已删除 ${server.name}`);
        if (next.servers.length === 0) setMcpAddMode(true);
      }
    },
    [runMcpAction],
  );

  const moveMcp = useCallback(
    async (server: McpServerInfo) => {
      const to = server.scope === "project" ? "global" : "project";
      const next = await runMcpAction("move", {
        name: server.name,
        fromScope: server.scope,
        toScope: to,
      });
      if (next) setMcpActionMessage(`已移动 ${server.name} → ${to}（执行 /reload 生效）`);
    },
    [runMcpAction],
  );

  const saveMcp = useCallback(
    async (name: string, def: Record<string, unknown>) => {
      const isEdit = !!mcpEditTarget;
      const action = isEdit ? "update" : "add";
      const nameFinal = isEdit && mcpEditTarget ? mcpEditTarget.name : name.trim();
      const next = await runMcpAction(action, { name: nameFinal, scope: mcpScope, def });
      if (next) {
        setMcpSelected(nameFinal);
        setMcpAddMode(false);
        setMcpEditTarget(null);
        setMcpActionMessage(
          isEdit ? `已更新 ${nameFinal}（执行 /reload 生效）` : `已添加 ${nameFinal}（执行 /reload 生效）`,
        );
      }
    },
    [mcpScope, mcpEditTarget, runMcpAction],
  );

  const fetchMcpDef = useCallback(
    async (name: string, serverScope: McpScope): Promise<Record<string, unknown> | null> => {
      try {
        const res = await fetch("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, action: "get", name, scope: serverScope }),
        });
        const json = (await res.json()) as { def?: Record<string, unknown>; error?: string };
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
        return json.def ?? null;
      } catch {
        return null;
      }
    },
    [cwd],
  );

  const testMcp = useCallback(
    async (server: McpServerInfo) => {
      setMcpTesting(server.name);
      setMcpActionError(null);
      setMcpActionMessage(null);
      try {
        const res = await fetch("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, action: "test", name: server.name, scope: server.scope }),
        });
        const json = (await res.json()) as { ok?: boolean; message?: string; error?: string };
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
        setMcpActionMessage(`测试 ${server.name}：${json.message}`);
      } catch (err) {
        setMcpActionError(`测试 ${server.name}：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setMcpTesting(null);
      }
    },
    [cwd],
  );

  const runAction = useCallback(async (action: PluginAction, pkg: PluginPackageInfo) => {
    const key = packageKey(pkg);
    setBusyKey(`${action}:${key}`);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, source: pkg.source, scope: pkg.scope, cwd }),
      });
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      if (action === "remove") {
        setSelected(next.packages[0] ? packageKey(next.packages[0]) : null);
        if (next.packages.length === 0) setAddMode(true);
        setActionMessage("Package removed.");
      } else {
        const messages: Record<Exclude<PluginAction, "remove">, string> = {
          install: "Package installed.",
          update: "Package updated.",
          disable: "Package disabled.",
          enable: "Package enabled.",
        };
        setActionMessage(messages[action]);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [cwd]);

  const installPlugin = useCallback(async () => {
    const source = normalizePluginSourceInput(installSource).trim();
    if (!source) return;
    setInstallSource(source);
    const key = `${installScope}\0${source}`;
    setBusyKey(`install:${key}`);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install", source, scope: installScope, cwd }),
      });
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      const installed = findInstalledPackage(next.packages, source, installScope);
      setSelected(installed ? packageKey(installed) : key);
      setAddMode(false);
      setInstallSource("");
      setActionMessage("Package installed.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [cwd, installScope, installSource]);

  const reloadSession = useCallback(async () => {
    if (!sessionId) return;
    setBusyKey("reload");
    setActionError(null);
    setActionMessage(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      onReloaded?.();
      await loadPlugins();
      setActionMessage("Session reloaded.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [loadPlugins, onReloaded, sessionId]);

  const addBusy = busyKey?.startsWith("install:") ?? false;
  const mcpBusy = busyKey?.startsWith("mcp:") ?? false;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: isMobile ? "calc(100vw - 16px)" : 860,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : "76vh",
          maxHeight: "calc(100dvh - 16px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              {t("common.plugins")}
            </span>
            <code
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {shortenPath(cwd)}
            </code>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>

        {!projectResourcesLoaded && (
          <div
            role="status"
            style={{
              padding: "8px 18px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              fontSize: 12,
            }}
          >
            {t("trust.pluginsNotLoaded")}
          </div>
        )}

        <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>
          <div
            style={{
              width: isMobile ? "100%" : 245,
              maxHeight: isMobile ? "40vh" : undefined,
              borderRight: isMobile ? "none" : "1px solid var(--border)",
              borderBottom: isMobile ? "1px solid var(--border)" : "none",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              background: "var(--bg-panel)",
            }}
          >
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
              {loading ? (
                <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-muted)" }}>
                  Loading...
                </div>
              ) : error ? (
                <div style={{ padding: "10px 8px", fontSize: 11, color: "#ef4444" }}>
                  {error}
                </div>
              ) : packages.length === 0 ? (
                <div style={{ padding: "10px 8px", fontSize: 11, color: "var(--text-dim)" }}>
                  No plugins configured
                </div>
              ) : (
                groupedPackages.map((group) => (
                  <div key={group.scope} style={{ marginBottom: 6 }}>
                    <div
                      style={{
                        padding: "4px 8px 3px",
                        fontSize: 10,
                        fontWeight: 600,
                        color: "var(--text-dim)",
                        textTransform: "uppercase",
                      }}
                    >
                      {group.scope}
                    </div>
                    {group.packages.map((pkg) => {
                      const key = packageKey(pkg);
                      const isSelected = !addMode && selected === key;
                      return (
                        <div
                          key={key}
                          onClick={() => {
                            setView("plugins");
                            setSelected(key);
                            setAddMode(false);
                            setActionError(null);
                            setActionMessage(null);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            padding: "8px 8px",
                            borderRadius: 5,
                            cursor: "pointer",
                            background: isSelected ? "var(--bg-selected)" : "none",
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)";
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) e.currentTarget.style.background = "none";
                          }}
                        >
                          <span
                            style={{
                              flexShrink: 0,
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              background: statusColor(pkg.status),
                            }}
                          />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: isSelected ? 600 : 400,
                                color: "var(--text)",
                                fontFamily: "var(--font-mono)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {pkg.source}
                            </div>
                            <div
                              style={{
                                fontSize: 10,
                                color: "var(--text-dim)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                marginTop: 2,
                              }}
                            >
                              {resourceSummary(pkg, t)}
                            </div>
                            {(pkg.version || pkg.configuredVersion) && (
                              <div
                                style={{
                                  fontSize: 10,
                                  color: "var(--text-dim)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  marginTop: 2,
                                }}
                              >
                                 {versionSummary(pkg, t)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
              <div
                style={{
                  marginTop: 10,
                  borderTop: "1px solid var(--border)",
                  paddingTop: 8,
                }}
              >
                <div
                  style={{
                    padding: "4px 8px 3px",
                    fontSize: 10,
                    fontWeight: 600,
                    color: "var(--text-dim)",
                    textTransform: "uppercase",
                  }}
                >
                  MCP 服务器
                </div>
                {mcpLoading ? (
                  <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-muted)" }}>
                    Loading...
                  </div>
                ) : !mcpData && mcpActionError ? (
                  <div style={{ padding: "10px 8px", fontSize: 11, color: "#ef4444" }}>
                    {mcpActionError}
                  </div>
                ) : (mcpData?.servers.length ?? 0) === 0 ? (
                  <div style={{ padding: "10px 8px", fontSize: 11, color: "var(--text-dim)" }}>
                    暂无 MCP 服务器，点击下方"添加MCP"创建
                  </div>
                ) : (
                  groupedMcp.map((group) => (
                    <div key={group.scope} style={{ marginBottom: 6 }}>
                      <div
                        style={{
                          padding: "4px 8px 3px",
                          fontSize: 10,
                          fontWeight: 600,
                          color: "var(--text-dim)",
                          textTransform: "uppercase",
                        }}
                      >
                        {group.scope}
                      </div>
                      {group.servers.map((server) => {
                        const isMcpSelected =
                          view === "mcp" && !mcpAddMode && mcpSelected === server.name;
                        return (
                          <div
                            key={server.name}
                            onClick={() => {
                              setView("mcp");
                              setMcpSelected(server.name);
                              setMcpAddMode(false);
                              setMcpEditTarget(null);
                              setMcpActionError(null);
                              setMcpActionMessage(null);
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 7,
                              padding: "8px 8px",
                              borderRadius: 5,
                              cursor: "pointer",
                              background: isMcpSelected ? "var(--bg-selected)" : "none",
                            }}
                            onMouseEnter={(e) => {
                              if (!isMcpSelected) e.currentTarget.style.background = "var(--bg-hover)";
                            }}
                            onMouseLeave={(e) => {
                              if (!isMcpSelected) e.currentTarget.style.background = "none";
                            }}
                          >
                            <span
                              style={{
                                flexShrink: 0,
                                width: 7,
                                height: 7,
                                borderRadius: "50%",
                                background: server.disabled ? "var(--text-dim)" : "var(--accent)",
                              }}
                            />
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: isMcpSelected ? 600 : 400,
                                  color: "var(--text)",
                                  fontFamily: "var(--font-mono)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {server.name}
                              </div>
                              <div
                                style={{
                                  fontSize: 10,
                                  color: "var(--text-dim)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  marginTop: 2,
                                }}
                              >
                                {server.kind} · {server.disabled ? "已禁用" : "已启用"}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: "8px 6px",
                borderTop: "1px solid var(--border)",
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setView("plugins");
                  setAddMode(true);
                  setActionError(null);
                  setActionMessage(null);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 8px",
                  borderRadius: 5,
                  border: "none",
                  width: "100%",
                  cursor: "pointer",
                  background: addMode ? "var(--bg-selected)" : "none",
                  color: addMode ? "var(--accent)" : "var(--text-dim)",
                  fontSize: 12,
                }}
                onMouseEnter={(e) => {
                  if (!addMode) e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!addMode) e.currentTarget.style.background = "none";
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                 {t("i18n.addPlugin")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setView("mcp");
                  setMcpAddMode(true);
                  setMcpEditTarget(null);
                  setMcpActionError(null);
                  setMcpActionMessage(null);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 8px",
                  borderRadius: 5,
                  border: "none",
                  width: "100%",
                  cursor: "pointer",
                  background: mcpAddMode && view === "mcp" ? "var(--bg-selected)" : "none",
                  color: mcpAddMode && view === "mcp" ? "var(--accent)" : "var(--text-dim)",
                  fontSize: 12,
                }}
                onMouseEnter={(e) => {
                  if (!(mcpAddMode && view === "mcp"))
                    e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!(mcpAddMode && view === "mcp")) e.currentTarget.style.background = "none";
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
                </svg>
                添加MCP
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {view === "mcp" ? (
              mcpAddMode ? (
                <AddMcpServer
                  cwd={cwd}
                  scope={mcpScope}
                  projectResourcesLoaded={projectResourcesLoaded}
                  busy={mcpBusy}
                  actionError={mcpActionError}
                  initial={mcpEditTarget}
                  onScopeChange={setMcpScope}
                  onSave={(name, def) => void saveMcp(name, def)}
                  onFetchDef={fetchMcpDef}
                  onCancel={() => {
                    setMcpAddMode(false);
                    setMcpEditTarget(null);
                  }}
                />
              ) : selectedMcp ? (
                <McpServerDetail
                  key={selectedMcp.name}
                  server={selectedMcp}
                  cwd={cwd}
                  busy={mcpBusy || mcpTesting === selectedMcp.name}
                  actionError={mcpActionError}
                  actionMessage={mcpActionMessage}
                  onToggle={() => void toggleMcp(selectedMcp)}
                  onRemove={() => void removeMcp(selectedMcp)}
                  onMove={() => void moveMcp(selectedMcp)}
                  onTest={() => void testMcp(selectedMcp)}
                  onEdit={() => {
                    setMcpEditTarget(selectedMcp);
                    setMcpAddMode(true);
                    setMcpActionError(null);
                    setMcpActionMessage(null);
                  }}
                />
              ) : (
                <div
                  style={{
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--text-dim)",
                    fontSize: 13,
                  }}
                >
                  选择左侧一个 MCP 服务器，或点击"添加MCP"
                </div>
              )
            ) : addMode ? (
              <AddPluginPanel
                cwd={cwd}
                source={installSource}
                scope={installScope}
                projectResourcesLoaded={projectResourcesLoaded}
                busy={addBusy}
                actionError={actionError}
                onSourceChange={setInstallSource}
                onScopeChange={setInstallScope}
                onInstall={installPlugin}
              />
            ) : loading ? null : selectedPackage ? (
              <PackageDetail
                key={packageKey(selectedPackage)}
                pkg={selectedPackage}
                cwd={cwd}
                busyKey={busyKey}
                actionError={actionError}
                actionMessage={actionMessage}
                sessionId={sessionId}
                onAction={runAction}
                onReloadSession={reloadSession}
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-dim)",
                  fontSize: 13,
                }}
              >
                {t("i18n.selectPackage")}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0, flex: 1, fontSize: 11, color: "var(--text-dim)", overflow: "hidden" }}>
            {data?.diagnostics.length ? (
              <span
                title={data.diagnostics.map((d) => `${d.type}: ${d.source ? `${d.source}: ` : ""}${d.message}`).join("\n")}
                style={{ color: data.diagnostics.some((d) => d.type === "error") ? "#ef4444" : "#d97706" }}
              >
                {data.diagnostics.length} diagnostic{data.diagnostics.length === 1 ? "" : "s"}
              </span>
            ) : (
              <span>
                {data ? `${data.totals.extensions} ext · ${data.totals.skills} skills · ${data.totals.prompts} prompts · ${data.totals.themes} themes` : ""}
              </span>
            )}
          </div>
          <button onClick={() => void loadPlugins()} disabled={loading || busyKey !== null} style={buttonStyle(loading || busyKey !== null)}>
             {t("i18n.refresh")}
          </button>
          <button onClick={onClose} style={buttonStyle(false)}>
             {t("i18n.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
