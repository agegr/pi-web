"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useAgentsRefresh } from "@/hooks/useAgentsRefresh";
import type { ProjectTrustStatus, SubagentCatalogResponse, SubagentProfilesResponse, SubagentToolsResponse } from "@/lib/api-types";
import { displayPathWithin, shortenPath } from "@/lib/display-path";
import type { ModelsData } from "@/lib/models-cache";
import { isSubagentProfileOverridden } from "@/lib/subagent-profile-precedence";
import type { AgentCatalogAgent, AgentCatalogSource } from "@/lib/pi-subagents-catalog";
import type { SubagentExtensions, SubagentProfile, SubagentScope, SubagentWritableScope } from "@/lib/subagents";
import {
  getLastSettingsSelection,
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
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
  ConfigSaveTarget,
  ConfigScopeTag,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSplitView,
  ConfigStatusDot,
  ConfigSwitch,
} from "./SettingsUi";
import { ModelSelector } from "./ModelSelector";
import { projectTrustReloadKey } from "./settings-ui-helpers";

const THINKING_OPTIONS = ["", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const CONTEXT_OPTIONS = ["", "fresh", "fork"] as const;
const ACCEPTANCE_ROLE_OPTIONS = ["", "read-only", "writer"] as const;

type EditableProfile = Omit<SubagentProfile, "scope" | "filePath">;
type EditorMode = "view" | "edit" | "create";
type ToolOption = SubagentToolsResponse["tools"][number];

const EMPTY_PROFILE: EditableProfile = {
  name: "custom-agent",
  displayName: "Custom agent",
  description: "",
  systemPrompt: "",
  tools: [],
  toolsInherited: true,
  extensions: { kind: "omit" },
};

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

const disabledInputStyle: CSSProperties = {
  background: "var(--bg-panel)",
  color: "var(--text-dim)",
  cursor: "default",
};

function cloneExtensions(extensions: SubagentExtensions | undefined): SubagentExtensions {
  if (!extensions) return { kind: "omit" };
  return extensions.list ? { kind: extensions.kind, list: [...extensions.list] } : { kind: extensions.kind };
}

function editableProfile(profile: SubagentProfile): EditableProfile {
  const rest: SubagentProfile = { ...profile };
  delete (rest as { scope?: SubagentScope }).scope;
  delete (rest as { filePath?: string }).filePath;
  return {
    ...rest,
    tools: rest.tools ? [...rest.tools] : [],
    toolsInherited: rest.toolsInherited ?? rest.tools === undefined,
    ...(rest.excludeTools ? { excludeTools: [...rest.excludeTools] } : {}),
    extensions: cloneExtensions(rest.extensions),
  };
}

function profileKey(profile: Pick<SubagentProfile, "scope" | "name">): string {
  return `${profile.scope}:${profile.name}`;
}

function catalogKey(agent: Pick<AgentCatalogAgent, "source" | "name" | "filePath">): string {
  return `catalog:${agent.source}:${agent.filePath}:${agent.name}`;
}

/**
 * Agent definitions the profile editor cannot edit: the pi-subagents built-ins,
 * package-provided agents, and `~/.agents` files. They are still shown, because
 * the runtime's agent list is what the user is looking for.
 */
function catalogOnlyAgents(
  catalog: readonly AgentCatalogAgent[],
  profiles: readonly SubagentProfile[],
): AgentCatalogAgent[] {
  const editablePaths = new Set(profiles.map((profile) => profile.filePath).filter(Boolean));
  return catalog.filter((agent) => !editablePaths.has(agent.filePath));
}

function duplicateProfileName(name: string, profiles: readonly SubagentProfile[]): string {
  const existing = new Set(profiles.map((profile) => profile.name.toLowerCase()));
  const base = `${name}-copy`;
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate.toLowerCase())) candidate = `${base}-${suffix++}`;
  return candidate;
}

function isWritableScope(scope: SubagentScope): scope is SubagentWritableScope {
  return scope === "global" || scope === "project";
}

/** pi-subagents' `handleEject` only duplicates bundled builtin and package agents. */
function isEjectableSource(source: AgentCatalogSource): boolean {
  return source === "builtin" || source === "package";
}

function displayProfilePath(profile: SubagentProfile, cwd: string): string | null {
  if (!profile.filePath) return null;
  return profile.scope === "project" || profile.scope === "workspace"
    ? displayPathWithin(profile.filePath, cwd)
    : shortenPath(profile.filePath);
}

function sourceLabelKey(source: AgentCatalogSource): string {
  return `agents.catalog.source.${source}`;
}

/** The catalog is optional enrichment: any failure or empty body yields no rows. */
async function readCatalog(response: Response | null): Promise<AgentCatalogAgent[]> {
  if (!response?.ok) return [];
  try {
    const data = await response.json() as Partial<SubagentCatalogResponse> & { error?: string };
    return data.error ? [] : data.agents ?? [];
  } catch {
    return [];
  }
}

/** The tools list is optional enrichment: any failure leaves the raw-entry UI only. */
async function readTools(response: Response | null): Promise<ToolOption[]> {
  if (!response?.ok) return [];
  try {
    const data = await response.json() as Partial<SubagentToolsResponse> & { error?: string };
    return data.error ? [] : data.tools ?? [];
  } catch {
    return [];
  }
}

function CatalogDetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Field label={label}>
      <div className="agents-catalog-value">{value}</div>
    </Field>
  );
}

