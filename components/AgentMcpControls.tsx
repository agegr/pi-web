"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import type { McpResponse, McpServerInfo } from "@/lib/api-types";
import type { SubagentMcpServerRef } from "@/lib/subagents";
import { revealHiddenCharacters } from "@/lib/mcp-server-display";
import { mcpRowContext, mcpServerKey, mcpServerRowState, MCP_ROW_STATE_DETAIL_KEYS, MCP_ROW_STATE_LABEL_KEYS } from "./mcp-config-helpers";
import { bindResourcePickerDismissal, closeResourcePicker, observeResourcePickerVisibility, openResourcePickerDialog, resourcePickerLayout } from "./AgentResourceControls";
import { ConfigButton, ConfigEmptyState, ConfigScopeTag, ConfigSwitch } from "./SettingsUi";

/** Exact file identity, never a normalized namespace or a filesystem resource. */
export function hasAgentMcpRef(refs: readonly SubagentMcpServerRef[], server: SubagentMcpServerRef): boolean {
  return refs.some((ref) => ref.scope === server.scope && ref.name === server.name);
}

export function toggleAgentMcpRef(refs: readonly SubagentMcpServerRef[], server: SubagentMcpServerRef, checked: boolean): SubagentMcpServerRef[] {
  const remaining = refs.filter((ref) => ref.scope !== server.scope || ref.name !== server.name);
  return checked ? [...remaining, { scope: server.scope, name: server.name }] : remaining;
}

/** File/trust availability only; a past failed connection never grants or denies selection. */
export function agentMcpBlock(server: McpServerInfo, overview: McpResponse): string | undefined {
  const state = mcpServerRowState({ ...server, status: undefined }, mcpRowContext(overview));
  return state === "on" ? undefined : MCP_ROW_STATE_DETAIL_KEYS[state] ?? MCP_ROW_STATE_LABEL_KEYS[state];
}

export function filterAgentMcpServers(servers: McpServerInfo[], search: string): McpServerInfo[] {
  const query = search.trim().toLowerCase();
  return servers.filter((server) => `${server.scope} ${server.name}`.toLowerCase().includes(query));
}

export function agentMcpBulkState(refs: readonly SubagentMcpServerRef[], overview: McpResponse): "all" | "none" | "partial" {
  const selectable = overview.servers.filter((server) => !agentMcpBlock(server, overview));
  const count = selectable.filter((server) => hasAgentMcpRef(refs, server)).length;
  return count === 0 ? "none" : count === selectable.length ? "all" : "partial";
}

/** Select the complete current eligible list, not the search results; retain dormant/unknown refs. */
export function selectAgentMcpServers(refs: readonly SubagentMcpServerRef[], overview: McpResponse): SubagentMcpServerRef[] {
  const next = refs.map((ref) => ({ ...ref }));
  for (const server of overview.servers) {
    if (!agentMcpBlock(server, overview) && !hasAgentMcpRef(next, server)) next.push({ scope: server.scope, name: server.name });
  }
  return next;
}

