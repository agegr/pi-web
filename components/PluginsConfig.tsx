"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import type {
  PluginPackageInfo,
  PluginStandaloneExtensionInfo,
  PluginUpdateResult,
  PluginsBulkResponse,
  PluginsResponse,
  ProjectTrustStatus,
} from "@/lib/api-types";
import { useI18n } from "@/hooks/useI18n";
import { shortenPath } from "@/lib/display-path";
import {
  getLastSettingsSelection,
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
import {
  ConfigAddSourcePanel,
  ConfigButton,
  ConfigDetail,
  ConfigDetailActions,
  ConfigDetailGrid,
  ConfigDetailGridRow,
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigDetailTitle,
  ConfigEmptyState,
  ConfigFooter,
  ConfigFooterStatus,
  ConfigListAction,
  ConfigPanelShell,
  ConfigScopeSwitch,
  ConfigScopeTag,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarGroupStatus,
  ConfigSidebarGroupSwitch,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSectionTitle,
  ConfigSplitView,
  ConfigStatusDot,
  ConfigSwitch,
  ConfigTrustNotice,
} from "./SettingsUi";
import { itemsToSwitch, projectTrustReloadKey } from "./settings-ui-helpers";

type PluginScope = PluginPackageInfo["scope"];
type PluginAction = "install" | "remove" | "update" | "disable" | "enable";
type Translate = ReturnType<typeof useI18n>["t"];

const PLUGIN_SOURCE_EXAMPLES = ["npm:@scope/pi-plugin", "git:https://github.com/user/repo", "/absolute/path/to/plugin"];

function normalizePluginSourceInput(value: string): string {
  const match = value.trim().match(/^\$?\s*pi\s+install\s+(\S+)\s*$/);
  return match?.[1] ?? value;
}

function packageKey(pkg: Pick<PluginPackageInfo, "source" | "scope">): string {
  return `${pkg.scope}\0${pkg.source}`;
}

/**
 * The packages a scope's group switch would change: those not already in the
 * requested state. Standalone extensions have no switch here, so they are
 * never included. Switching a group off also leaves out a filtered package:
 * disabling empties its resource lists and nothing keeps the filters, so that
 * stays a decision for its own switch.
 */
export function packagesToSwitch<T extends Pick<PluginPackageInfo, "disabled" | "filtered">>(
  packages: T[],
  enabled: boolean,
): T[] {
  return itemsToSwitch(packages, enabled, (pkg) => !pkg.disabled, (pkg) => pkg.filtered);
}

/** Enabled filtered packages, which switching their group off leaves on. */
export function filteredPackagesKeptOn<T extends Pick<PluginPackageInfo, "disabled" | "filtered">>(
  packages: T[],
): T[] {
  return packages.filter((pkg) => !pkg.disabled && pkg.filtered);
}

function extensionKey(extension: PluginStandaloneExtensionInfo): string {
  return `extension\0${extension.path}`;
}

function scopeLabel(scope: PluginScope, t: Translate): string {
  return scope === "project" ? t("skills.scope.project") : t("skills.scope.global");
}

/** A package status as shown; English keeps the lower-case API value. */
function statusLabel(status: PluginPackageInfo["status"], t: Translate): string {
  return t(`plugins.status.${status}`);
}

/** The footer's resource totals, in the order of a package's resource summary. */
function totalsSummary(totals: PluginsResponse["totals"], t: Translate): string {
  return [
    t("i18n.resourceCount", { count: totals.extensions, label: t("i18n.extensionShort") }),
    t("i18n.resourceCount", { count: totals.skills, label: t("i18n.skillShort") }),
    t("i18n.resourceCount", { count: totals.prompts, label: t("i18n.promptShort") }),
    t("i18n.resourceCount", { count: totals.themes, label: t("i18n.themeShort") }),
  ].join(" · ");
}

function diagnosticText(diagnostic: PluginsResponse["diagnostics"][number]): string {
  return `${diagnostic.type}: ${diagnostic.source ? `${diagnostic.source}: ` : ""}${diagnostic.message}`;
}

function resourceSummary(pkg: PluginPackageInfo, t: Translate): string {
  if (pkg.disabled) return t("i18n.disabled");
  const parts = [
    pkg.counts.extensions ? t("i18n.resourceCount", { count: pkg.counts.extensions, label: t("i18n.extensionShort") }) : "",
    pkg.counts.skills ? t("i18n.resourceCount", { count: pkg.counts.skills, label: t("i18n.skillShort") }) : "",
    pkg.counts.prompts ? t("i18n.resourceCount", { count: pkg.counts.prompts, label: t("i18n.promptShort") }) : "",
    pkg.counts.themes ? t("i18n.resourceCount", { count: pkg.counts.themes, label: t("i18n.themeShort") }) : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : t("i18n.noResources");
}

function versionSummary(pkg: PluginPackageInfo, t: Translate): string {
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

  return (
    <ConfigAddSourcePanel
      title={t("i18n.addPlugin")}
      catalogHref="https://pi.dev/packages"
      catalogLabel="pi.dev/packages"
      catalogIcon={
        <svg width="28" height="28" viewBox="0 0 800 800" aria-hidden="true" focusable="false">
          <path
            fill="#000"
            fillRule="evenodd"
            d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
          />
          <path fill="#000" d="M517.36 400H634.72V634.72H517.36Z" />
        </svg>
      }
      location={installLocation(scope, cwd)}
      inputLabel={t("config.source")}
      inputId="plugin-source"
      placeholder="npm:@scope/package"
      value={source}
      canSubmit={!busy && Boolean(source.trim())}
      normalizeValue={normalizePluginSourceInput}
      onValueChange={onSourceChange}
      onSubmit={onInstall}
      examplesLabel={t("config.examples")}
      examples={PLUGIN_SOURCE_EXAMPLES}
      error={actionError}
    >
      <ConfigScopeSwitch
        value={scope}
        label={t("config.scope")}
        options={[
          { value: "global", label: scopeLabel("global", t) },
          { value: "project", label: scopeLabel("project", t), disabled: !projectResourcesLoaded },
        ]}
        disabledReason={t("trust.projectScopeUnavailable")}
        onChange={onScopeChange}
      >
        <ConfigButton
          variant="primary"
          onClick={onInstall}
          disabled={busy || !source.trim()}
          className="is-pushed-right"
        >
          {busy ? t("i18n.installing") : t("i18n.install")}
        </ConfigButton>
      </ConfigScopeSwitch>
    </ConfigAddSourcePanel>
  );
}

function PackageDetail({
  pkg,
  cwd,
  busyKey,
  actionError,
  actionMessage,
  sessionId,
  updateStatus,
  checkingUpdate,
  updateError,
  onAction,
  onCheckUpdate,
  onReloadSession,
}: {
  pkg: PluginPackageInfo;
  cwd: string;
  busyKey: string | null;
  actionError: string | null;
  actionMessage: string | null;
  sessionId: string | null;
  updateStatus?: PluginUpdateResult;
  checkingUpdate: boolean;
  updateError: string | null;
  onAction: (action: PluginAction, pkg: PluginPackageInfo) => void;
  onCheckUpdate: () => void;
  onReloadSession: () => void;
}) {
  const { t } = useI18n();
  const key = packageKey(pkg);
  const busy = (busyKey?.endsWith(key) || busyKey?.startsWith("bulk:")) ?? false;
  const reloadBusy = busyKey === "reload";
  const enabled = !pkg.disabled;
  const canCheckForUpdates = pkg.canCheckForUpdates;
  const updateAvailable = updateStatus?.state === "update-available";
  const description = pkg.description?.trim();
  const reloadReasonId = useId();

  return (
    <ConfigDetailStack>
      <div className="config-detail-heading">
        <ConfigDetailHeader className="is-top-aligned">
          <ConfigDetailHeaderInfo>
            <ConfigScopeTag scope={pkg.scope}>{scopeLabel(pkg.scope, t)}</ConfigScopeTag>
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
          </ConfigDetailHeaderInfo>

          <ConfigDetailActions>
            <ConfigButton
              size="small"
              variant={updateAvailable ? "primary" : undefined}
              onClick={updateAvailable || !canCheckForUpdates
                ? () => onAction("update", pkg)
                : onCheckUpdate}
              disabled={busy || reloadBusy || checkingUpdate}
              title={updateAvailable ? t("i18n.updateAvailable") : undefined}
            >
               {busyKey === `update:${key}`
                 ? t("i18n.updating")
                 : checkingUpdate
                   ? t("i18n.checking")
                   : updateAvailable || !canCheckForUpdates
                     ? t("i18n.update")
                     : t("i18n.check")}
            </ConfigButton>
            <ConfigButton
              size="small"
              onClick={onReloadSession}
              disabled={!sessionId || reloadBusy || busy}
              aria-describedby={sessionId ? undefined : reloadReasonId}
            >
               {reloadBusy ? t("i18n.reloading") : t("i18n.reloadSession")}
            </ConfigButton>
            <ConfigButton
              variant="danger"
              size="small"
              onClick={() => onAction("remove", pkg)}
              disabled={busy || reloadBusy}
            >
               {busyKey === `remove:${key}` ? t("i18n.removing") : t("i18n.remove")}
            </ConfigButton>
            <ConfigSwitch
              checked={enabled}
              loading={busy || reloadBusy}
              onChange={() => onAction(pkg.disabled ? "enable" : "disable", pkg)}
              label={pkg.disabled ? t("i18n.enablePackage") : t("i18n.disablePackage")}
            />
          </ConfigDetailActions>
        </ConfigDetailHeader>
        {!sessionId && (
          <div id={reloadReasonId} className="config-detail-heading-note">
            {t("i18n.openSessionToReload")}
          </div>
        )}
      </div>

      <ConfigDetailGrid>
        {description && (
          <ConfigDetailGridRow label={t("i18n.description")}>
            {description}
          </ConfigDetailGridRow>
        )}
        <ConfigDetailGridRow
          label={t("i18n.status")}
          tone="plain"
          style={{ color: statusColor(pkg.status), textTransform: "capitalize" }}
        >
          {statusLabel(pkg.status, t)}
        </ConfigDetailGridRow>
        <ConfigDetailGridRow
          label={t("i18n.version")}
          tone="plain"
          style={{ display: "flex", flexDirection: "column", gap: 4 }}
        >
          <div className="skill-version-row">
            <span className="skill-version-value">{versionSummary(pkg, t)}</span>
            {updateAvailable && (
              <span className="skill-version-value is-update" title={updateStatus.displayName}>
                {t("i18n.updateAvailable")}
              </span>
            )}
            {canCheckForUpdates && (checkingUpdate || (updateStatus && !updateAvailable)) && (
              <span
                className={`skill-update-status ${checkingUpdate
                  ? "is-checking"
                  : updateStatus?.state === "up-to-date"
                    ? "is-success"
                    : updateStatus?.state === "error"
                      ? "is-error"
                      : "is-muted"}`}
              >
                {checkingUpdate
                  ? t("i18n.checking")
                  : updateStatus?.state === "up-to-date"
                    ? t("i18n.upToDate")
                    : updateStatus?.state === "unsupported"
                      ? t("i18n.automaticChecksUnavailable")
                      : updateStatus?.message || t("i18n.checkFailed")}
              </span>
            )}
          </div>
          {updateError && (
            <span style={{ fontSize: 12, color: "#ef4444" }}>{updateError}</span>
          )}
        </ConfigDetailGridRow>
        <ConfigDetailGridRow label={t("i18n.package")} mono>
          {pkg.packageName ?? t("i18n.unknown")}
        </ConfigDetailGridRow>
        <ConfigDetailGridRow label={t("i18n.resources")}>
          {resourceSummary(pkg, t)}
        </ConfigDetailGridRow>
        <ConfigDetailGridRow label={t("i18n.installedPath")} tone={pkg.installedPath ? "muted" : "error"} mono>
          {pkg.installedPath ? shortenPath(pkg.installedPath) : t("i18n.notFound")}
        </ConfigDetailGridRow>
        <ConfigDetailGridRow label={t("i18n.cwd")} tone="dim" mono>
          {shortenPath(cwd)}
        </ConfigDetailGridRow>
      </ConfigDetailGrid>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <ConfigSectionTitle>{t("i18n.resolvedResources")}</ConfigSectionTitle>
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
    </ConfigDetailStack>
  );
}

function StandaloneExtensionDetail({ extension }: { extension: PluginStandaloneExtensionInfo }) {
  const { t } = useI18n();
  const status = extension.enabled ? "loaded" : "disabled";

  return (
    <ConfigDetailStack>
      <ConfigDetailHeader>
        <ConfigDetailHeaderInfo>
          <ConfigScopeTag scope={extension.scope}>{scopeLabel(extension.scope, t)}</ConfigScopeTag>
          <ConfigDetailTitle>{extension.name}</ConfigDetailTitle>
        </ConfigDetailHeaderInfo>
      </ConfigDetailHeader>
      <ConfigDetailGrid>
        <ConfigDetailGridRow
          label={t("i18n.status")}
          tone="plain"
          style={{ color: extension.enabled ? "var(--accent)" : "var(--text-dim)" }}
        >
          {statusLabel(status, t)}
        </ConfigDetailGridRow>
        <ConfigDetailGridRow label={t("i18n.installedPath")} mono>
          {shortenPath(extension.path)}
        </ConfigDetailGridRow>
      </ConfigDetailGrid>
    </ConfigDetailStack>
  );
}

export function PluginsConfig({
  cwd,
  sessionId,
  onClose,
  onReloaded,
  embedded = false,
  trust,
}: {
  cwd: string;
  sessionId: string | null;
  onClose: () => void;
  onReloaded?: () => void;
  embedded?: boolean;
  /** The page's trust status for `cwd`; a new decision loads the list again. */
  trust?: ProjectTrustStatus | null;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<PluginsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(() => getLastSettingsSelection("plugins", cwd));
  const [addMode, setAddMode] = useState(false);
  const [installSource, setInstallSource] = useState("");
  const [installScope, setInstallScope] = useState<PluginScope>("global");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  // What the last group switch left undone, shown under that scope's heading.
  const [groupStatus, setGroupStatus] = useState<{ scope: PluginScope; error?: string; note?: string } | null>(null);
  const [updateStatuses, setUpdateStatuses] = useState<Record<string, PluginUpdateResult>>({});
  const [checkingUpdates, setCheckingUpdates] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);

  const packages = useMemo(() => data?.packages ?? [], [data?.packages]);
  const standaloneExtensions = useMemo(() => data?.standaloneExtensions ?? [], [data?.standaloneExtensions]);
  const selectedPackage = packages.find((pkg) => packageKey(pkg) === selected) ?? null;
  const selectedExtension = standaloneExtensions.find((extension) => extensionKey(extension) === selected) ?? null;
  const projectResourcesLoaded = data?.projectResourcesLoaded ?? true;

  const groupedPackages = useMemo(() => {
    return (["project", "global"] as PluginScope[])
      .map((scope) => ({ scope, packages: packages.filter((pkg) => pkg.scope === scope) }))
      .filter((group) => group.packages.length > 0);
  }, [packages]);

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    setError(null);
    setGroupStatus(null);
    try {
      const res = await fetch(`/api/plugins?cwd=${encodeURIComponent(cwd)}`);
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      setAddMode((current) => (next.packages.length === 0 && next.standaloneExtensions.length === 0) || current);
      setSelected((current) => {
        if (current && (
          next.packages.some((pkg) => packageKey(pkg) === current)
          || next.standaloneExtensions.some((extension) => extensionKey(extension) === current)
        )) return current;
        return next.packages[0]
          ? packageKey(next.packages[0])
          : next.standaloneExtensions[0]
            ? extensionKey(next.standaloneExtensions[0])
            : null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setUpdateStatuses({});
    setUpdateError(null);
    void loadPlugins();
  }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  // Whether project packages load, and the Project scope can be chosen, follows
  // the folder's trust, which can change while this section stays mounted
  // (hidden) in Settings: trusting from Settings › MCP. A new decision loads the
  // list again in place, keeping the selection and any update checks; the first
  // load is the effect above.
  const trustKey = projectTrustReloadKey(trust);
  const loadedTrustKeyRef = useRef(trustKey);
  useEffect(() => {
    if (loadedTrustKeyRef.current === trustKey) return;
    loadedTrustKeyRef.current = trustKey;
    void loadPlugins();
  }, [trustKey, loadPlugins]);

  useEffect(() => {
    if (selected) setLastSettingsSelection("plugins", selected, cwd);
  }, [cwd, selected]);

  const checkForUpdates = useCallback(async (pkg?: PluginPackageInfo) => {
    const targets = pkg ? [pkg] : packages.filter((item) => item.canCheckForUpdates);
    const keys = targets.map(packageKey);
    if (keys.length === 0) return;

    setUpdateError(null);
    setCheckingUpdates((current) => new Set([...current, ...keys]));
    if (!pkg) setCheckingAll(true);
    try {
      const res = await fetch("/api/plugins/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          source: pkg?.source,
          scope: pkg?.scope,
        }),
      });
      const data = (await res.json()) as {
        updates?: PluginUpdateResult[];
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setUpdateStatuses((current) => {
        const next = { ...current };
        for (const update of data.updates ?? []) {
          next[packageKey(update)] = update;
        }
        return next;
      });
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingUpdates((current) => {
        const next = new Set(current);
        for (const key of keys) next.delete(key);
        return next;
      });
      if (!pkg) setCheckingAll(false);
    }
  }, [cwd, packages]);

  const updateAllPluginsAction = useCallback(async () => {
    setUpdatingAll(true);
    setActionError(null);
    setActionMessage(null);
    setUpdateError(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", cwd }),
      });
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      setUpdateStatuses({});
      setActionMessage(t("i18n.packagesUpdated"));
      if (sessionId) {
        setActionMessage(`${t("i18n.packagesUpdated")} ${t("agents.reloadRequired")}`);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdatingAll(false);
    }
  }, [cwd, sessionId, t]);

  const runAction = useCallback(async (action: PluginAction, pkg: PluginPackageInfo) => {
    const key = packageKey(pkg);
    setBusyKey(`${action}:${key}`);
    setActionError(null);
    setActionMessage(null);
    setGroupStatus(null);
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
        setSelected(next.packages[0]
          ? packageKey(next.packages[0])
          : next.standaloneExtensions[0]
            ? extensionKey(next.standaloneExtensions[0])
            : null);
        if (next.packages.length === 0 && next.standaloneExtensions.length === 0) setAddMode(true);
        setActionMessage(t("i18n.packageRemoved"));
        setUpdateStatuses((current) => {
          const nextStatuses = { ...current };
          delete nextStatuses[key];
          return nextStatuses;
        });
      } else {
        const messages: Record<Exclude<PluginAction, "remove">, string> = {
          install: t("i18n.packageInstalled"),
          update: t("i18n.packageUpdated"),
          disable: t("i18n.packageDisabled"),
          enable: t("i18n.packageEnabled"),
        };
        setActionMessage(messages[action]);
        if (action === "update") {
          setUpdateStatuses((current) => {
            const nextStatuses = { ...current };
            delete nextStatuses[key];
            return nextStatuses;
          });
        }
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [cwd, t]);

  // Behaves like the package switch, for every package of one scope: the
  // confirmation appears in the package detail and the session is reloaded by
  // hand. Packages the route refuses keep their state and are named under the
  // scope's heading, and so are the filtered packages switching off leaves on.
  const setGroupPackages = useCallback(async (
    scope: PluginScope,
    groupPackages: PluginPackageInfo[],
    enabled: boolean,
  ) => {
    const targets = packagesToSwitch(groupPackages, enabled);
    const keptOn = enabled ? 0 : filteredPackagesKeptOn(groupPackages).length;
    const note = keptOn > 0 ? t("plugins.bulkKeptFiltered", { count: keptOn }) : undefined;
    setActionError(null);
    setActionMessage(null);
    setGroupStatus(note ? { scope, note } : null);
    if (targets.length === 0) return;
    const action = enabled ? "enable" : "disable";
    setBusyKey(`bulk:${scope}`);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          cwd,
          packages: targets.map(({ source }) => ({ source, scope })),
        }),
      });
      const next = (await res.json()) as Partial<PluginsBulkResponse> & { error?: string };
      if (!res.ok || next.error || !next.results) throw new Error(next.error ?? `HTTP ${res.status}`);
      const { results, ...plugins } = next as PluginsBulkResponse;
      setData(plugins);
      const failures = results.filter((result) => result.error);
      if (failures.length < results.length) {
        const message = enabled ? t("plugins.bulkEnabled") : t("plugins.bulkDisabled");
        setActionMessage(sessionId ? `${message} ${t("agents.reloadRequired")}` : message);
      }
      if (failures.length > 0) {
        setGroupStatus({
          scope,
          note,
          error: [
            t("plugins.bulkFailed", { count: failures.length, total: results.length }),
            ...failures.map((failure) => `${failure.source}: ${failure.error}`),
          ].join("\n"),
        });
      }
    } catch (err) {
      setGroupStatus({ scope, note, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusyKey(null);
    }
  }, [cwd, sessionId, t]);

  const installPlugin = useCallback(async () => {
    const source = normalizePluginSourceInput(installSource).trim();
    if (!source) return;
    setInstallSource(source);
    const key = `${installScope}\0${source}`;
    setBusyKey(`install:${key}`);
    setActionError(null);
    setActionMessage(null);
    setGroupStatus(null);
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
      setActionMessage(t("i18n.packageInstalled"));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [cwd, installScope, installSource, t]);

  const reloadSession = useCallback(async () => {
    if (!sessionId) return;
    setBusyKey("reload");
    setActionError(null);
    setActionMessage(null);
    setGroupStatus(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      onReloaded?.();
      await loadPlugins();
      setActionMessage(t("i18n.sessionReloaded"));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [loadPlugins, onReloaded, sessionId, t]);

  const addBusy = busyKey?.startsWith("install:") ?? false;
  const availableUpdateCount = Object.values(updateStatuses).filter(
    (status) => status.state === "update-available",
  ).length;
  const hasCheckablePackages = packages.some((pkg) => pkg.canCheckForUpdates);
  const footerBusy = loading || busyKey !== null || checkingUpdates.size > 0 || updatingAll;

  return (
    <ConfigPanelShell embedded={embedded} title={t("common.plugins")} subtitle={shortenPath(cwd)} closeLabel={t("i18n.close")} onClose={onClose}>

        {!projectResourcesLoaded && <ConfigTrustNotice message={t("trust.pluginsNotLoaded")} />}

        <ConfigSplitView>
          <ConfigSidebar>
            <ConfigSidebarList>
              {loading ? (
                <div className="config-sidebar-message">
                  {t("i18n.loading")}
                </div>
              ) : error ? (
                <div className="config-sidebar-message is-error">
                  {error}
                </div>
              ) : packages.length === 0 && standaloneExtensions.length === 0 ? (
                <div className="config-sidebar-message is-empty">
                  {t("i18n.noPlugins")}
                </div>
              ) : (
                <>
                  {standaloneExtensions.length > 0 && (
                    <div className="config-sidebar-group">
                      <ConfigSidebarGroupLabel>{t("i18n.extensions")}</ConfigSidebarGroupLabel>
                      {standaloneExtensions.map((extension) => {
                        const key = extensionKey(extension);
                        return (
                          <ConfigSidebarItem
                            key={key}
                            active={!addMode && selected === key}
                            title={extension.path}
                            onClick={() => {
                              setSelected(key);
                              setAddMode(false);
                              setActionError(null);
                              setActionMessage(null);
                            }}
                          >
                            <ConfigStatusDot active={extension.enabled} />
                            <ConfigSidebarText className={`is-grow${extension.enabled ? "" : " is-muted"}`}>
                              {extension.name}
                            </ConfigSidebarText>
                          </ConfigSidebarItem>
                        );
                      })}
                    </div>
                  )}
                  {groupedPackages.map((group) => {
                    const enabledCount = group.packages.filter((pkg) => !pkg.disabled).length;
                    const allEnabled = enabledCount === group.packages.length;
                    return (
                      <div key={group.scope} className="config-sidebar-group">
                        <ConfigSidebarGroupLabel
                          aside={
                            <ConfigSidebarGroupSwitch
                              enabled={enabledCount}
                              total={group.packages.length}
                              disabled={footerBusy}
                              loading={busyKey === `bulk:${group.scope}`}
                              label={t(allEnabled ? "plugins.groupSwitchOn" : "plugins.groupSwitchOff", { group: scopeLabel(group.scope, t) })}
                              onChange={(enabled) => void setGroupPackages(group.scope, group.packages, enabled)}
                            />
                          }
                        >
                          {scopeLabel(group.scope, t)}
                        </ConfigSidebarGroupLabel>
                        {groupStatus?.scope === group.scope && (
                          <ConfigSidebarGroupStatus error={groupStatus.error} note={groupStatus.note} />
                        )}
                        {group.packages.map((pkg) => {
                          const key = packageKey(pkg);
                          const isSelected = !addMode && selected === key;
                          return (
                            <ConfigSidebarItem
                              key={key}
                              active={isSelected}
                              title={pkg.description ?? pkg.source}
                              onClick={() => {
                                setSelected(key);
                                setAddMode(false);
                                setActionError(null);
                                setActionMessage(null);
                              }}
                            >
                              <ConfigStatusDot active={!pkg.disabled} color={statusColor(pkg.status)} />
                              <ConfigSidebarText className={`is-grow${pkg.disabled ? " is-muted" : ""}`}>
                                {pkg.source}
                              </ConfigSidebarText>
                              {updateStatuses[packageKey(pkg)]?.state === "update-available" && (
                                <span title={t("i18n.updateAvailable")} className="skill-update-indicator">
                                  ↑
                                </span>
                              )}
                            </ConfigSidebarItem>
                          );
                        })}
                      </div>
                    );
                  })}
                </>
              )}
            </ConfigSidebarList>
            <ConfigListAction
                active={addMode}
                onClick={() => {
                  setAddMode(true);
                  setActionError(null);
                  setActionMessage(null);
                }}
              >
                 {t("i18n.addPlugin")}
            </ConfigListAction>
          </ConfigSidebar>

          <ConfigDetail>
            <ConfigDetailStack className="is-fill">
              {addMode ? (
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
            ) : loading ? null : selectedExtension ? (
              <StandaloneExtensionDetail extension={selectedExtension} />
            ) : selectedPackage ? (
              <PackageDetail
                key={packageKey(selectedPackage)}
                pkg={selectedPackage}
                cwd={cwd}
                busyKey={busyKey}
                actionError={actionError}
                actionMessage={actionMessage}
                sessionId={sessionId}
                updateStatus={updateStatuses[packageKey(selectedPackage)]}
                checkingUpdate={checkingUpdates.has(packageKey(selectedPackage))}
                updateError={updateError}
                onAction={runAction}
                onCheckUpdate={() => void checkForUpdates(selectedPackage)}
                onReloadSession={reloadSession}
              />
              ) : (
                <ConfigEmptyState>{t("i18n.selectPackage")}</ConfigEmptyState>
              )}
            </ConfigDetailStack>
          </ConfigDetail>
        </ConfigSplitView>

        <ConfigFooter status={
            availableUpdateCount > 0 ? (
              <span style={{ fontSize: 12, color: "var(--accent)" }}>
                {availableUpdateCount}{" "}
                {availableUpdateCount === 1 ? t("i18n.update") : t("i18n.updates")}
              </span>
            ) : data?.diagnostics.length ? (
              <ConfigFooterStatus
                tone={data.diagnostics.some((d) => d.type === "error") ? "error" : "warning"}
                summary={data.diagnostics.length === 1
                  ? t("plugins.diagnostic")
                  : t("plugins.diagnostics", { count: data.diagnostics.length })}
                details={data.diagnostics.map(diagnosticText)}
              />
            ) : (
              <ConfigFooterStatus summary={data ? totalsSummary(data.totals, t) : ""} />
            )}
        >
          {!embedded && <ConfigButton onClick={onClose}>{t("i18n.close")}</ConfigButton>}
          {hasCheckablePackages && (
            <ConfigButton
              variant={availableUpdateCount > 0 ? "primary" : "secondary"}
              onClick={() => void (availableUpdateCount > 0 ? updateAllPluginsAction() : checkForUpdates())}
              disabled={footerBusy}
              title={availableUpdateCount > 0 ? t("i18n.updateAllPluginsHint") : undefined}
            >
              {updatingAll
                ? t("i18n.updating")
                : checkingAll
                  ? t("i18n.checking")
                  : availableUpdateCount > 0
                    ? `${t("i18n.updateAllPlugins")} (${availableUpdateCount})`
                    : t("i18n.checkUpdates")}
            </ConfigButton>
          )}
          <ConfigButton variant="secondary" onClick={() => void loadPlugins()} disabled={footerBusy}>
             {t("i18n.refresh")}
          </ConfigButton>
        </ConfigFooter>
    </ConfigPanelShell>
  );
}