function CatalogAgentDetail({
  agent,
  saving,
  onToggleDisabled,
  onEject,
}: {
  agent: AgentCatalogAgent;
  saving: boolean;
  onToggleDisabled: (agent: AgentCatalogAgent, disabled: boolean) => void;
  onEject: (agent: AgentCatalogAgent, scope: SubagentWritableScope, name: string) => void;
}) {
  const { t } = useI18n();
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateScope, setDuplicateScope] = useState<SubagentWritableScope>("global");
  const [duplicateName, setDuplicateName] = useState(agent.name);
  // A disable the user-scope toggle cannot undo is locked with the reason as
  // its hint: a bulk `disableBuiltins` wins at either scope, and a project
  // override outranks the user override the switch would remove. A user-scope
  // override stays switchable because toggling it off removes that override.
  const disableHint = agent.disabled === true && agent.disabledSource
    ? agent.disabledSource.via === "bulk"
      ? { key: "agents.catalog.disableHint.bulk", scope: agent.disabledSource.scope }
      : agent.disabledSource.scope === "project"
        ? { key: "agents.catalog.disableHint.projectOverride", scope: agent.disabledSource.scope }
        : null
    : null;
  const disableSwitchLocked = disableHint !== null;
  const details: Array<[string, ReactNode]> = [
    [t("agents.catalog.aliases"), agent.aliases?.join(", ") ?? t("agents.catalog.none")],
    [t("agents.catalog.model"), agent.model ?? t("agents.inherit")],
    [t("agents.catalog.thinking"), agent.thinking ?? t("agents.inherit")],
    [t("agents.catalog.tools"), agent.tools?.length ? agent.tools.join(", ") : t("agents.catalog.toolsInherited")],
  ];
  if (agent.excludeTools?.length) details.push([t("agents.catalog.excludeTools"), agent.excludeTools.join(", ")]);

  return (
    <ConfigDetailStack>
      <ConfigDetailHeader>
        <ConfigDetailHeaderInfo>
          <span className="config-scope-tag">{t(sourceLabelKey(agent.source))}</span>
          <span title={agent.filePath} className="config-detail-path">{shortenPath(agent.filePath)}</span>
        </ConfigDetailHeaderInfo>
        <ConfigDetailActions>
          {agent.disabled && <span className="agents-catalog-badge">{t("agents.catalog.disabled")}</span>}
          {agent.overriddenBy && (
            <span className="agents-overridden-label">
              {t("agents.catalog.overriddenBy", { source: t(sourceLabelKey(agent.overriddenBy)) })}
            </span>
          )}
          {agent.advertise && <span className="agents-catalog-badge">{t("agents.catalog.advertised")}</span>}
          {agent.executable === false && <span className="agents-catalog-badge is-warning">{t("agents.catalog.unavailable")}</span>}
          {isEjectableSource(agent.source) && (
            <ConfigButton size="small" onClick={() => setDuplicating((current) => !current)} disabled={saving}>{t("agents.duplicate")}</ConfigButton>
          )}
        </ConfigDetailActions>
      </ConfigDetailHeader>
      <CatalogDetailField label={t("agents.description")} value={agent.description} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
        {details.map(([label, value]) => <CatalogDetailField key={label} label={label} value={value} />)}
      </div>
      {agent.prompt && (
        <Section title={t("agents.section.prompt")} defaultOpen>
          <Field label={t("agents.prompt")}>
            <textarea
              className="agents-system-prompt"
              aria-label={t("agents.prompt")}
              value={agent.prompt}
              readOnly
              disabled
              style={{ ...inputStyle, ...disabledInputStyle, height: 195, minHeight: 195, maxHeight: "60vh", padding: 9, overflow: "auto", resize: "none", lineHeight: 1.5 }}
            />
          </Field>
        </Section>
      )}
      <Field label={t("agents.catalog.disabledToggle")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ConfigSwitch
              checked={agent.disabled === true}
              disabled={saving || disableSwitchLocked}
              label={t("agents.catalog.disabledToggle")}
              onChange={(checked) => onToggleDisabled(agent, checked)}
            />
            <span className="agents-catalog-note">{t("agents.catalog.disabledToggleHelp")}</span>
          </div>
          {disableHint && (
            <span className="agents-catalog-note">
              {t(disableHint.key, { scope: t(`agents.scope.${disableHint.scope}`) })}
            </span>
          )}
        </div>
      </Field>
      {duplicating && (
        <Field label={t("agents.catalog.duplicateScope")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, padding: 3, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-panel)" }}>
              {(["global", "project"] as const).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => setDuplicateScope(scope)}
                  disabled={saving}
                  style={{ height: 28, border: "none", borderRadius: 4, background: duplicateScope === scope ? "var(--bg-selected)" : "transparent", color: duplicateScope === scope ? "var(--text)" : "var(--text-muted)", cursor: saving ? "default" : "pointer", fontSize: 11, fontWeight: duplicateScope === scope ? 600 : 400 }}
                >
                  {t(`agents.scope.${scope}`)}
                </button>
              ))}
            </div>
            <input aria-label={t("agents.name")} value={duplicateName} disabled={saving} onChange={(event) => setDuplicateName(event.target.value)} style={inputStyle} />
            <span className="agents-catalog-note">{t("agents.catalog.duplicateShadowHint")}</span>
            <div style={{ display: "flex", gap: 6 }}>
              <ConfigButton variant="primary" size="small" disabled={saving || !duplicateName.trim()} onClick={() => onEject(agent, duplicateScope, duplicateName.trim())}>
                {t("agents.catalog.duplicateAction")}
              </ConfigButton>
              <ConfigButton size="small" disabled={saving} onClick={() => setDuplicating(false)}>
                {t("i18n.cancel")}
              </ConfigButton>
            </div>
          </div>
        </Field>
      )}
      <p className="agents-catalog-note">{t("agents.catalog.readOnly")}</p>
    </ConfigDetailStack>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <ConfigField label={label}>{children}</ConfigField>;
}

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 7, color: disabled ? "var(--text-dim)" : "var(--text-muted)", fontSize: 12, cursor: disabled ? "default" : "pointer" }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