/** The existing masked, files-only GET. Even a fetch mock ignoring abort cannot publish stale data. */
export async function readAgentMcpOverview(cwd: string, signal: AbortSignal): Promise<McpResponse | null> {
  const response = await fetch(`/api/mcp?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store", signal });
  const data = await response.json() as McpResponse & { error?: string };
  if (signal.aborted) return null;
  if (!response.ok || data.error || !Array.isArray(data.servers) || !Array.isArray(data.files) || !data.mcp || !data.codemode) {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return data;
}

export function AgentMcpPickerList({ refs, overview, disabled, search, onChange }: {
  refs: SubagentMcpServerRef[]; overview: McpResponse | null; disabled: boolean; search: string;
  onChange: (refs: SubagentMcpServerRef[]) => void;
}) {
  const { t } = useI18n();
  const servers = overview?.servers ?? [];
  const visible = filterAgentMcpServers(servers, search);
  // Until GET succeeds, show chosen references as retained, not falsely unknown.
  const retained = refs.filter((ref) => !hasAgentMcpRef(servers, ref));
  return (
    <div className="agents-resource-picker-list">
      {visible.map((server) => {
        const checked = hasAgentMcpRef(refs, server);
        const block = overview ? agentMcpBlock(server, overview) : undefined;
        return (
          <div key={mcpServerKey(server)} className="agents-resource-row">
            <label className="agents-resource-row-main">
              <input type="checkbox" checked={checked} disabled={disabled || (!checked && !!block)} onChange={(event) => onChange(toggleAgentMcpRef(refs, server, event.target.checked))} />
              <span className="agents-mcp-name">{revealHiddenCharacters(server.name)}</span>
              <ConfigScopeTag scope={server.scope}>{t(`agents.scope.${server.scope}`)}</ConfigScopeTag>
            </label>
            {block && <span className="agents-mcp-row-note">{t(block)}{server.invalidError && <> {revealHiddenCharacters(server.invalidError)}</>}</span>}
          </div>
        );
      })}
      {retained.map((ref) => (
        <div key={mcpServerKey(ref)} className="agents-resource-row is-unknown">
          <label className="agents-resource-row-main">
            <input type="checkbox" checked disabled={disabled} onChange={() => onChange(toggleAgentMcpRef(refs, ref, false))} />
            <span className="agents-mcp-name">{revealHiddenCharacters(ref.name)}</span>
            <ConfigScopeTag scope={ref.scope}>{t(`agents.scope.${ref.scope}`)}</ConfigScopeTag>
          </label>
          <span className="agents-mcp-row-note">{t(overview ? "agents.mcp.unknown" : "agents.mcp.retained")}</span>
        </div>
      ))}
      {visible.length === 0 && retained.length === 0 && <ConfigEmptyState>{t(overview ? "agents.mcp.empty" : "agents.loading")}</ConfigEmptyState>}
    </div>
  );
}

function AgentMcpPicker({ trigger, refs, overview, loading, error, onRetry, onChange, onClose }: {
  trigger: HTMLButtonElement; refs: SubagentMcpServerRef[]; overview: McpResponse | null;
  loading: boolean; error: string | null; onRetry: () => void;
  onChange: (refs: SubagentMcpServerRef[]) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [search, setSearch] = useState("");
  const computeLayout = useCallback(() => {
    const viewport = window.visualViewport;
    return resourcePickerLayout(trigger.getBoundingClientRect(), {
      width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight,
      offsetTop: viewport?.offsetTop, offsetLeft: viewport?.offsetLeft,
    });
  }, [trigger]);
  const [layout, setLayout] = useState(computeLayout);
  const updateLayout = useCallback(() => {
    const next = computeLayout();
    if (next.offscreen || next.maxHeight <= 0) closeRef.current();
    else setLayout(next);
  }, [computeLayout]);
  useEffect(() => {
    updateLayout();
    window.addEventListener("resize", updateLayout);
    window.addEventListener("scroll", updateLayout, true);
    window.visualViewport?.addEventListener("resize", updateLayout);
    window.visualViewport?.addEventListener("scroll", updateLayout);
    return () => {
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("scroll", updateLayout, true);
      window.visualViewport?.removeEventListener("resize", updateLayout);
      window.visualViewport?.removeEventListener("scroll", updateLayout);
    };
  }, [updateLayout]);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !layout.above) return;
    const position = () => { panel.style.top = `${layout.top + Math.max(0, layout.maxHeight - panel.getBoundingClientRect().height)}px`; };
    position();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [layout]);
  // Initial focus runs only on opening, never on filtering/loading/viewport resize.
  useEffect(() => openResourcePickerDialog(document, () => closeResourcePicker(trigger, () => closeRef.current()), panelRef.current, searchRef.current), [trigger]);
  useEffect(() => bindResourcePickerDismissal(document, panelRef.current, trigger, () => closeRef.current()), [trigger]);
  useEffect(() => observeResourcePickerVisibility(window, trigger, () => closeRef.current()), [trigger]);
  const bulk = overview ? agentMcpBulkState(refs, overview) : "none";
  const hasSelectable = overview?.servers.some((server) => !agentMcpBlock(server, overview));
  return createPortal(
    <div ref={panelRef} className="agents-resource-picker" role="dialog" aria-label={t("agents.mcp.label")} tabIndex={-1}
      style={{ position: "fixed", top: layout.top, left: layout.left, width: layout.width, maxHeight: layout.maxHeight, zIndex: 1050 }}>
      <div className="agents-resource-picker-header">
        <strong>{t("agents.mcp.label")}</strong>
        <button type="button" className="agents-resource-picker-bulk" data-state={bulk} aria-pressed={bulk === "partial" ? "mixed" : bulk === "all"}
          aria-label={t(bulk === "all" ? "agents.resource.clearAll" : "agents.resource.selectAll")} disabled={loading || !overview || !hasSelectable}
          onClick={() => overview && onChange(bulk === "all" ? [] : selectAgentMcpServers(refs, overview))}>
          <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false">
            <rect className="agents-resource-bulk-box" x="1" y="1" width="12" height="12" rx="3.2" />
            {bulk === "all" && <path className="agents-resource-bulk-check" d="M3.4 7.3 5.9 9.7 10.7 4.5" />}
            {bulk === "partial" && <rect className="agents-resource-bulk-dash" x="3.6" y="6.4" width="6.8" height="1.4" rx="0.7" />}
          </svg>
        </button>
        <span className="agents-resource-picker-count">{t(refs.length ? "agents.mcp.selectedCount" : "agents.mcp.none", { count: refs.length })}</span>
        <button type="button" className="agents-resource-picker-close" aria-label={t("i18n.close")} onClick={() => closeResourcePicker(trigger, onClose)}>×</button>
      </div>
      <div className="agents-resource-picker-search">
        <input ref={searchRef} type="search" aria-label={t("agents.mcp.search")} placeholder={t("agents.mcp.search")} value={search} autoComplete="off" spellCheck={false} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {loading && <span className="agents-mcp-notice" role="status">{t("agents.loading")}</span>}
      {error && <div className="agents-mcp-notice" role="alert">{error} <ConfigButton size="small" onClick={onRetry}>{t("agents.resource.retry")}</ConfigButton></div>}
      <AgentMcpPickerList refs={refs} overview={overview} disabled={false} search={search} onChange={onChange} />
    </div>, document.body,
  );
}

/** Two independent role intents; all edits stay in the profile's native draft/Save flow. */
export function AgentMcpControls({ cwd, trustKey, profileKey, codeMode, loadMcp, mcpServers, disabled, onCodeModeChange, onLoadMcpChange, onServersChange }: {
  cwd: string; trustKey: string; profileKey: string; codeMode: boolean; loadMcp: boolean;
  mcpServers: SubagentMcpServerRef[]; disabled: boolean;
  onCodeModeChange: (value: boolean) => void; onLoadMcpChange: (value: boolean) => void;
  onServersChange: (refs: SubagentMcpServerRef[]) => void;
}) {
  const { t } = useI18n();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const context = JSON.stringify([cwd, trustKey]);
  const pickerContext = JSON.stringify([context, profileKey, disabled, loadMcp]);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const open = pickerFor === pickerContext && !disabled;
  const [refresh, setRefresh] = useState(0);
  const [listing, setListing] = useState<{ context: string; refresh: number; data: McpResponse } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const needed = open || codeMode || loadMcp;
  const overview = needed && listing?.context === context && listing.refresh === refresh ? listing.data : null;
  useEffect(() => { setPickerFor(null); }, [pickerContext]);
  useEffect(() => {
    if (!needed) return;
    const controller = new AbortController();
    let timedOut = false;
    setListing(null);
    setError(null);
    setLoading(true);
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      setError(t("agents.mcp.timeout"));
      setLoading(false);
    }, 15000);
    void readAgentMcpOverview(cwd, controller.signal).then((data) => {
      if (data && !controller.signal.aborted) setListing({ context, refresh, data });
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      clearTimeout(timer);
      if (!controller.signal.aborted && !timedOut) setLoading(false);
    });
    return () => { clearTimeout(timer); controller.abort(); };
  }, [cwd, context, needed, refresh, t]);
  const unavailable = overview && !overview.mcp.available ? overview.mcp : null;
  const problems = overview?.files.flatMap((file) => file.problems.map((problem) => ({ ...problem, scope: file.scope }))) ?? [];
  const retry = () => setRefresh((value) => value + 1);
  return (
    <div className="agents-resources">
      <div className="agents-resources-grid">
        <div className="agents-resource-summary">
          <span className="agents-resource-summary-label">{t("agents.codeMode")}</span>
          <ConfigSwitch checked={codeMode} disabled={disabled} label={t("agents.codeMode")} onChange={onCodeModeChange} />
        </div>
        <div className="agents-resource-summary">
          <span className="agents-resource-summary-label">{t("agents.mcp.label")}</span>
          <ConfigSwitch checked={loadMcp} disabled={disabled} label={t("agents.mcp.label")} onChange={onLoadMcpChange} />
          <span className="agents-resource-count">{t(mcpServers.length ? "agents.mcp.selectedCount" : "agents.mcp.none", { count: mcpServers.length })}</span>
          <ConfigButton ref={triggerRef} size="small" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => {
            if (open) closeResourcePicker(triggerRef.current, () => setPickerFor(null));
            else { setPickerFor(pickerContext); retry(); }
          }}>{t("agents.resource.choose")}</ConfigButton>
        </div>
      </div>
      {loadMcp === false && mcpServers.length > 0 && <span>{t("agents.mcp.dormant")}</span>}
      {loadMcp && unavailable && <span role="status">{t(unavailable.reason === "builtin-disabled" && !unavailable.settingsPath ? "mcp.unavailable.builtin-disabled-unknown" : `mcp.unavailable.${unavailable.reason}`, { path: revealHiddenCharacters(unavailable.settingsPath ?? "") })}</span>}
      {codeMode && overview?.codemode.sandbox.state === "unavailable" && <span role="status">{t("agents.codeModeUnavailable")}</span>}
      {codeMode && overview?.codemode.builtinDisabled && <span role="status">{t(overview.codemode.builtinSettingsPath ? "mcp.codemode.builtinDisabled" : "mcp.codemode.builtinDisabledUnknown", { path: revealHiddenCharacters(overview.codemode.builtinSettingsPath ?? "") })}</span>}
      {!open && needed && loading && <span role="status">{t("agents.loading")}</span>}
      {!open && needed && error && <div role="alert">{error} <ConfigButton size="small" onClick={retry}>{t("agents.resource.retry")}</ConfigButton></div>}
      {loadMcp && problems.length > 0 && <details><summary>{t("agents.mcp.diagnostics", { count: problems.length })}</summary>{problems.map((problem, index) => <div key={index}>{t(`agents.scope.${problem.scope}`)}: {t(`mcp.fileProblem.${problem.reason}`)}</div>)}</details>}
      {open && triggerRef.current && <AgentMcpPicker trigger={triggerRef.current} refs={mcpServers} overview={overview} loading={loading} error={error} onRetry={retry} onChange={onServersChange} onClose={() => setPickerFor(null)} />}
    </div>
  );
}