/** A collapsed advanced section, opened on demand so the common fields stay short. */
function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)" }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 12px", border: "none", background: "transparent", color: "var(--text)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
      >
        <span>{title}</span>
        <span aria-hidden="true" style={{ color: "var(--text-dim)" }}>{open ? "\u2212" : "+"}</span>
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 12px 12px" }}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A comma-separated list input. The committed array changes on every keystroke,
 * but the visible text stays local so a trailing comma is not eaten mid-typing;
 * remount it with `key` when the edited profile changes.
 */
function ListInput({ initial, disabled, ariaLabel, placeholder, onChange }: {
  initial: readonly string[];
  disabled: boolean;
  ariaLabel: string;
  placeholder?: string;
  onChange: (values: string[]) => void;
}) {
  const [text, setText] = useState(() => initial.join(", "));
  const style = disabled ? { ...inputStyle, ...disabledInputStyle } : inputStyle;
  return (
    <input
      aria-label={ariaLabel}
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => {
        setText(event.target.value);
        onChange(event.target.value.split(",").map((item) => item.trim()).filter(Boolean));
      }}
      style={style}
    />
  );
}

/** Frontmatter entries that are not selectable from the tool list (mcp:, paths, unknown names). */
function RawEntries({ values, disabled, removeLabel, onRemove }: {
  values: readonly string[];
  disabled: boolean;
  removeLabel: string;
  onRemove: (value: string) => void;
}) {
  if (values.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {values.map((value) => (
        <span key={value} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 7px", border: "1px solid var(--border)", borderRadius: 999, background: "var(--bg)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
          {value}
          <button
            type="button"
            aria-label={`${removeLabel}: ${value}`}
            title={removeLabel}
            disabled={disabled}
            onClick={() => onRemove(value)}
            style={{ border: "none", background: "transparent", color: "inherit", cursor: disabled ? "default" : "pointer", fontSize: 12, lineHeight: 1 }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

export function AgentsConfig({
  cwd,
  onClose,
  embedded = false,
  active = true,
  trust,
}: {
  cwd: string;
  onClose: () => void;
  embedded?: boolean;
  /** The settings section host keeps this panel mounted while another section is shown. */
  active?: boolean;
  /** The page's trust status for `cwd`; a new decision loads the model list again. */
  trust?: ProjectTrustStatus | null;
}) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<SubagentProfile[]>([]);
  const [catalog, setCatalog] = useState<AgentCatalogAgent[]>([]);
  const [toolOptions, setToolOptions] = useState<ToolOption[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelsData["modelList"]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => getLastSettingsSelection("agents", cwd));
  const [selectedCatalogKey, setSelectedCatalogKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableProfile>(EMPTY_PROFILE);
  const [mode, setMode] = useState<EditorMode>("view");
  const [targetScope, setTargetScope] = useState<SubagentWritableScope>("global");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawEntry, setRawEntry] = useState("");
  const [rawExcludeEntry, setRawExcludeEntry] = useState("");
  const [rawEntryError, setRawEntryError] = useState<string | null>(null);
  const [rawExcludeEntryError, setRawExcludeEntryError] = useState<string | null>(null);

  const selected = useMemo(
    () => profiles.find((profile) => profileKey(profile) === selectedKey) ?? null,
    [profiles, selectedKey],
  );
  /**
   * The draft exactly as it was loaded. An open draft is unsaved work, so a
   * background refresh must not overwrite it, and while it differs from its file
   * the panel is not a safe place to apply new lists to either. Compare against
   * this baseline rather than the reloaded profile: a file changing on disk is
   * exactly the case where the user's unsaved edits must still survive, and
   * comparing to the new content would latch the panel "dirty" forever.
   */
  const pristineDraftRef = useRef<EditableProfile | null>(null);
  const applyDraft = (next: EditableProfile) => {
    pristineDraftRef.current = next;
    setDraft(next);
  };
  const draftDirty = mode === "create"
    || (mode === "edit" && JSON.stringify(draft) !== JSON.stringify(pristineDraftRef.current));
  const uneditable = useMemo(() => catalogOnlyAgents(catalog, profiles), [catalog, profiles]);
  const selectedCatalog = useMemo(
    () => uneditable.find((agent) => catalogKey(agent) === selectedCatalogKey) ?? null,
    [uneditable, selectedCatalogKey],
  );
  const modelSelectorOptions = useMemo(() => modelOptions.map((model) => ({
    provider: model.provider,
    modelId: model.id,
    name: model.name,
  })), [modelOptions]);

  const knownToolNames = useMemo(() => new Set(toolOptions.map((tool) => tool.name)), [toolOptions]);
  const rawTools = useMemo(() => draft.tools?.filter((tool) => !knownToolNames.has(tool)) ?? [], [draft.tools, knownToolNames]);
  const rawExcludeTools = useMemo(() => draft.excludeTools?.filter((tool) => !knownToolNames.has(tool)) ?? [], [draft.excludeTools, knownToolNames]);

  // The refresh hook and the quiet load read these through a ref, so the load
  // callback stays stable and the mount effect cannot refetch on every keystroke.
  const selectionRef = useRef({ selectedKey, mode, draftDirty });
  selectionRef.current = { selectedKey, mode, draftDirty };

  /**
   * Load the profiles, catalog and tool list. A quiet load is a background
   * refresh: it keeps the list state fresh without moving the selection, and it
   * only re-reads the open draft in view mode, where there is nothing to lose.
   */
  const loadProfiles = useCallback(async (
    preferredKey?: string,
    options?: { signal?: AbortSignal; quiet?: boolean },
  ) => {
    const quiet = options?.quiet === true;
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const [profilesResponse, catalogResponse, toolsResponse] = await Promise.all([
        fetch(`/api/subagents/profiles?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store", signal: options?.signal }),
        // The catalog and tool list are read-only enrichment; a failure leaves the editor alone.
        fetch(`/api/subagents/catalog?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" }).catch(() => null),
        fetch(`/api/subagents/tools?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" }).catch(() => null),
      ]);
      const data = await profilesResponse.json() as Partial<SubagentProfilesResponse> & { error?: string };
      if (!profilesResponse.ok || data.error) throw new Error(data.error ?? `HTTP ${profilesResponse.status}`);
      const next = data.profiles ?? [];
      setProfiles(next);
      // A background refresh that succeeds is the recovery: whatever failure the
      // last quiet poll showed is stale by now, so clear it here instead of
      // waiting for the next load the user triggers.
      if (quiet) setError(null);
      setCatalog(await readCatalog(catalogResponse));
      setToolOptions(await readTools(toolsResponse));
      const { selectedKey: currentKey, mode: currentMode } = selectionRef.current;
      if (quiet) {
        // Create mode and catalog rows have no profile file to re-target.
        if (!currentKey) return;
        const current = next.find((profile) => profileKey(profile) === currentKey);
        if (current) {
          // The editor is not open for edits, so the file it shows may follow.
          if (currentMode === "view") applyDraft(editableProfile(current));
          return;
        }
        // The selected file is gone, so fall through and reselect like a fresh load.
      }
      const rememberedKey = preferredKey ?? getLastSettingsSelection("agents", cwd);
      const chosen = next.find((profile) => profileKey(profile) === rememberedKey)
        ?? next.find((profile) => profile.scope === "project")
        ?? next.find((profile) => profile.scope === "global")
        ?? next[0]
        ?? null;
      setSelectedKey(chosen ? profileKey(chosen) : null);
      setSelectedCatalogKey(null);
      if (chosen) {
        applyDraft(editableProfile(chosen));
        setMode(isWritableScope(chosen.scope) ? "edit" : "view");
        if (isWritableScope(chosen.scope)) setTargetScope(chosen.scope);
      }
    } catch (cause) {
      // A quiet poll never surfaces a failure — the next tick can retry — and an
      // abort is a torn-down panel, not a load failure either. Only a load the
      // user is waiting on may set the banner.
      if (quiet || options?.signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!quiet && !options?.signal?.aborted) setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useAgentsRefresh({
    active,
    draftDirty,
    // A save/override/eject and the load it triggers both suspend polling.
    busy: saving || loading,
    refresh: (signal) => loadProfiles(undefined, { signal, quiet: true }),
  });

  useEffect(() => {
    if (selectedKey) setLastSettingsSelection("agents", selectedKey, cwd);
  }, [cwd, selectedKey]);

  // The model list follows the folder's trust: GET /api/models leaves out an
  // untrusted project's extensions, which can register providers. Trust can
  // change while this section stays mounted (hidden) in Settings, by trusting
  // from Settings › MCP; a new decision loads the list again in place, keeping
  // any profile draft.
  const trustKey = projectTrustReloadKey(trust);
  useEffect(() => {
    const controller = new AbortController();
    setModelsLoading(true);
    setModelsError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/models?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal });
        const data = await response.json() as Partial<ModelsData> & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        setModelOptions(data.modelList ?? []);
        setModelsError(data.modelError ?? null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setModelsError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!controller.signal.aborted) setModelsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [cwd, trustKey]);

  /** The raw-entry inputs are local text; reset them whenever the edited profile changes. */
  const resetRawEntries = () => {
    setRawEntry("");
    setRawExcludeEntry("");
    setRawEntryError(null);
    setRawExcludeEntryError(null);
  };

  const selectProfile = (profile: SubagentProfile) => {
    resetRawEntries();
    setSelectedKey(profileKey(profile));
    setSelectedCatalogKey(null);
    applyDraft(editableProfile(profile));
    setMode(isWritableScope(profile.scope) ? "edit" : "view");
    if (isWritableScope(profile.scope)) setTargetScope(profile.scope);
    setError(null);
  };

  const selectCatalogAgent = (agent: AgentCatalogAgent) => {
    resetRawEntries();
    setSelectedKey(null);
    setSelectedCatalogKey(catalogKey(agent));
    setMode("view");
    setError(null);
  };

  const beginCreate = () => {
    resetRawEntries();
    let name = "custom-agent";
    let suffix = 2;
    while (profiles.some((profile) => profile.name === name)) name = `custom-agent-${suffix++}`;
    setSelectedKey(null);
    setSelectedCatalogKey(null);
    applyDraft({ ...EMPTY_PROFILE, name, displayName: name });
    setMode("create");
    setTargetScope("global");
    setError(null);
  };

  const beginDuplicate = () => {
    if (!selected) return;
    resetRawEntries();
    const name = duplicateProfileName(selected.name, profiles);
    setSelectedKey(null);
    setSelectedCatalogKey(null);
    applyDraft({
      ...editableProfile(selected),
      name,
      displayName: t("agents.copyName", { name: selected.displayName ?? selected.name }),
    });
    setMode("create");
    setTargetScope(isWritableScope(selected.scope) ? selected.scope : "global");
    setError(null);
  };

  /**
   * Toggle a read-only catalog agent through its user-scope settings override,
   * then refetch profiles + catalog so the row reflects the new effective state
   * the disable ladder computes.
   */
  const toggleCatalogDisabled = async (agent: AgentCatalogAgent, disabled: boolean) => {
    setSaving(true);
    setError(null);
    const key = catalogKey(agent);
    try {
      const response = await fetch("/api/subagents/overrides", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, name: agent.name, disabled }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      await loadProfiles();
      // loadProfiles clears and may reselect profiles; re-select the catalog
      // row so the switch the user just flipped stays in view.
      setSelectedKey(null);
      setSelectedCatalogKey(key);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  /** pi-subagents `eject`: copy a catalog agent file verbatim into a writable agent dir. */
  const ejectCatalogAgent = async (agent: AgentCatalogAgent, scope: SubagentWritableScope, name: string) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/subagents/eject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope, sourcePath: agent.filePath, name }),
      });
      const data = await response.json() as { profile?: SubagentProfile; error?: string };
      if (!response.ok || data.error || !data.profile) throw new Error(data.error ?? `HTTP ${response.status}`);
      await loadProfiles(profileKey(data.profile));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: targetScope, profile: draft }),
      });
      const data = await response.json() as { profile?: SubagentProfile; error?: string };
      if (!response.ok || data.error || !data.profile) throw new Error(data.error ?? `HTTP ${response.status}`);
      await loadProfiles(profileKey(data.profile));
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected || !isWritableScope(selected.scope)) return;
    resetRawEntries();
    if (!window.confirm(t("agents.deleteConfirm", { name: selected.displayName ?? selected.name }))) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: selected.scope, name: selected.name }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      await loadProfiles();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const editing = mode !== "view";
  const creating = mode === "create";
  const disabled = !editing || saving;
  const displayedScope = creating ? targetScope : selected?.scope;
  const displayedPath = creating
    ? targetScope === "global"
      ? `~/.pi/agent/agents/${draft.name || "..."}.md`
      : `./.pi/agents/${draft.name || "..."}.md`
    : selected
      ? displayProfilePath(selected, cwd) ?? ""
      : "";
  const fullPath = creating ? displayedPath : selected?.filePath ?? displayedPath;
  const selectedModelAvailable = !draft.model || modelOptions.some((model) => `${model.provider}/${model.id}` === draft.model);
  const selectedModel = (() => {
    if (!draft.model) return null;
    const separator = draft.model.indexOf("/");
    return separator < 0
      ? { provider: "", modelId: draft.model }
      : { provider: draft.model.slice(0, separator), modelId: draft.model.slice(separator + 1) };
  })();
  const controlStyle = disabled ? { ...inputStyle, ...disabledInputStyle } : inputStyle;
  const update = <K extends keyof EditableProfile>(key: K, value: EditableProfile[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const updateExtensions = (patch: Partial<SubagentExtensions>) => {
    setDraft((current) => {
      const next: SubagentExtensions = { ...cloneExtensions(current.extensions), ...patch };
      return { ...current, extensions: next };
    });
  };
  const toggleTool = (list: "tools" | "excludeTools", tool: string, checked: boolean) => {
    setDraft((current) => {
      const values = current[list] ?? [];
      const next = checked ? [...values, tool] : values.filter((item) => item !== tool);
      return { ...current, [list]: next };
    });
  };
  const removeRaw = (list: "tools" | "excludeTools", value: string) => {
    setDraft((current) => ({ ...current, [list]: (current[list] ?? []).filter((item) => item !== value) }));
  };
  const appendRaw = (list: "tools" | "excludeTools", value: string) => {
    const entry = value.trim();
    const setEntryError = list === "tools" ? setRawEntryError : setRawExcludeEntryError;
    if (!entry) return;
    // A comma would be re-split into separate entries on the next read, so reject it
    // here rather than silently writing one value where the file format means many.
    if (entry.includes(",")) {
      setEntryError(t("agents.rawEntryComma"));
      return;
    }
    setEntryError(null);
    setDraft((current) => {
      const values = current[list] ?? [];
      return values.includes(entry) ? current : { ...current, [list]: [...values, entry] };
    });
  };
  const formKey = creating ? `create:${draft.name}` : selectedKey ?? "none";

  return (
    <ConfigPanelShell embedded={embedded} title={t("common.agents")} subtitle={shortenPath(cwd)} closeLabel={t("agents.close")} onClose={onClose}>
      <ConfigSplitView>
        <ConfigSidebar>
          <ConfigSidebarList>
              {loading ? (
                <div style={{ padding: 10, color: "var(--text-dim)", fontSize: 12 }}>{t("agents.loading")}</div>
              ) : (["project", "global", "workspace"] as const).map((scope) => {
                const scopedProfiles = profiles.filter((profile) => profile.scope === scope);
                if (scopedProfiles.length === 0) return null;
                return (
                  <div key={scope} className="config-sidebar-group">
                    <ConfigSidebarGroupLabel>{t(`agents.scope.${scope}`)}</ConfigSidebarGroupLabel>
                    {scopedProfiles.map((profile) => {
                      const overridden = isSubagentProfileOverridden(profile, profiles);
                      return (
                        <ConfigSidebarItem
                          key={profileKey(profile)}
                          active={selectedKey === profileKey(profile) && !creating}
                          onClick={() => selectProfile(profile)}
                        >
                          <ConfigStatusDot active />
                          <ConfigSidebarText className="is-grow">{profile.displayName ?? profile.name}</ConfigSidebarText>
                          {overridden && <span className="agents-overridden-label">{t("agents.overridden")}</span>}
                        </ConfigSidebarItem>
                      );
                    })}
                  </div>
                );
              })}
              {/* Built-in, package, and out-of-editor project/user agents the
                  editor cannot open, shown so the panel matches what the
                  runtime can actually dispatch. Project rows whose file the
                  profiles route already lists stay in the editable groups; this
                  group holds the project-scope rows it does not read (scan dirs,
                  project-scope packages). */}
              {!loading && (["builtin", "package", "user", "project"] as const).map((source) => {
                const sourceAgents = uneditable.filter((agent) => agent.source === source);
                if (sourceAgents.length === 0) return null;
                return (
                  <div key={source} className="config-sidebar-group">
                    <ConfigSidebarGroupLabel>{t(sourceLabelKey(source))}</ConfigSidebarGroupLabel>
                    {sourceAgents.map((agent) => (
                      <ConfigSidebarItem
                        key={catalogKey(agent)}
                        active={selectedCatalogKey === catalogKey(agent)}
                        onClick={() => selectCatalogAgent(agent)}
                      >
                        <ConfigStatusDot active={agent.disabled !== true} />
                        <ConfigSidebarText className={`is-grow${agent.disabled ? " is-muted" : ""}`}>
                          {agent.displayName ?? agent.name}
                        </ConfigSidebarText>
                        {agent.overriddenBy && <span className="agents-overridden-label">{t("agents.overridden")}</span>}
                      </ConfigSidebarItem>
                    ))}
                  </div>
                );
              })}
          </ConfigSidebarList>
          <ConfigListAction
                active={creating}
                onClick={beginCreate}
              >
                {t("agents.new")}
          </ConfigListAction>
        </ConfigSidebar>

        <ConfigDetail>
          <ConfigDetailStack className="is-fill">
              {!selected && !selectedCatalog && !creating ? (
                <ConfigEmptyState>{t("agents.empty")}</ConfigEmptyState>
              ) : selectedCatalog ? (
                <CatalogAgentDetail
                  key={catalogKey(selectedCatalog)}
                  agent={selectedCatalog}
                  saving={saving}
                  onToggleDisabled={(agent, disabled) => void toggleCatalogDisabled(agent, disabled)}
                  onEject={(agent, scope, name) => void ejectCatalogAgent(agent, scope, name)}
                />
              ) : (
                <ConfigDetailStack>
                  <ConfigDetailHeader>
                    <ConfigDetailHeaderInfo>
                      {/* A new profile chooses its scope where a saved one shows it. */}
                      {creating ? (
                        <ConfigSaveTarget
                          value={targetScope}
                          label={t("config.saveTo")}
                          options={(["global", "project"] as const).map((scope) => ({
                            value: scope,
                            label: t(`agents.scope.${scope}`),
                            disabled: saving,
                          }))}
                          path={displayedPath}
                          onChange={setTargetScope}
                        />
                      ) : (
                        <>
                          {displayedScope && (
                            <ConfigScopeTag scope={displayedScope}>{t(`agents.scope.${displayedScope}`)}</ConfigScopeTag>
                          )}
                          <span title={fullPath} className="config-detail-path">
                            {displayedPath}
                          </span>
                        </>
                      )}
                    </ConfigDetailHeaderInfo>
                    <ConfigDetailActions>
                      {selected && (mode === "view" || mode === "edit") && <ConfigButton size="small" onClick={beginDuplicate} disabled={saving}>{t("agents.duplicate")}</ConfigButton>}
                      {selected && isWritableScope(selected.scope) && mode === "edit" && <ConfigButton variant="danger" size="small" onClick={() => void remove()} disabled={saving}>{t("agents.delete")}</ConfigButton>}
                    </ConfigDetailActions>
                  </ConfigDetailHeader>

                  <Section title={t("agents.section.basics")} defaultOpen>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                      <Field label={t("agents.name")}>
                        {creating ? (
                          <input aria-label={t("agents.name")} value={draft.name} disabled={disabled} onChange={(event) => update("name", event.target.value)} style={inputStyle} />
                        ) : (
                          <code style={{ minHeight: 34, display: "flex", alignItems: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: 12 }}>
                            {draft.name}
                          </code>
                        )}
                      </Field>
                      <Field label={t("agents.displayName")}>
                        <input aria-label={t("agents.displayName")} value={draft.displayName ?? ""} disabled={disabled} onChange={(event) => update("displayName", event.target.value)} style={controlStyle} />
                      </Field>
                    </div>
                    <Field label={t("agents.description")}>
                      <input aria-label={t("agents.description")} value={draft.description} disabled={disabled} onChange={(event) => update("description", event.target.value)} style={controlStyle} />
                    </Field>
                    <p className="agents-catalog-note">{t("agents.enabledViaSettings")}</p>
                  </Section>

                  <Section title={t("agents.section.prompt")} defaultOpen>
                    <Field label={t("agents.prompt")}>
                      <textarea className="agents-system-prompt" aria-label={t("agents.prompt")} value={draft.systemPrompt} disabled={disabled} onChange={(event) => update("systemPrompt", event.target.value)} style={{ ...controlStyle, height: 195, minHeight: 195, maxHeight: "60vh", padding: 9, overflow: "auto", resize: disabled ? "none" : "vertical", lineHeight: 1.5 }} />
                    </Field>
                    <Field label={t("agents.systemPromptMode")}>
                      <select aria-label={t("agents.systemPromptMode")} value={draft.systemPromptMode ?? "replace"} disabled={disabled} onChange={(event) => update("systemPromptMode", event.target.value as EditableProfile["systemPromptMode"])} style={controlStyle}>
                        <option value="replace">{t("agents.systemPromptMode.replace")}</option>
                        <option value="append">{t("agents.systemPromptMode.append")}</option>
                      </select>
                    </Field>
                  </Section>

                  <Section title={t("agents.section.tools")} defaultOpen>
                    <Toggle
                      label={t("agents.toolsInherit")}
                      disabled={disabled}
                      checked={draft.toolsInherited === true}
                      onChange={(checked) => update("toolsInherited", checked)}
                    />
                    <p className="agents-catalog-note">{t("agents.toolsInheritHelp")}</p>
                    {!draft.toolsInherited && (
                      <>
                        <Field label={t("agents.tools")}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px" }}>
                            {toolOptions.map((tool) => (
                              <Toggle key={tool.name} label={tool.name} disabled={disabled} checked={(draft.tools ?? []).includes(tool.name)} onChange={(checked) => toggleTool("tools", tool.name, checked)} />
                            ))}
                          </div>
                        </Field>
                        <RawEntries values={rawTools} disabled={disabled} removeLabel={t("agents.removeEntry")} onRemove={(value) => removeRaw("tools", value)} />
                        <Field label={t("agents.rawEntryInput")}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <input aria-label={t("agents.rawEntryInput")} value={rawEntry} disabled={disabled} placeholder={t("agents.rawEntryPlaceholder")} onChange={(event) => { setRawEntry(event.target.value); if (rawEntryError) setRawEntryError(null); }} style={controlStyle} />
                            <ConfigButton size="small" disabled={disabled} onClick={() => { appendRaw("tools", rawEntry); if (!rawEntry.includes(",")) setRawEntry(""); }}>+</ConfigButton>
                          </div>
                          {rawEntryError && <span role="alert" style={{ color: "#ef4444", fontSize: 10 }}>{rawEntryError}</span>}
                        </Field>
                      </>
                    )}
                    <Field label={t("agents.excludeTools")}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px" }}>
                        {toolOptions.map((tool) => (
                          <Toggle key={tool.name} label={tool.name} disabled={disabled} checked={(draft.excludeTools ?? []).includes(tool.name)} onChange={(checked) => toggleTool("excludeTools", tool.name, checked)} />
                        ))}
                      </div>
                    </Field>
                    <RawEntries values={rawExcludeTools} disabled={disabled} removeLabel={t("agents.removeEntry")} onRemove={(value) => removeRaw("excludeTools", value)} />
                    <Field label={t("agents.rawEntryInput")}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input aria-label={`${t("agents.excludeTools")} ${t("agents.rawEntryInput")}`} value={rawExcludeEntry} disabled={disabled} placeholder={t("agents.rawEntryPlaceholder")} onChange={(event) => { setRawExcludeEntry(event.target.value); if (rawExcludeEntryError) setRawExcludeEntryError(null); }} style={controlStyle} />
                        <ConfigButton size="small" disabled={disabled} onClick={() => { appendRaw("excludeTools", rawExcludeEntry); if (!rawExcludeEntry.includes(",")) setRawExcludeEntry(""); }}>+</ConfigButton>                      </div>
                      {rawExcludeEntryError && <span role="alert" style={{ color: "#ef4444", fontSize: 10 }}>{rawExcludeEntryError}</span>}
                    </Field>
                  </Section>

                  <Section title={t("agents.section.model")}>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.5fr) minmax(120px, 0.75fr)", gap: 12 }}>
                      <Field label={t("agents.model")}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <ModelSelector
                            options={modelSelectorOptions}
                            value={selectedModel}
                            onChange={(provider, modelId) => update("model", `${provider}/${modelId}`)}
                            onClear={() => update("model", undefined)}
                            emptyLabel={modelsLoading ? t("agents.modelsLoading") : t("agents.inherit")}
                            selectedLabel={draft.model && !selectedModelAvailable ? t("agents.modelUnavailable", { model: draft.model }) : undefined}
                            disabled={disabled || modelsLoading || (modelOptions.length === 0 && !draft.model)}
                            ariaLabel={t("agents.model")}
                            variant="field"
                            placement="auto"
                          />
                          {modelsError && <span style={{ color: "#ef4444", fontSize: 10 }}>{modelsError}</span>}
                        </div>
                      </Field>
                      <Field label={t("agents.thinking")}>
                        <select aria-label={t("agents.thinking")} value={draft.thinking ?? ""} disabled={disabled} onChange={(event) => update("thinking", (event.target.value || undefined) as EditableProfile["thinking"])} style={controlStyle}>
                          {THINKING_OPTIONS.map((value) => <option key={value || "default"} value={value}>{value || t("agents.inherit")}</option>)}
                        </select>
                      </Field>
                    </div>
                  </Section>

                  <Section title={t("agents.section.context")}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px" }}>
                      <Toggle label={t("agents.inheritProjectContext")} disabled={disabled} checked={draft.inheritProjectContext === true} onChange={(checked) => update("inheritProjectContext", checked)} />
                      <Toggle label={t("agents.inheritGlobalContext")} disabled={disabled || !draft.inheritProjectContext} checked={draft.inheritGlobalContext === true} onChange={(checked) => update("inheritGlobalContext", checked)} />
                      <Toggle label={t("agents.inheritSkills")} disabled={disabled} checked={draft.inheritSkills === true} onChange={(checked) => update("inheritSkills", checked)} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                      <Field label={t("agents.skills")}>
                        <ListInput
                          key={`${formKey}:skills`}
                          initial={draft.skills ?? []}
                          disabled={disabled}
                          ariaLabel={t("agents.skills")}
                          onChange={(values) => update("skills", values)}
                        />
                      </Field>
                      <Field label={t("agents.skillPath")}>
                        <ListInput
                          key={`${formKey}:skillPath`}
                          initial={draft.skillPath ?? []}
                          disabled={disabled}
                          ariaLabel={t("agents.skillPath")}
                          onChange={(values) => update("skillPath", values)}
                        />
                      </Field>
                    </div>
                  </Section>

                  <Section title={t("agents.section.extensions")}>
                    <Field label={t("agents.extensionsMode")}>
                      <select aria-label={t("agents.extensionsMode")} value={draft.extensions?.kind ?? "omit"} disabled={disabled} onChange={(event) => updateExtensions({ kind: event.target.value as SubagentExtensions["kind"] })} style={controlStyle}>
                        <option value="omit">{t("agents.extensionsOmit")}</option>
                        <option value="none">{t("agents.extensionsNone")}</option>
                        <option value="list">{t("agents.extensionsList")}</option>
                      </select>
                    </Field>
                    {draft.extensions?.kind === "list" && (
                      <Field label={t("agents.extensionsList")}>
                        <ListInput
                          key={`${formKey}:extensions`}
                          initial={draft.extensions.list ?? []}
                          disabled={disabled}
                          ariaLabel={t("agents.extensionsList")}
                          placeholder={t("agents.extensionsListPlaceholder")}
                          onChange={(values) => updateExtensions({ kind: "list", list: values })}
                        />
                      </Field>
                    )}
                    <Field label={t("agents.subagentOnlyExtensions")}>
                      <ListInput
                        key={`${formKey}:subagentOnlyExtensions`}
                        initial={draft.subagentOnlyExtensions ?? []}
                        disabled={disabled}
                        ariaLabel={t("agents.subagentOnlyExtensions")}
                        onChange={(values) => update("subagentOnlyExtensions", values)}
                      />
                    </Field>
                  </Section>

                  <Section title={t("agents.section.launch")}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px" }}>
                      <Toggle label={t("agents.background")} disabled={disabled} checked={draft.async === true} onChange={(checked) => update("async", checked)} />
                      <Toggle label={t("agents.allowNestedSubagents")} disabled={disabled} checked={draft.allowNestedSubagents === true} onChange={(checked) => update("allowNestedSubagents", checked)} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                      <Field label={t("agents.defaultContext")}>
                        <select aria-label={t("agents.defaultContext")} value={draft.defaultContext ?? ""} disabled={disabled} onChange={(event) => update("defaultContext", (event.target.value || undefined) as EditableProfile["defaultContext"])} style={controlStyle}>
                          {CONTEXT_OPTIONS.map((value) => <option key={value || "unset"} value={value}>{value || t("agents.unset")}</option>)}
                        </select>
                      </Field>
                      <Field label={t("agents.timeoutMs")}>
                        <input aria-label={t("agents.timeoutMs")} type="number" min={1} value={draft.timeoutMs ?? ""} disabled={disabled} onChange={(event) => update("timeoutMs", event.target.value ? Number(event.target.value) : undefined)} style={controlStyle} />
                      </Field>
                      <Field label={t("agents.toolTimeoutMs")}>
                        <input aria-label={t("agents.toolTimeoutMs")} type="number" min={1} max={2147483647} value={draft.toolTimeoutMs ?? ""} disabled={disabled} onChange={(event) => update("toolTimeoutMs", event.target.value ? Number(event.target.value) : undefined)} style={controlStyle} />
                      </Field>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 2fr)", gap: 12 }}>
                      <Field label={t("agents.maxSubagentDepth")}>
                        <input aria-label={t("agents.maxSubagentDepth")} type="number" min={0} value={draft.maxSubagentDepth ?? ""} disabled={disabled} onChange={(event) => update("maxSubagentDepth", event.target.value ? Number(event.target.value) : undefined)} style={controlStyle} />
                      </Field>
                      <Field label={t("agents.allowedAgents")}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <Toggle
                            label={t("agents.denyAllDescendants")}
                            disabled={disabled}
                            checked={draft.allowedAgentsDenyAll === true}
                            onChange={(checked) => setDraft((current) => ({ ...current, allowedAgentsDenyAll: checked, ...(checked ? { allowedAgents: [] } : {}) }))}
                          />
                          <ListInput
                            key={`${formKey}:allowedAgents:${draft.allowedAgentsDenyAll === true ? "deny" : "list"}`}
                            initial={draft.allowedAgents ?? []}
                            disabled={disabled || draft.allowedAgentsDenyAll === true}
                            ariaLabel={t("agents.allowedAgents")}
                            onChange={(values) => update("allowedAgents", values)}
                          />
                          <span className="agents-catalog-note">{t("agents.allowedAgentsHelp")}</span>
                        </div>
                      </Field>
                    </div>
                  </Section>

                  <Section title={t("agents.section.extras")}>
                    <Toggle label={t("agents.advertise")} disabled={disabled} checked={draft.advertise === true} onChange={(checked) => update("advertise", checked)} />
                    <Toggle label={t("agents.defaultProgress")} disabled={disabled} checked={draft.defaultProgress === true} onChange={(checked) => update("defaultProgress", checked)} />
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                      <Field label={t("agents.output")}>
                        <input aria-label={t("agents.output")} value={draft.output ?? ""} disabled={disabled} onChange={(event) => update("output", event.target.value || undefined)} style={controlStyle} />
                      </Field>
                      <Field label={t("agents.acceptanceRole")}>
                        <select aria-label={t("agents.acceptanceRole")} value={draft.acceptanceRole ?? ""} disabled={disabled} onChange={(event) => update("acceptanceRole", (event.target.value || undefined) as EditableProfile["acceptanceRole"])} style={controlStyle}>
                          {ACCEPTANCE_ROLE_OPTIONS.map((value) => <option key={value || "unset"} value={value}>{value || t("agents.unset")}</option>)}
                        </select>
                      </Field>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                      <Field label={t("agents.aliases")}>
                        <ListInput
                          key={`${formKey}:aliases`}
                          initial={draft.aliases ?? []}
                          disabled={disabled}
                          ariaLabel={t("agents.aliases")}
                          onChange={(values) => update("aliases", values)}
                        />
                      </Field>
                      <Field label={t("agents.defaultReads")}>
                        <ListInput
                          key={`${formKey}:defaultReads`}
                          initial={draft.defaultReads ?? []}
                          disabled={disabled}
                          ariaLabel={t("agents.defaultReads")}
                          onChange={(values) => update("defaultReads", values)}
                        />
                      </Field>
                    </div>
                  </Section>
                </ConfigDetailStack>
              )}
          </ConfigDetailStack>
        </ConfigDetail>
      </ConfigSplitView>
      <ConfigFooter status={error && <span role="alert" style={{ color: "#ef4444" }}>{error}</span>}>
        {editing && (
          <ConfigButton
            variant="primary"
            onClick={() => void save()}
            disabled={saving || savedOk || !draft.name.trim()}
            className={savedOk ? "is-success" : undefined}
          >
            {savedOk && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="config-button-success-icon">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            <span>{savedOk ? t("i18n.saved") : saving ? t("agents.saving") : t("agents.save")}</span>
          </ConfigButton>
        )}
      </ConfigFooter>
    </ConfigPanelShell>
  );
}
