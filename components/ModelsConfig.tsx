"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { ArrowLeft, Check as CheckIcon, ChevronDown, Eye, EyeOff, Plus, Search, X } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import type { ModelCatalogPreset, ModelCatalogRecommendation } from "@/lib/model-catalog";
import type { DiscoveredModel } from "@/lib/model-discovery";
import {
  hasModelCostDraftValue,
  modelCostToDraft,
  parseCompleteModelCost,
  serializeHeaderRows,
  setCompatBool,
  updateHeaderRow,
  type HeaderRow,
  type ModelCostDraft,
  type ModelCostKey,
} from "./models-config-helpers";
import { ModelsConfigNavigator, ProviderIcon } from "./models-config/ModelsConfigNavigator";
import { DialogShell } from "./DialogShell";
import {
  applySavedModelsConfig,
  filterModelsNavigation,
  isModelsConfigDirty,
  modelsSelectionLabel,
  resolveModelsSelection,
} from "./models-config/models-config-navigation";
import type {
  ApiKeyProvider,
  ModelEntry,
  ModelsAccountItem,
  ModelsCustomProviderItem,
  ModelsDraftController,
  ModelsJson,
  OAuthProvider,
  ProviderEntry,
  Selection,
} from "./models-config/models-config-types";

// ── Component-local state types ────────────────────────────────────────────────

type OAuthLoginState =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "auth"; url: string; instructions: string | null; token: string }
  | { phase: "device_code"; userCode: string; verificationUri: string; intervalSeconds: number | null; expiresInSeconds: number | null }
  | { phase: "prompt"; message: string; placeholder: string | null; token: string }
  | { phase: "select"; message: string; options: { id: string; label: string }[]; token: string }
  | { phase: "progress"; message: string }
  | { phase: "success" }
  | { phase: "error"; message: string };

// ── Component-local state types ────────────────────────────────────────────────

type ModelTestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "success"; latencyMs?: number; status?: number; responseText?: string }
  | { phase: "error"; message: string; latencyMs?: number; status?: number };

type ModelDiscoveryState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; models: DiscoveredModel[]; endpoint: string }
  | { phase: "error"; message: string };

type ModelCatalogState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; recommendation: ModelCatalogRecommendation; appliedCount: number }
  | { phase: "error"; message: string };

const API_OPTIONS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const;
// ── Form field helpers ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: "var(--text-meta)", color: "var(--text-muted)", fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  padding: "6px 9px",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 5,
  color: "var(--text)",
  fontSize: "var(--text-ui)",
  outline: "none",
  width: "100%",
  boxSizing: "border-box" as const,
};

function TextInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
    style={{ ...inputStyle, fontFamily: mono ? "var(--font-mono)" : "inherit" }} />;
}

function SecretTextInput({
  value,
  onChange,
  placeholder,
  mono,
  onKeyDown,
  autoComplete = "off",
  spellCheck = false,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  autoComplete?: string;
  spellCheck?: boolean;
  style?: React.CSSProperties;
}) {
  const [visible, setVisible] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  return (
    <div style={{ position: "relative", width: "100%", ...style }}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={{ ...inputStyle, paddingRight: 34, fontFamily: mono ? "var(--font-mono)" : "inherit" }}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
         aria-label={visible ? t("i18n.hideDetails") : t("i18n.showDetails")}
         title={visible ? t("i18n.hideDetails") : t("i18n.showDetails")}
        style={{
          position: "absolute",
          right: 5,
          top: "50%",
          transform: "translateY(-50%)",
          width: 24,
          height: 24,
          padding: 0,
          border: "none",
          background: "transparent",
          color: "var(--text-dim)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {visible ? (
          <EyeOff size={15} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Eye size={15} strokeWidth={2} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

function NumInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />;
}

function Select({ value, onChange, options, required }: { value: string; onChange: (v: string) => void; options: readonly string[]; required?: boolean }) {
  const { t } = useI18n();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, color: value ? "var(--text)" : "var(--text-dim)" }}>
       {!required && <option value="">— {t("i18n.default")} / none —</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "var(--text-ui)", color: "var(--text-muted)" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 13, height: 13, accentColor: "var(--accent)", cursor: "pointer" }} />
      {label}
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "var(--text-meta)", fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{children}</div>;
}

// ── Provider detail ───────────────────────────────────────────────────────────

function ProviderDetail({ name, provider, onChange, onRename, onDelete, onAddModels }: {
  name: string; provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void; onRename: (n: string) => void; onDelete: () => void;
  onAddModels: (models: DiscoveredModel[]) => void;
}) {
  const { t } = useI18n();
  const [editingName, setEditingName] = useState(name);
  const [discoveryState, setDiscoveryState] = useState<ModelDiscoveryState>({ phase: "idle" });
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const discoveryRequestIdRef = useRef(0);
  const selectShownRef = useRef<HTMLInputElement>(null);
  useEffect(() => setEditingName(name), [name]);
  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) => onChange({ ...provider, [k]: v });

  useEffect(() => {
    if (!provider.api) onChange({ ...provider, api: "openai-completions" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.api]);

  useEffect(() => {
    discoveryRequestIdRef.current += 1;
    setDiscoveryState({ phase: "idle" });
    setDiscoveryQuery("");
    setSelectedModelIds([]);
  }, [name, provider.baseUrl, provider.api, provider.apiKey]);

  const handleDiscoverModels = useCallback(async () => {
    if (!provider.baseUrl?.trim() || discoveryState.phase === "loading") return;
    const requestId = ++discoveryRequestIdRef.current;
    setDiscoveryState({ phase: "loading" });
    setSelectedModelIds([]);
    try {
      const res = await fetch("/api/models-config/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName: name, provider: { ...provider, models: undefined } }),
      });
      const data = await res.json() as { models?: DiscoveredModel[]; endpoint?: string; error?: string };
      if (requestId !== discoveryRequestIdRef.current) return;
      if (!res.ok || data.error || !data.models) {
        setDiscoveryState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setDiscoveryState({ phase: "success", models: data.models, endpoint: data.endpoint ?? provider.baseUrl });
    } catch (error) {
      if (requestId !== discoveryRequestIdRef.current) return;
      setDiscoveryState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [discoveryState.phase, name, provider]);

  const existingModelIds = new Set((provider.models ?? []).map((model) => model.id));
  const discoveredModels = discoveryState.phase === "success" ? discoveryState.models : [];
  const normalizedDiscoveryQuery = discoveryQuery.trim().toLocaleLowerCase();
  const filteredDiscoveredModels = discoveredModels.filter((model) => !normalizedDiscoveryQuery
    || model.id.toLocaleLowerCase().includes(normalizedDiscoveryQuery)
    || model.name?.toLocaleLowerCase().includes(normalizedDiscoveryQuery));
  const shownDiscoveredModels = filteredDiscoveredModels.slice(0, 300);
  const selectableShownIds = shownDiscoveredModels
    .filter((model) => !existingModelIds.has(model.id))
    .map((model) => model.id);
  const selectedCount = selectedModelIds.filter((id) => !existingModelIds.has(id)).length;
  const allShownSelected = selectableShownIds.length > 0
    && selectableShownIds.every((id) => selectedModelIds.includes(id));
  const someShownSelected = !allShownSelected
    && selectableShownIds.some((id) => selectedModelIds.includes(id));

  useEffect(() => {
    if (selectShownRef.current) selectShownRef.current.indeterminate = someShownSelected;
  }, [someShownSelected]);

  const toggleDiscoveredModel = (id: string) => {
    setSelectedModelIds((current) => current.includes(id)
      ? current.filter((entry) => entry !== id)
      : [...current, id]);
  };

  const toggleShownModels = () => {
    const shownIds = new Set(selectableShownIds);
    setSelectedModelIds((current) => allShownSelected
      ? current.filter((id) => !shownIds.has(id))
      : Array.from(new Set([...current, ...selectableShownIds])));
  };

  const addSelectedModels = () => {
    if (discoveryState.phase !== "success") return;
    const selected = new Set(selectedModelIds);
    const additions = discoveryState.models.filter((model) => selected.has(model.id) && !existingModelIds.has(model.id));
    if (additions.length === 0) return;
    onAddModels(additions);
    setSelectedModelIds([]);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
         <SectionTitle>{t("i18n.provider")}</SectionTitle>
        <span style={{ fontSize: "var(--text-meta)", color: "var(--text-dim)" }}>
          {t("models.modelCount", { count: provider.models?.length ?? 0 })}
        </span>
      </div>

       <Field label={t("i18n.providerName")}>
        <TextInput value={editingName} onChange={setEditingName} placeholder="provider-name" mono />
        {editingName !== name && editingName.trim() && (
          <button onClick={() => onRename(editingName.trim())}
            style={{ marginTop: 4, padding: "3px 10px", background: "var(--accent)", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: "var(--text-meta)", alignSelf: "flex-start" }}>
             {t("i18n.rename")}
          </button>
        )}
      </Field>

      <Field label="Base URL">
        <TextInput value={provider.baseUrl ?? ""} onChange={(v) => set("baseUrl", v || undefined)}
          placeholder="https://api.example.com/v1" mono />
      </Field>

      <Field label="API Key">
        <SecretTextInput value={provider.apiKey ?? ""} onChange={(v) => set("apiKey", v || undefined)}
          placeholder="ENV_VAR_NAME, !shell-command, or literal key" mono />
        <span style={{ fontSize: "var(--text-meta)", color: "var(--text-dim)", marginTop: 2 }}>
          Prefix with <code style={{ fontFamily: "var(--font-mono)" }}>!</code> to run a shell command, or use an env var name
        </span>
      </Field>

      <Field label="API">
        <Select value={provider.api ?? "openai-completions"} onChange={(v) => set("api", v)} options={API_OPTIONS} required />
      </Field>

      <section style={{ borderTop: "1px solid var(--border)" }}>
        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          aria-expanded={advancedOpen}
          aria-controls="provider-advanced-settings"
          style={{
            width: "100%", minHeight: 44, padding: "8px 0", border: "none", background: "transparent",
            display: "grid", gridTemplateColumns: "minmax(0, 1fr) 18px", alignItems: "center", gap: 10,
            color: "var(--text)", cursor: "pointer", textAlign: "left",
          }}
        >
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: "var(--text-meta)", fontWeight: 600 }}>{t("models.advancedSettings")}</span>
            <span style={{ display: "block", marginTop: 3, color: "var(--text-dim)", fontSize: "var(--text-meta)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {Object.keys(provider.headers ?? {}).length
                ? t("models.headersSummary", { count: Object.keys(provider.headers ?? {}).length })
                : t("models.providerDefaults")}
            </span>
          </span>
          <ChevronDown size={16} strokeWidth={2} aria-hidden="true" style={{ color: "var(--text-dim)", transform: advancedOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }} />
        </button>

        {advancedOpen && (
          <div id="provider-advanced-settings" style={{ display: "flex", flexDirection: "column", gap: 14, padding: "4px 0 16px" }}>
            <Field label={t("models.headers")}>
              <HeaderListEditor
                headers={provider.headers}
                onChange={(headers) => set("headers", headers)}
              />
              <span style={{ fontSize: "var(--text-meta)", color: "var(--text-dim)", marginTop: 2 }}>
                {t("models.providerHeadersHelp")}
              </span>
            </Field>
          </div>
        )}
      </section>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {discoveryState.phase !== "success" && (
          <button
            onClick={handleDiscoverModels}
            disabled={!provider.baseUrl?.trim() || discoveryState.phase === "loading"}
            style={{
              alignSelf: "flex-start", height: 30, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 5,
              background: "var(--bg-panel)", color: !provider.baseUrl?.trim() || discoveryState.phase === "loading" ? "var(--text-dim)" : "var(--text-muted)",
              cursor: !provider.baseUrl?.trim() || discoveryState.phase === "loading" ? "not-allowed" : "pointer", fontSize: "var(--text-meta)",
            }}
          >
            {discoveryState.phase === "loading" ? t("models.discoveryFetching") : t("models.discoveryFetch")}
          </button>
        )}

        {discoveryState.phase === "error" && (
          <div style={{ padding: "7px 9px", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 5, color: "#ef4444", fontSize: "var(--text-meta)", lineHeight: "var(--leading-ui)" }}>
            {discoveryState.message}
          </div>
        )}

        {discoveryState.phase === "success" && (
          <>
            <input
              value={discoveryQuery}
              onChange={(event) => setDiscoveryQuery(event.target.value)}
              placeholder={t("models.discoveryFilterPlaceholder", { count: discoveryState.models.length })}
              aria-label={t("models.discoveryFilter")}
              style={{ ...inputStyle, width: "100%", minWidth: 0 }}
            />

            <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)" }}>
              <label
                style={{
                  minHeight: 32, padding: "5px 9px", display: "flex", alignItems: "center", gap: 8,
                  position: "sticky", top: 0, zIndex: 1, borderBottom: "1px solid var(--border)",
                  background: "var(--bg)", cursor: selectableShownIds.length ? "pointer" : "default",
                  color: "var(--text-muted)", fontSize: "var(--text-meta)", fontWeight: 600,
                }}
              >
                <input
                  ref={selectShownRef}
                  type="checkbox"
                  checked={allShownSelected}
                  disabled={selectableShownIds.length === 0}
                  onChange={toggleShownModels}
                  style={{ width: 13, height: 13, accentColor: "var(--accent)", flexShrink: 0 }}
                />
                {t("models.discoverySelectShown")}
              </label>
              {shownDiscoveredModels.length === 0 ? (
                <div style={{ padding: 12, color: "var(--text-dim)", fontSize: "var(--text-meta)" }}>{t("models.discoveryNoMatches")}</div>
              ) : shownDiscoveredModels.map((model, index) => {
                const alreadyAdded = existingModelIds.has(model.id);
                const checked = selectedModelIds.includes(model.id);
                return (
                  <label
                    key={model.id}
                    style={{
                      minHeight: 36, padding: "6px 9px", display: "flex", alignItems: "center", gap: 8,
                      borderTop: index === 0 ? "none" : "1px solid var(--border)", cursor: alreadyAdded ? "default" : "pointer",
                      opacity: alreadyAdded ? 0.65 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked || alreadyAdded}
                      disabled={alreadyAdded}
                      onChange={() => toggleDiscoveredModel(model.id)}
                      style={{ width: 13, height: 13, accentColor: "var(--accent)", flexShrink: 0 }}
                    />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: "var(--text-meta)" }}>{model.name ?? model.id}</span>
                      {model.name && <code style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: "var(--text-meta)", fontFamily: "var(--font-mono)" }}>{model.id}</code>}
                    </span>
                    {alreadyAdded && <span style={{ color: "var(--text-dim)", fontSize: "var(--text-meta)" }}>{t("models.discoveryAdded")}</span>}
                  </label>
                );
              })}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span title={discoveryState.endpoint} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: "var(--text-meta)" }}>
                {filteredDiscoveredModels.length > shownDiscoveredModels.length
                  ? t("models.discoveryShowing", { shown: shownDiscoveredModels.length, total: filteredDiscoveredModels.length })
                  : t("models.discoveryFetched", { count: discoveryState.models.length })}
              </span>
              <button
                onClick={addSelectedModels}
                disabled={selectedCount === 0}
                style={{ height: 28, padding: "0 11px", border: "none", borderRadius: 5, background: selectedCount ? "var(--accent)" : "var(--bg-panel)", color: selectedCount ? "#fff" : "var(--text-dim)", cursor: selectedCount ? "pointer" : "not-allowed", fontSize: "var(--text-meta)", fontWeight: 600, whiteSpace: "nowrap" }}
              >
                {selectedCount
                  ? t("models.discoveryAddSelectedCount", { count: selectedCount })
                  : t("models.discoveryAddSelected")}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="models-settings-danger-zone">
        <span className="models-settings-danger-zone-label">{t("models.dangerZone")}</span>
        <button
          type="button"
          className="models-settings-danger-button"
          onClick={onDelete}
        >
          {t("models.deleteProvider")}
        </button>
      </div>
    </div>
  );
}

// ── ThinkingLevelMap editor ───────────────────────────────────────────────────

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = typeof THINKING_LEVELS[number];

const LEVEL_COLORS: Record<ThinkingLevel, string> = {
  off:     "var(--text-dim)",
  minimal: "#6b7280",
  low:     "#60a5fa",
  medium:  "#a78bfa",
  high:    "#f472b6",
  xhigh:   "#fb923c",
  max:     "#ef4444",
};

function ThinkingLevelMapEditor({
  value,
  onChange,
}: {
  value: Record<string, string | null> | undefined;
  onChange: (v: Record<string, string | null> | undefined) => void;
}) {
  const map = value ?? {};

  const setLevel = (level: ThinkingLevel, entry: string | null | "omit") => {
    const next = { ...map };
    if (entry === "omit") {
      delete next[level];
    } else {
      next[level] = entry;
    }
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {THINKING_LEVELS.map((level) => {
        const raw = map[level];
        const state: "omit" | "null" | "string" =
          !(level in map) ? "omit" : raw === null ? "null" : "string";
        const strVal = typeof raw === "string" ? raw : "";
        const color = LEVEL_COLORS[level];

        const btnBase: React.CSSProperties = {
          padding: "4px 10px",
          fontSize: "var(--text-meta)",
          border: "none",
          cursor: "pointer",
          fontWeight: 400,
          transition: "background 0.1s, color 0.1s",
          whiteSpace: "nowrap",
          background: "var(--bg-panel)",
          color: "var(--text-dim)",
        };
        const btnActive: React.CSSProperties = {
          background: "var(--accent)",
          color: "#fff",
          fontWeight: 600,
        };
        const btnActiveDisabled: React.CSSProperties = {
          background: "#ef4444",
          color: "#fff",
          fontWeight: 600,
        };

        return (
          <div
            key={level}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 4px",
              borderRadius: 6,
              background: "transparent",
              border: "1px solid transparent",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 5, width: 68, flexShrink: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0, opacity: state === "null" ? 0.3 : 1 }} />
              <span style={{
                fontSize: "var(--text-meta)",
                fontFamily: "var(--font-mono)",
                color: state === "null" ? "var(--text-dim)" : "var(--text-muted)",
                textDecoration: state === "null" ? "line-through" : "none",
              }}>
                {level}
              </span>
            </div>

            <div style={{ display: "flex", borderRadius: 5, border: "1px solid var(--border)", overflow: "hidden", flexShrink: 0 }}>
              <button
                onClick={() => setLevel(level, "omit")}
                style={{ ...btnBase, ...(state === "omit" ? btnActive : {}) }}
              >
                Default
              </button>
              <button
                onClick={() => setLevel(level, null)}
                style={{ ...btnBase, borderLeft: "1px solid var(--border)", ...(state === "null" ? btnActiveDisabled : {}) }}
              >
                Disabled
              </button>
            </div>

            <div style={{ display: "flex", borderRadius: 5, border: `1px solid ${state === "string" ? "var(--accent)" : "var(--border)"}`, overflow: "hidden", transition: "border-color 0.1s" }}>
              <button
                onClick={() => setLevel(level, strVal || level)}
                style={{ ...btnBase, ...(state === "string" ? btnActive : {}), borderRight: "1px solid var(--border)", flexShrink: 0 }}
              >
                Custom
              </button>
              <input
                value={strVal}
                onChange={(e) => setLevel(level, e.target.value)}
                onFocus={() => { if (state !== "string") setLevel(level, strVal || level); }}
                placeholder={level}
                maxLength={10}
                style={{
                  width: "12ch",
                  background: state === "string" ? "var(--bg)" : "var(--bg-panel)",
                  border: "none",
                  outline: "none",
                  color: state === "string" ? "var(--text)" : "var(--text-dim)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-meta)",
                  padding: "4px 7px",
                  transition: "background 0.1s, color 0.1s",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Model detail ──────────────────────────────────────────────────────────────

const DEEPSEEK_COMPAT = {
  thinkingFormat: "deepseek",
  requiresReasoningContentOnAssistantMessages: true,
} as const;

function hasDeepseekCompat(model: ModelEntry): boolean {
  return model.compat?.thinkingFormat === "deepseek";
}

function setDeepseekCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) {
    return { ...model, compat: { ...(model.compat ?? {}), ...DEEPSEEK_COMPAT } };
  }
  if (!model.compat) return model;
  const rest = { ...model.compat };
  delete rest.thinkingFormat;
  delete rest.requiresReasoningContentOnAssistantMessages;
  return { ...model, compat: Object.keys(rest).length ? rest : undefined };
}

// Compat can be configured at the provider or model level; provider-composer
// merges them (model wins) at runtime. The UI reads the effective value so
// hand-edited models.json settings are reflected correctly, while toggles
// write to the model entry so a per-model override is explicit.
function effectiveCompat(provider: ProviderEntry, model: ModelEntry): Record<string, unknown> {
  return { ...(provider.compat ?? {}), ...(model.compat ?? {}) };
}

// Editable key/value request-header list for a provider or model. Rows stay
// local so a blank draft is never persisted as an invalid HTTP header name.
function HeaderListEditor({ headers, onChange }: {
  headers: Record<string, string> | undefined;
  onChange: (h: Record<string, string> | undefined) => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<HeaderRow[]>(() => Object.entries(headers ?? {}).map(
    ([name, value], id) => ({ id, name, value }),
  ));
  const nextRowIdRef = useRef(rows.length);

  const applyRows = (next: HeaderRow[]): void => {
    setRows(next);
    onChange(serializeHeaderRows(next));
  };
  const setEntry = (id: number, changes: Partial<Pick<HeaderRow, "name" | "value">>): void => {
    applyRows(updateHeaderRow(rows, id, changes));
  };
  const removeEntry = (id: number): void => {
    applyRows(rows.filter((row) => row.id !== id));
  };
  const rowBtnStyle = {
    padding: "6px 9px",
    background: "none",
    border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: 4,
    color: "#ef4444",
    cursor: "pointer",
    fontSize: "var(--text-meta)",
    lineHeight: 1,
  } satisfies React.CSSProperties;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((row) => (
        <div key={row.id} style={{ display: "flex", gap: 6 }}>
          <input value={row.name} onChange={(e) => setEntry(row.id, { name: e.target.value })}
            placeholder={t("models.headerNamePlaceholder")} style={{ ...inputStyle, fontFamily: "var(--font-mono)", flex: 1 }} />
          <input value={row.value} onChange={(e) => setEntry(row.id, { value: e.target.value })}
            placeholder={t("models.headerValuePlaceholder")} style={{ ...inputStyle, fontFamily: "var(--font-mono)", flex: 1 }} />
          <button onClick={() => removeEntry(row.id)} style={rowBtnStyle}>✕</button>
        </div>
      ))}
      <button onClick={() => setRows((current) => [
        ...current,
        { id: nextRowIdRef.current++, name: "", value: "" },
      ])}
        style={{ padding: "5px 9px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer", fontSize: "var(--text-meta)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, alignSelf: "flex-start" }}>
        + {t("models.addHeader")}
      </button>
    </div>
  );
}

function fillEmptyModelFields(
  model: ModelEntry,
  preset: ModelCatalogPreset,
): { model: ModelEntry; appliedCount: number } {
  const next = { ...model };
  let appliedCount = 0;
  if (!model.name?.trim() && preset.name) {
    next.name = preset.name;
    appliedCount += 1;
  }
  if (model.reasoning === undefined && preset.reasoning === true) {
    next.reasoning = true;
    appliedCount += 1;
  }
  if (!model.input?.length && preset.input?.length) {
    next.input = [...preset.input];
    appliedCount += 1;
  }
  if (model.contextWindow === undefined && preset.contextWindow !== undefined) {
    next.contextWindow = preset.contextWindow;
    appliedCount += 1;
  }
  if (model.maxTokens === undefined && preset.maxTokens !== undefined) {
    next.maxTokens = preset.maxTokens;
    appliedCount += 1;
  }

  if (preset.cost) {
    const cost = { ...(model.cost ?? {}) };
    let filledCostCount = 0;
    for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      if (cost[key] === undefined && preset.cost[key] !== undefined) {
        cost[key] = preset.cost[key];
        filledCostCount += 1;
      }
    }
    const completeCost = parseCompleteModelCost(modelCostToDraft(cost));
    if (filledCostCount > 0 && completeCost) {
      next.cost = { ...cost, ...completeCost };
      appliedCount += filledCostCount;
    }
  }
  return { model: next, appliedCount };
}

function ModelDetail({
  providerName,
  provider,
  model,
  onChange,
  onDelete,
}: {
  providerName: string;
  provider: ProviderEntry;
  model: ModelEntry;
  onChange: (m: ModelEntry) => void;
  onDelete: () => void;
}) {
  const [testState, setTestState] = useState<ModelTestState>({ phase: "idle" });
  const { t } = useI18n();
  const [catalogState, setCatalogState] = useState<ModelCatalogState>({ phase: "idle" });
  const [costEditing, setCostEditing] = useState(false);
  const [costDraft, setCostDraft] = useState<ModelCostDraft>(() => modelCostToDraft(model.cost));
  const costDraftRef = useRef(costDraft);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const catalogRequestIdRef = useRef(0);
  const catalogUndoRef = useRef<ModelEntry | null>(null);
  const costTemplateRef = useRef(model.cost);
  const set = <K extends keyof ModelEntry>(k: K, v: ModelEntry[K]) => onChange({ ...model, [k]: v });
  const setCost = (key: ModelCostKey, value: string) => {
    const nextDraft = { ...costDraftRef.current, [key]: value };
    const completeCost = parseCompleteModelCost(nextDraft);
    const nextModel = { ...model };
    costDraftRef.current = nextDraft;
    setCostDraft(nextDraft);
    if (completeCost) {
      nextModel.cost = { ...(costTemplateRef.current ?? {}), ...completeCost };
      costTemplateRef.current = nextModel.cost;
    } else {
      delete nextModel.cost;
    }
    onChange(nextModel);
  };
  const toggleCostEditing = () => {
    if (costEditing) {
      setCostEditing(false);
      return;
    }
    costTemplateRef.current = model.cost;
    const nextDraft = modelCostToDraft(model.cost);
    costDraftRef.current = nextDraft;
    setCostDraft(nextDraft);
    setCostEditing(true);
  };
  const testSummary = (() => {
    if (testState.phase === "idle") return null;
     if (testState.phase === "testing") return t("i18n.testingModel");
    const meta = [
      testState.latencyMs !== undefined ? `${testState.latencyMs}ms` : null,
      testState.status !== undefined ? `HTTP ${testState.status}` : null,
    ].filter(Boolean);
    if (testState.phase === "success") {
       return [t("i18n.connected"), ...meta, testState.responseText || null].filter(Boolean).join(" · ");
    }
     return [t("i18n.failed"), ...meta, testState.message].filter(Boolean).join(" · ");
  })();

  useEffect(() => {
    setTestState({ phase: "idle" });
  }, [providerName, provider.baseUrl, provider.api, provider.apiKey, model.id, model.api]);

  useEffect(() => {
    catalogRequestIdRef.current += 1;
    setCatalogState({ phase: "idle" });
    catalogUndoRef.current = null;
  }, [providerName, provider.baseUrl, model.id]);

  const handleTest = useCallback(async () => {
    if (!model.id.trim() || testState.phase === "testing") return;
    setTestState({ phase: "testing" });
    try {
      const res = await fetch("/api/models-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName, provider, model }),
      });
      const d = await res.json() as {
        ok?: boolean;
        error?: string;
        latencyMs?: number;
        status?: number;
        responseText?: string;
      };
      if (!res.ok || !d.ok) {
        setTestState({
          phase: "error",
          message: d.error ?? `HTTP ${res.status}`,
          latencyMs: d.latencyMs,
          status: d.status,
        });
        return;
      }
      setTestState({
        phase: "success",
        latencyMs: d.latencyMs,
        status: d.status,
        responseText: d.responseText,
      });
    } catch (e) {
      setTestState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [model, provider, providerName, testState.phase]);

  const handleCatalogFill = useCallback(async () => {
    const query = model.id.trim();
    if (!query || catalogState.phase === "loading") return;
    const requestId = ++catalogRequestIdRef.current;
    setCatalogState({ phase: "loading" });
    try {
      const params = new URLSearchParams({ q: query, provider: providerName, limit: "50" });
      if (provider.baseUrl?.trim()) params.set("baseUrl", provider.baseUrl.trim());
      const res = await fetch(`/api/models-config/catalog?${params}`);
      const data = await res.json() as { recommendation?: ModelCatalogRecommendation; error?: string };
      if (requestId !== catalogRequestIdRef.current) return;
      if (!res.ok || data.error || !data.recommendation) {
        setCatalogState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      const filled = fillEmptyModelFields(model, data.recommendation.preset);
      if (filled.appliedCount > 0) {
        catalogUndoRef.current = model;
        onChange(filled.model);
      }
      setCostEditing(false);
      setCatalogState({
        phase: "success",
        recommendation: data.recommendation,
        appliedCount: filled.appliedCount,
      });
    } catch (error) {
      if (requestId !== catalogRequestIdRef.current) return;
      setCatalogState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [catalogState.phase, model, onChange, provider.baseUrl, providerName]);

  const undoCatalogFill = () => {
    const previous = catalogUndoRef.current;
    if (!previous) return;
    catalogUndoRef.current = null;
    onChange(previous);
    setCatalogState({ phase: "idle" });
  };

  const catalogResultSummary = (() => {
    if (catalogState.phase !== "success") return null;
    const { recommendation, appliedCount } = catalogState;
    const applied = appliedCount > 0
      ? t("models.catalogFilled", { count: appliedCount })
      : t("models.catalogNoEmptyFields");
    if (recommendation.price.status === "unreliable") {
      const price = recommendation.price.reason === "no-exact-match"
        ? t("models.catalogNoExactMatch")
        : t("models.catalogPriceUnreliable");
      return `${applied} · ${price}`;
    }
    const price = recommendation.price.method === "provider"
      ? t("models.catalogPriceProvider", { provider: recommendation.price.providerName ?? recommendation.price.providerId ?? providerName })
      : recommendation.price.method === "base-url"
        ? t("models.catalogPriceBaseUrl", { provider: recommendation.price.providerName ?? recommendation.price.providerId ?? providerName })
        : t("models.catalogPriceConsensus", {
            support: recommendation.price.support,
            total: recommendation.price.total,
          });
    return `${applied} · ${price}`;
  })();
  const catalogStatusText = catalogState.phase === "error"
    ? catalogState.message
    : catalogResultSummary;
  const catalogStatusColor = catalogState.phase === "error"
    ? "#ef4444"
    : catalogState.phase === "success" && catalogState.recommendation.price.status === "unreliable"
      ? "#d97706"
      : "var(--text-dim)";
  const costFields = [
    { key: "input", label: t("models.costInput") },
    { key: "output", label: t("models.costOutput") },
    { key: "cacheRead", label: t("models.costCacheRead") },
    { key: "cacheWrite", label: t("models.costCacheWrite") },
  ] as const;
  const formatCost = (key: ModelCostKey): string => {
    const value = model.cost?.[key];
    return value === undefined ? t("models.notProvided") : `$${String(value)}`;
  };
  const remainingCompatKeys = new Set(Object.keys(model.compat ?? {}));
  let compatibilityOverrideCount = 0;
  if (hasDeepseekCompat(model)) {
    compatibilityOverrideCount += 1;
    remainingCompatKeys.delete("thinkingFormat");
    remainingCompatKeys.delete("requiresReasoningContentOnAssistantMessages");
  }
  if (Object.prototype.hasOwnProperty.call(model.compat ?? {}, "supportsDeveloperRole")) {
    compatibilityOverrideCount += 1;
    remainingCompatKeys.delete("supportsDeveloperRole");
  }
  compatibilityOverrideCount += remainingCompatKeys.size;
  const advancedSummaryParts = [
    model.api ? `API: ${model.api}` : null,
    Object.keys(model.headers ?? {}).length
      ? t("models.headersSummary", { count: Object.keys(model.headers ?? {}).length })
      : null,
    compatibilityOverrideCount
      ? t("models.compatSummary", { count: compatibilityOverrideCount })
      : null,
    Object.keys(model.thinkingLevelMap ?? {}).length
      ? t("models.thinkingSummary", { count: Object.keys(model.thinkingLevelMap ?? {}).length })
      : null,
  ].filter((part): part is string => Boolean(part));
  const advancedSummary = advancedSummaryParts.length
    ? advancedSummaryParts.join(" · ")
    : t("models.providerDefaults");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
         <SectionTitle>{t("i18n.model")}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {testSummary && (
            <span
              title={testSummary}
              style={{
                maxWidth: 260,
                height: 24,
                padding: "0 8px",
                border: `1px solid ${testState.phase === "error" ? "#fecaca" : testState.phase === "success" ? "#bbf7d0" : "var(--border)"}`,
                borderRadius: 4,
                background: testState.phase === "error" ? "#fee2e2" : testState.phase === "success" ? "#dcfce7" : "#e5e7eb",
                color: "#111827",
                fontSize: "var(--text-meta)",
                display: "inline-flex",
                alignItems: "center",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                boxSizing: "border-box",
              }}
            >
              {testSummary}
            </span>
          )}
          <button
            onClick={handleTest}
            disabled={!model.id.trim() || testState.phase === "testing"}
             title={t("i18n.testConnection")}
            style={{
              height: 24,
              padding: "0 8px",
              background: testState.phase === "success" ? "#16a34a" : "none",
              border: `1px solid ${testState.phase === "success" ? "#16a34a" : "var(--border)"}`,
              borderRadius: 4,
              color: testState.phase === "success" ? "#fff" : (!model.id.trim() || testState.phase === "testing") ? "var(--text-dim)" : "var(--text-muted)",
              cursor: (!model.id.trim() || testState.phase === "testing") ? "not-allowed" : "pointer",
              fontSize: "var(--text-meta)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
              gap: 5,
            }}
          >
            {testState.phase === "success" && (
              <CheckIcon size={11} strokeWidth={3} aria-hidden="true" />
            )}
             {testState.phase === "testing" ? t("i18n.checking") : testState.phase === "success" ? t("common.ok") : t("i18n.test")}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="ID *"><TextInput value={model.id} onChange={(v) => set("id", v)} placeholder="model-id" mono /></Field>
        <Field label="Name"><TextInput value={model.name ?? ""} onChange={(v) => set("name", v || undefined)} placeholder="Display name" /></Field>
      </div>

      <div style={{ padding: "2px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => void handleCatalogFill()}
            disabled={!model.id.trim() || catalogState.phase === "loading"}
            style={{
              height: 28, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 5,
              background: "var(--bg-panel)",
              color: !model.id.trim() || catalogState.phase === "loading" ? "var(--text-dim)" : "var(--text-muted)",
              cursor: !model.id.trim() || catalogState.phase === "loading" ? "not-allowed" : "pointer",
              fontSize: "var(--text-meta)",
            }}
          >
            {catalogState.phase === "loading" ? t("models.catalogFilling") : t("models.catalogFill")}
          </button>
          <a
            href="https://github.com/anomalyco/models.dev"
            target="_blank"
            rel="noreferrer"
            style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: "var(--text-meta)", textDecoration: "none" }}
          >
            {t("models.catalogSource")}
          </a>
        </div>

        {catalogStatusText && (
          <div
            aria-live="polite"
            style={{
              marginTop: 8, display: "flex", alignItems: "center",
              justifyContent: "space-between", gap: 8, color: catalogStatusColor, fontSize: "var(--text-meta)",
            }}
          >
            <span
              title={catalogStatusText}
              style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {catalogStatusText}
            </span>
            {catalogUndoRef.current && (
              <button
                onClick={undoCatalogFill}
                style={{ flexShrink: 0, padding: "0 2px", border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontSize: "var(--text-meta)" }}
              >
                {t("models.catalogUndo")}
              </button>
            )}
          </div>
        )}
      </div>

      <div>
        <SectionTitle>{t("models.capabilities")}</SectionTitle>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 8 }}>
          <Check label={t("models.reasoning")} checked={model.reasoning ?? false} onChange={(v) => set("reasoning", v || undefined)} />
          <Check label={t("models.imageInput")} checked={model.input?.includes("image") ?? false}
            onChange={(v) => set("input", v ? ["text", "image"] : undefined)} />
        </div>
      </div>

      <section>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <SectionTitle>{t("models.modelSpecs")}</SectionTitle>
          <button
            type="button"
            onClick={toggleCostEditing}
            aria-expanded={costEditing}
            style={{ padding: "2px 4px", border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer", fontSize: "var(--text-meta)" }}
          >
            {costEditing ? t("models.finishEditingCosts") : t("models.editCosts")}
          </button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
          <Field label={t("models.contextWindow")}>
            <NumInput value={model.contextWindow !== undefined ? String(model.contextWindow) : ""}
              onChange={(v) => set("contextWindow", v ? parseInt(v) : undefined)} placeholder="128000" />
          </Field>
          <Field label={t("models.maxOutputTokens")}>
            <NumInput value={model.maxTokens !== undefined ? String(model.maxTokens) : ""}
              onChange={(v) => set("maxTokens", v ? parseInt(v) : undefined)} placeholder="16384" />
          </Field>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: "var(--text-meta)", color: "var(--text-dim)", fontWeight: 600, textTransform: "uppercase" }}>
            {t("models.costPerMillion")}
          </div>
          {costEditing ? (
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
              {costFields.map(({ key, label }) => (
                <Field key={key} label={label}>
                  <NumInput value={costDraft[key]} onChange={(v) => setCost(key, v)} placeholder="0" />
                </Field>
              ))}
              {hasModelCostDraftValue(costDraft) && !parseCompleteModelCost(costDraft) && (
                <div aria-live="polite" style={{ gridColumn: "1 / -1", color: "#d97706", fontSize: "var(--text-meta)" }}>
                  {t("models.costAllRequired")}
                </div>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(105px, 1fr))", gap: "8px 16px" }}>
              {costFields.map(({ key, label }) => {
                const missing = model.cost?.[key] === undefined;
                return (
                  <div key={key} style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "var(--text-meta)", color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
                    <div style={{ marginTop: 3, color: missing ? "var(--text-dim)" : "var(--text)", fontSize: "var(--text-meta)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
                      {formatCost(key)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section style={{ borderTop: "1px solid var(--border)", paddingTop: 4 }}>
        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          aria-expanded={advancedOpen}
          aria-controls="model-advanced-settings"
          style={{
            width: "100%", minHeight: 48, padding: "8px 0", border: "none", background: "transparent",
            display: "grid", gridTemplateColumns: "minmax(0, 1fr) 18px", alignItems: "center", gap: 10,
            color: "var(--text)", cursor: "pointer", textAlign: "left",
          }}
        >
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: "var(--text-meta)", fontWeight: 600 }}>{t("models.advancedSettings")}</span>
            <span style={{ display: "block", marginTop: 3, color: "var(--text-dim)", fontSize: "var(--text-meta)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {advancedSummary}
            </span>
          </span>
          <ChevronDown size={16} strokeWidth={2} aria-hidden="true" style={{ color: "var(--text-dim)", transform: advancedOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }} />
        </button>

        {advancedOpen && (
          <div id="model-advanced-settings" style={{ display: "flex", flexDirection: "column", gap: 14, padding: "4px 0 16px" }}>
            <Field label={t("models.apiOverride")}>
              <Select value={model.api ?? ""} onChange={(v) => set("api", v || undefined)} options={API_OPTIONS} />
            </Field>

            <Field label={t("models.headers")}>
              <HeaderListEditor
                headers={model.headers}
                onChange={(headers) => set("headers", headers)}
              />
              <span style={{ fontSize: "var(--text-meta)", color: "var(--text-dim)", marginTop: 2 }}>
                {t("models.headersHelp")}
              </span>
            </Field>

            {model.reasoning && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <SectionTitle>{t("models.compatibility")}</SectionTitle>
                <Check
                  label={t("models.deepSeekThinkingCompat")}
                  checked={hasDeepseekCompat(model)}
                  onChange={(v) => onChange(setDeepseekCompat(model, v))}
                />
                <Check
                  label={t("models.developerRole")}
                  checked={effectiveCompat(provider, model)["supportsDeveloperRole"] !== false}
                  onChange={(v) => onChange(setCompatBool(model, "supportsDeveloperRole", v))}
                />
                <div style={{ marginTop: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                    <SectionTitle>{t("models.thinkingLevelMap")}</SectionTitle>
                    {model.thinkingLevelMap && (
                      <button
                        type="button"
                        onClick={() => set("thinkingLevelMap", undefined)}
                        style={{ fontSize: "var(--text-meta)", padding: "2px 5px", background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer" }}
                      >
                        {t("models.clearAll")}
                      </button>
                    )}
                  </div>
                  <ThinkingLevelMapEditor
                    value={model.thinkingLevelMap}
                    onChange={(v) => set("thinkingLevelMap", v)}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <div className="models-settings-danger-zone">
        <span className="models-settings-danger-zone-label">{t("models.dangerZone")}</span>
        <button
          type="button"
          className="models-settings-danger-button"
          onClick={onDelete}
        >
          {t("models.deleteModel")}
        </button>
      </div>
    </div>
  );
}

// ── OAuth detail ──────────────────────────────────────────────────────────────

function OAuthDetail({ provider, onRefresh }: { provider: OAuthProvider; onRefresh: () => void }) {
  const [loginState, setLoginState] = useState<OAuthLoginState>({ phase: "idle" });
  const { t } = useI18n();
  const [inputValue, setInputValue] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loginState.phase === "auth" || loginState.phase === "prompt") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loginState.phase]);

  // Reset state when provider changes
  useEffect(() => {
    setLoginState({ phase: "idle" });
    setInputValue("");
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, [provider.id]);

  useEffect(() => {
    return () => { eventSourceRef.current?.close(); };
  }, []);

  const handleLogin = useCallback(() => {
    eventSourceRef.current?.close();
    setLoginState({ phase: "connecting" });
    setInputValue("");

    const es = new EventSource(`/api/auth/login/${encodeURIComponent(provider.id)}`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as {
        type: string; url?: string; instructions?: string | null;
        token?: string; message?: string; placeholder?: string | null;
        userCode?: string; verificationUri?: string; intervalSeconds?: number | null; expiresInSeconds?: number | null;
        options?: { id: string; label: string }[];
      };
      if (data.type === "auth") {
        setLoginState({ phase: "auth", url: data.url!, instructions: data.instructions ?? null, token: data.token! });
        window.open(data.url!, "_blank", "noopener,noreferrer");
      } else if (data.type === "device_code") {
        setLoginState({
          phase: "device_code",
          userCode: data.userCode!,
          verificationUri: data.verificationUri!,
          intervalSeconds: data.intervalSeconds ?? null,
          expiresInSeconds: data.expiresInSeconds ?? null,
        });
        window.open(data.verificationUri!, "_blank", "noopener,noreferrer");
      } else if (data.type === "prompt_request") {
        setLoginState({ phase: "prompt", message: data.message!, placeholder: data.placeholder ?? null, token: data.token! });
      } else if (data.type === "select_request") {
        setLoginState({ phase: "select", message: data.message!, options: data.options ?? [], token: data.token! });
      } else if (data.type === "progress") {
        setLoginState({ phase: "progress", message: data.message! });
      } else if (data.type === "success") {
        es.close();
        setLoginState({ phase: "success" });
        onRefresh();
      } else if (data.type === "error") {
        es.close();
        setLoginState({ phase: "error", message: data.message! });
      } else if (data.type === "cancelled") {
        es.close();
        setLoginState({ phase: "idle" });
      }
    };
    es.onerror = () => {
      es.close();
      setLoginState((prev) => prev.phase === "success" ? prev : { phase: "error", message: "Connection lost" });
    };
  }, [provider.id, onRefresh]);

  const handleLogout = useCallback(async () => {
    await fetch(`/api/auth/logout/${encodeURIComponent(provider.id)}`, { method: "POST" });
    setLoginState({ phase: "idle" });
    onRefresh();
  }, [provider.id, onRefresh]);

  const submitCode = useCallback(async (token: string, code: string) => {
    if (!code.trim()) return;
    setLoginState({ phase: "progress", message: "Verifying…" });
    try {
      const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: code.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? `Server error ${res.status}` });
        return;
      }
      setInputValue("");
      // Success path: SSE stream will emit "success" and update state
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : "Network error" });
    }
  }, [provider.id]);

  const submitSelection = useCallback(async (token: string, value: string) => {
    setLoginState({ phase: "progress", message: "Continuing…" });
    try {
      const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? `Server error ${res.status}` });
      }
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : "Network error" });
    }
  }, [provider.id]);

  const isWorking = loginState.phase === "connecting" || loginState.phase === "progress" ||
    loginState.phase === "auth" || loginState.phase === "device_code" ||
    loginState.phase === "prompt" || loginState.phase === "select";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
           <SectionTitle>{t("i18n.subscription")}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: provider.loggedIn ? "#4ade80" : "var(--border)", display: "inline-block" }} />
          <span style={{ fontSize: "var(--text-meta)", color: provider.loggedIn ? "#4ade80" : "var(--text-dim)" }}>
             {provider.loggedIn ? t("i18n.connected") : t("i18n.notConnected")}
          </span>
        </div>
      </div>

      {/* Status */}
      <div style={{ minHeight: 48 }}>
        {loginState.phase === "idle" && (
          <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "var(--text-muted)", lineHeight: "var(--leading-prose)" }}>
             {provider.loggedIn ? "Already connected. You can re-login or disconnect." : `Connect your ${provider.name} account.`}
          </p>
        )}
        {loginState.phase === "connecting" && (
            <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "var(--text-muted)" }}>{t("i18n.openingBrowser")}</p>
        )}
        {loginState.phase === "select" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "var(--text-muted)", lineHeight: "var(--leading-prose)" }}>
              {loginState.message}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {loginState.options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => submitSelection(loginState.token, option.id)}
                  style={{ padding: "6px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", cursor: "pointer", fontSize: "var(--text-ui)", textAlign: "left" }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {(loginState.phase === "auth" || loginState.phase === "prompt") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "var(--text-muted)", lineHeight: "var(--leading-prose)" }}>
              {loginState.phase === "auth"
                ? "Complete sign-in in the browser, then copy the redirect URL from the address bar and paste it below."
                : loginState.message}
            </p>
            {loginState.phase === "auth" && (
              <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "var(--text-dim)", lineHeight: "var(--leading-prose)" }}>
                If the browser window did not open,{" "}
                <a href={loginState.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
                  click here to open the login page
                </a>
                .
              </p>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitCode(loginState.token, inputValue); }}
                placeholder={loginState.phase === "auth" ? "http://localhost:1455/auth/callback?code=…" : (loginState.placeholder ?? "Enter value…")}
                style={{ flex: 1, padding: "6px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontSize: "var(--text-ui)", outline: "none", fontFamily: "var(--font-mono)", boxSizing: "border-box" }}
              />
              <button
                onClick={() => submitCode(loginState.token, inputValue)}
                disabled={!inputValue.trim()}
                style={{ padding: "6px 12px", background: inputValue.trim() ? "var(--accent)" : "var(--bg-panel)", border: "none", borderRadius: 5, color: inputValue.trim() ? "#fff" : "var(--text-dim)", cursor: inputValue.trim() ? "pointer" : "not-allowed", fontSize: "var(--text-ui)", fontWeight: 600, flexShrink: 0 }}
              >
                 {t("i18n.submit")}
              </button>
            </div>
          </div>
        )}
        {loginState.phase === "device_code" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "var(--text-muted)", lineHeight: "var(--leading-prose)" }}>
              Open the verification page and enter this code:
            </p>
            <div style={{ padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontSize: "var(--text-chat)", fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: 0 }}>
              {loginState.userCode}
            </div>
            <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "var(--text-dim)", lineHeight: "var(--leading-prose)" }}>
              <a href={loginState.verificationUri} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
                {loginState.verificationUri}
              </a>
              {loginState.expiresInSeconds ? ` Expires in ${Math.ceil(loginState.expiresInSeconds / 60)} minutes.` : ""}
            </p>
          </div>
        )}
        {loginState.phase === "progress" && (
          <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "var(--text-muted)" }}>{loginState.message}</p>
        )}
        {loginState.phase === "success" && (
             <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "#4ade80" }}>{t("i18n.connectedSuccessfully")}</p>
        )}
        {loginState.phase === "error" && (
          <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "#f87171" }}>{loginState.message}</p>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        {isWorking ? (
          <button
            onClick={() => { eventSourceRef.current?.close(); setLoginState({ phase: "idle" }); }}
            style={{ padding: "5px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", fontSize: "var(--text-ui)" }}
          >
             {t("i18n.cancel")}
          </button>
        ) : (
          <>
            <button
              onClick={handleLogin}
              style={{ padding: "5px 14px", background: "var(--accent)", border: "none", borderRadius: 5, color: "#fff", cursor: "pointer", fontSize: "var(--text-ui)", fontWeight: 600 }}
            >
               {provider.loggedIn ? t("i18n.relogin") : t("i18n.login")}
            </button>
            {provider.loggedIn && (
              <button
                onClick={handleLogout}
                style={{ padding: "5px 12px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 5, color: "#ef4444", cursor: "pointer", fontSize: "var(--text-ui)" }}
              >
                 {t("i18n.disconnect")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── API Key detail ────────────────────────────────────────────────────────────

function ApiKeyDetail({ provider, onRefresh }: { provider: ApiKeyProvider; onRefresh: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const { t } = useI18n();

  // Reset state when provider changes
  useEffect(() => {
    setApiKey("");
    setError(null);
    setSavedOk(false);
  }, [provider.id]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setError(d.error ?? `HTTP ${res.status}`);
      } else {
        setApiKey("");
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
        onRefresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [apiKey, provider.id, onRefresh]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, { method: "DELETE" });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) setError(d.error ?? `HTTP ${res.status}`);
      else onRefresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setRemoving(false);
    }
  }, [provider.id, onRefresh]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
         <SectionTitle>API Key</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: provider.configured ? "#4ade80" : "var(--border)", display: "inline-block" }} />
          <span style={{ fontSize: "var(--text-meta)", color: provider.configured ? "#4ade80" : "var(--text-dim)" }}>
             {provider.configured ? t("i18n.configured") : t("i18n.notConfigured")}
          </span>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "var(--text-muted)", lineHeight: "var(--leading-prose)" }}>
        {provider.configured
          ? `API key is stored. Enter a new key below to replace it, or disconnect to remove it.`
          : `Enter your ${provider.displayName} API key to enable ${provider.modelCount} model${provider.modelCount !== 1 ? "s" : ""}.`}
      </p>

      <Field label="API Key">
        <div style={{ display: "flex", gap: 6 }}>
          <SecretTextInput
            value={apiKey}
            onChange={setApiKey}
            onKeyDown={(e) => { if (e.key === "Enter" && apiKey.trim()) handleSave(); }}
            placeholder={provider.configured ? "Enter new key to replace…" : "sk-…"}
            style={{ flex: 1 }}
            autoComplete="off"
            spellCheck={false}
            mono
          />
          <button
            onClick={handleSave}
            disabled={saving || !apiKey.trim() || savedOk}
            style={{
              padding: "6px 12px",
              background: savedOk ? "#16a34a" : apiKey.trim() ? "var(--accent)" : "var(--bg-panel)",
              border: "none", borderRadius: 5,
              color: (apiKey.trim() || savedOk) ? "#fff" : "var(--text-dim)",
              cursor: (saving || !apiKey.trim() || savedOk) ? "not-allowed" : "pointer",
              fontSize: "var(--text-ui)", fontWeight: 600, flexShrink: 0,
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            {savedOk && (
              <CheckIcon size={12} strokeWidth={3} aria-hidden="true" />
            )}
             {savedOk ? t("i18n.saved") : saving ? t("i18n.saving") : t("i18n.save")}
          </button>
        </div>
      </Field>

      {error && <p style={{ margin: 0, fontSize: "var(--text-meta)", color: "#f87171" }}>{error}</p>}

      {provider.configured && (
        <button
          onClick={handleRemove}
          disabled={removing}
          style={{
            alignSelf: "flex-start", padding: "5px 12px",
            background: "none", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 5, color: "#ef4444",
            cursor: removing ? "not-allowed" : "pointer", fontSize: "var(--text-ui)",
          }}
        >
           {removing ? t("i18n.removing") : t("i18n.disconnect")}
        </button>
      )}
    </div>
  );
}

// ── Add provider picker ───────────────────────────────────────────────────────

interface AddProviderPickerProps {
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  mobile: boolean;
  onSelectOAuth: (id: string) => void;
  onSelectApiKey: (id: string) => void;
  onAddCustom: () => void;
  onClose: () => void;
}

function AddProviderPicker({
  oauthProviders, apiKeyProviders, mobile,
  onSelectOAuth, onSelectApiKey, onAddCustom, onClose,
}: AddProviderPickerProps) {
  const [search, setSearch] = useState("");
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      if (dialog?.open) dialog.close();
      previousFocusRef.current?.focus();
    };
  }, []);

  const q = search.trim().toLowerCase();

  const availableOAuth = oauthProviders.filter((p) => !p.loggedIn && (!q || p.name.toLowerCase().includes(q)));
  const availableApiKey = apiKeyProviders.filter((p) => !p.configured && (!q || p.displayName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)));
  const showCustom = !q || "custom".includes(q) || "openai-compatible".includes(q) || "anthropic-compatible".includes(q);

  const totalCount = availableOAuth.length + availableApiKey.length + (showCustom ? 1 : 0);

  return (
    <dialog
      ref={dialogRef}
      className="codex-dialog models-picker"
      data-size="tool"
      aria-label={t("i18n.addProvider")}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
        <div className="models-picker-header">
          {mobile && (
            <button type="button" className="models-picker-back" onClick={onClose} aria-label={t("i18n.back")} title={t("i18n.back")}>
              <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
          <Search size={13} strokeWidth={2} className="models-picker-search-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
             placeholder={t("i18n.searchProviders")}
            aria-label={t("i18n.searchProviders")}
          />
          <button type="button" className="models-picker-close codex-dialog-close" onClick={onClose} aria-label={t("i18n.close")} title={t("i18n.close")}>
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="models-picker-scroll">
          {totalCount === 0 ? (
            <div className="models-picker-empty">{t("i18n.noProviders")}</div>
          ) : (
            <div className="models-picker-grid">
              {showCustom && (
                <button
                  type="button"
                  className="models-picker-card models-picker-card-full"
                  onClick={() => { onAddCustom(); onClose(); }}
                >
                  <div className="models-picker-card-text">
                    <strong>OpenAI / Anthropic compatible</strong>
                    <span>{t("i18n.customEndpoint")}</span>
                  </div>
                  <span className="models-picker-card-icon">
                    <Plus size={13} strokeWidth={2} aria-hidden="true" />
                  </span>
                </button>
              )}

              {availableOAuth.length > 0 && (
                <div className="models-picker-group">{t("i18n.subscriptions")}</div>
              )}
              {availableOAuth.map((p) => (
                <button key={p.id} type="button" className="models-picker-card" onClick={() => { onSelectOAuth(p.id); onClose(); }}>
                  <div className="models-picker-card-text">
                    <strong>{p.name}</strong>
                    <span>OAuth</span>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

              {availableApiKey.length > 0 && (
                <div className="models-picker-group">API Key</div>
              )}
              {availableApiKey.map((p) => (
                <button key={p.id} type="button" className="models-picker-card" onClick={() => { onSelectApiKey(p.id); onClose(); }}>
                  <div className="models-picker-card-text">
                    <strong>{p.displayName}</strong>
                    <span>{t("models.modelCount", { count: p.modelCount })}</span>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}
            </div>
          )}
        </div>
    </dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ModelsConfigProps {
  onControllerChange(controller: ModelsDraftController): void;
}

export function ModelsConfig({ onControllerChange }: ModelsConfigProps) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [config, setConfig] = useState<ModelsJson>({ providers: {} });
  const [baselineConfig, setBaselineConfig] = useState<ModelsJson | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedProviders, setExpandedProviders] = useState<ReadonlySet<string>>(new Set());
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [pendingDelete, setPendingDelete] = useState<Selection | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const loadOAuthProviders = useCallback(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((d: { providers?: OAuthProvider[] }) => {
        if (Array.isArray(d.providers)) setOauthProviders(d.providers);
        setOauthError(null);
      })
      .catch(() => setOauthError(t("models.accountsLoadFailed")));
  }, [t]);

  const loadApiKeyProviders = useCallback(() => {
    fetch("/api/auth/all-providers")
      .then((r) => r.json())
      .then((d: { providers?: ApiKeyProvider[] }) => {
        if (Array.isArray(d.providers)) setApiKeyProviders(d.providers);
        setApiKeyError(null);
      })
      .catch(() => setApiKeyError(t("models.accountsLoadFailed")));
  }, [t]);

  // A dual-auth provider moves between the two lists when its credential type
  // changes, so any auth change has to reload both — refreshing only one leaves
  // the provider rendered twice, and disconnecting the stale row would delete
  // the credential that was just created (#309).
  const refreshAuthProviders = useCallback(() => {
    loadOAuthProviders();
    loadApiKeyProviders();
  }, [loadOAuthProviders, loadApiKeyProviders]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setConfigError(null);
    try {
      const res = await fetch("/api/models-config");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as ModelsJson;
      const normalized = d.providers ? d : { ...d, providers: {} };
      setBaselineConfig(normalized);
      setConfig(normalized);
      setSelection((current) => {
        if (current) return resolveModelsSelection(current, normalized, oauthProviders, apiKeyProviders);
        const keys = Object.keys(normalized.providers ?? {});
        return keys.length > 0 ? { type: "provider", name: keys[0] } : null;
      });
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [oauthProviders, apiKeyProviders]);

  useEffect(() => {
    void loadConfig();
    refreshAuthProviders();
    // Initial load only; auth refresh handles later re-syncs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSelection((current) => {
      const next = resolveModelsSelection(current, configRef.current, oauthProviders, apiKeyProviders);
      if (!next) setMobileView("list");
      return next;
    });
  }, [oauthProviders, apiKeyProviders]);

  const addCustomProvider = useCallback(() => {
    let finalName = "new-provider";
    let n = 1;
    while (config.providers?.[finalName]) finalName = `new-provider-${n++}`;
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [finalName]: { api: "openai-completions" } } }));
    setSelection({ type: "provider", name: finalName });
  }, [config.providers]);

  const updateProvider = useCallback((name: string, p: ProviderEntry) => {
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [name]: p } }));
  }, []);

  const renameProvider = useCallback((oldName: string, newName: string) => {
    setConfig((prev) => {
      const entries = Object.entries(prev.providers ?? {});
      const idx = entries.findIndex(([k]) => k === oldName);
      if (idx === -1) return prev;
      entries[idx] = [newName, entries[idx][1]];
      return { ...prev, providers: Object.fromEntries(entries) };
    });
    setSelection((prev) => {
      if (!prev) return prev;
      if (prev.type === "provider" && prev.name === oldName) return { type: "provider", name: newName };
      if (prev.type === "model" && prev.providerName === oldName) return { ...prev, providerName: newName };
      return prev;
    });
  }, []);

  const deleteProvider = useCallback((name: string) => {
    setConfig((prev) => {
      if (!prev.providers?.[name]) return prev;
      const providers = { ...(prev.providers ?? {}) };
      delete providers[name];
      return { ...prev, providers };
    });
    setSelection((current) => {
      if (!current) return null;
      if (current.type === "provider" && current.name === name) {
        const remaining = Object.keys(config.providers ?? {}).filter((n) => n !== name);
        return remaining.length > 0 ? { type: "provider", name: remaining[0] } : null;
      }
      if (current.type === "model" && current.providerName === name) {
        const remaining = Object.keys(config.providers ?? {}).filter((n) => n !== name);
        return remaining.length > 0 ? { type: "provider", name: remaining[0] } : null;
      }
      return current;
    });
  }, [config.providers]);

  const addModel = useCallback((providerName: string) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? []), { id: "" }];
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
    setConfig((prev) => {
      const idx = (prev.providers?.[providerName]?.models?.length ?? 1) - 1;
      setSelection({ type: "model", providerName, index: idx });
      return prev;
    });
  }, []);

  const addDiscoveredModels = useCallback((providerName: string, discovered: DiscoveredModel[]) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      const existingIds = new Set(models.map((model) => model.id));
      for (const discoveredModel of discovered) {
        if (existingIds.has(discoveredModel.id)) continue;
        existingIds.add(discoveredModel.id);
        models.push({ id: discoveredModel.id, name: discoveredModel.name });
      }
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
  }, []);

  const updateModel = useCallback((providerName: string, index: number, m: ModelEntry) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models[index] = m;
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
  }, []);

  const removeModel = useCallback((providerName: string, index: number) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models.splice(index, 1);
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models: models.length ? models : undefined } } };
    });
    setSelection({ type: "provider", name: providerName });
  }, []);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      const res = await fetch("/api/models-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setSaveError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      // The server normalizes the document (base URLs, costs, blank model
      // rows), so reload it as the new baseline and draft to avoid a
      // false-clean UI that differs from disk.
      const res2 = await fetch("/api/models-config");
      if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
      const normalized = (await res2.json()) as ModelsJson;
      const next = applySavedModelsConfig(config, configRef.current, normalized);
      setBaselineConfig(normalized);
      setConfig(next);
      setSelection((current) => resolveModelsSelection(current, next, oauthProviders, apiKeyProviders));
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [config, saving, oauthProviders, apiKeyProviders]);

  const toggleProvider = useCallback((name: string) => {
    setExpandedProviders((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const handleSelect = useCallback((sel: Selection) => {
    setSelection(sel);
    if (isMobile) setMobileView("detail");
  }, [isMobile]);

  const handleAddModel = useCallback((providerName: string) => {
    addModel(providerName);
    if (isMobile) setMobileView("detail");
  }, [addModel, isMobile]);

  const handleAddCustom = useCallback(() => {
    addCustomProvider();
    if (isMobile) setMobileView("detail");
  }, [addCustomProvider, isMobile]);

  const requestDelete = useCallback((sel: Selection) => {
    setPendingDelete(sel);
  }, []);

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    if (pendingDelete.type === "provider") deleteProvider(pendingDelete.name);
    else if (pendingDelete.type === "model") removeModel(pendingDelete.providerName, pendingDelete.index);
    setPendingDelete(null);
  }, [pendingDelete, deleteProvider, removeModel]);

  // Draft protection: any unsaved custom edit blocks leaving Models, closing
  // Settings, and page reload until explicitly discarded.
  const dirty = isModelsConfigDirty(baselineConfig, config);

  const discard = useCallback(() => {
    if (!baselineConfig) {
      setConfig({ providers: {} });
      setSelection(null);
      setMobileView("list");
      setSaveError(null);
      return;
    }
    setConfig(baselineConfig);
    setSelection((current) => {
      const next = resolveModelsSelection(current, baselineConfig, oauthProviders, apiKeyProviders);
      if (!next) setMobileView("list");
      return next;
    });
    setSaveError(null);
  }, [baselineConfig, oauthProviders, apiKeyProviders]);

  const handleBack = useCallback(() => {
    if (pickerOpen) { setPickerOpen(false); return true; }
    if (pendingDelete) { setPendingDelete(null); return true; }
    if (isMobile && mobileView === "detail") { setMobileView("list"); return true; }
    return false;
  }, [pickerOpen, pendingDelete, isMobile, mobileView]);

  const controller = useMemo<ModelsDraftController>(() => ({
    dirty,
    discard,
    handleBack,
    mobileDetailOpen: isMobile && mobileView === "detail",
  }), [dirty, discard, handleBack, isMobile, mobileView]);

  useEffect(() => {
    onControllerChange(controller);
  }, [onControllerChange, controller]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const accountItems = useMemo<ModelsAccountItem[]>(() => {
    const seen = new Set<string>();
    const items: ModelsAccountItem[] = [];
    for (const p of oauthProviders) {
      if (!p.loggedIn || seen.has(p.id)) continue;
      seen.add(p.id);
      items.push({ kind: "oauth", id: p.id, name: p.name, connected: true, modelCount: 0 });
    }
    for (const p of apiKeyProviders) {
      if (!p.configured || seen.has(p.id)) continue;
      seen.add(p.id);
      items.push({ kind: "apikey", id: p.id, name: p.displayName, connected: true, modelCount: p.modelCount });
    }
    return items;
  }, [oauthProviders, apiKeyProviders]);

  const providerItems = useMemo<ModelsCustomProviderItem[]>(() =>
    Object.entries(config.providers ?? {}).map(([name, p]) => ({
      name,
      baseUrl: p.baseUrl,
      api: p.api,
      modelCount: p.models?.length ?? 0,
      models: (p.models ?? []).map((m, index) => ({ id: m.id, name: m.name, reasoning: m.reasoning, index })),
    })),
  [config.providers]);

  const filtered = useMemo(
    () => filterModelsNavigation({ accounts: accountItems, providers: providerItems, expandedProviders }, query),
    [accountItems, providerItems, expandedProviders, query],
  );

  // Resolve current detail
  const detailContent = (() => {
    if (!selection) return null;
    if (selection.type === "oauth") {
      const p = oauthProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return <OAuthDetail key={p.id} provider={p} onRefresh={refreshAuthProviders} />;
    }
    if (selection.type === "apikey") {
      const p = apiKeyProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return <ApiKeyDetail key={p.id} provider={p} onRefresh={refreshAuthProviders} />;
    }
    if (selection.type === "provider") {
      const provider = config.providers?.[selection.name];
      if (!provider) return null;
      return (
        <ProviderDetail
          key={selection.name}
          name={selection.name}
          provider={provider}
          onChange={(p) => updateProvider(selection.name, p)}
          onRename={(n) => renameProvider(selection.name, n)}
          onDelete={() => requestDelete({ type: "provider", name: selection.name })}
          onAddModels={(models) => addDiscoveredModels(selection.name, models)}
        />
      );
    }
    const provider = config.providers?.[selection.providerName];
    const model = provider?.models?.[selection.index];
    if (!model) return null;
    return (
      <ModelDetail
        key={`${selection.providerName}-${selection.index}`}
        providerName={selection.providerName}
        provider={provider}
        model={model}
        onChange={(m) => updateModel(selection.providerName, selection.index, m)}
        onDelete={() => requestDelete({ type: "model", providerName: selection.providerName, index: selection.index })}
      />
    );
  })();

  const selectionLabel = modelsSelectionLabel(selection, config, oauthProviders, apiKeyProviders);
  const pendingDeleteTitle = (() => {
    if (!pendingDelete) return "";
    const name = modelsSelectionLabel(pendingDelete, config, oauthProviders, apiKeyProviders).title;
    return pendingDelete.type === "provider"
      ? t("models.confirmDeleteProvider", { name })
      : t("models.confirmDeleteModel", { name });
  })();

  return (
    <div className="models-settings-page">
      <div className="models-settings-header">
        {isMobile && mobileView === "detail" ? (
          <>
            <button type="button" className="models-settings-back" onClick={() => setMobileView("list")} aria-label={t("i18n.back")} title={t("i18n.back")}>
              <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            <div className="models-settings-header-title">
              <span>{selectionLabel.title}</span>
              {selectionLabel.subtitle && <code>{selectionLabel.subtitle}</code>}
            </div>
          </>
        ) : (
          <div className="models-settings-header-title">
            <span>{t("common.models")}</span>
            <code>~/.pi/agent/models.json</code>
          </div>
        )}
        <div className="models-settings-header-actions">
          {saveError && <span className="models-settings-save-error" role="alert">{saveError}</span>}
          <button
            type="button"
            className="models-settings-save"
            disabled={!dirty || saving || savedOk}
            onClick={handleSave}
          >
            {savedOk && <CheckIcon size={14} strokeWidth={3} aria-hidden="true" />}
            <span>{savedOk ? t("i18n.saved") : saving ? t("i18n.saving") : t("i18n.save")}</span>
          </button>
        </div>
      </div>

      <div className="models-settings-layout" data-mobile-view={isMobile ? mobileView : undefined}>
        <ModelsConfigNavigator
          selection={selection}
          query={query}
          expandedProviders={filtered.expandedProviders}
          accounts={filtered.accounts}
          providers={filtered.providers}
          loading={loading}
          errors={{ accounts: oauthError ?? apiKeyError ?? undefined, config: configError ?? undefined }}
          onQueryChange={setQuery}
          onToggleProvider={toggleProvider}
          onSelect={handleSelect}
          onAddProvider={() => setPickerOpen(true)}
          onAddModel={handleAddModel}
          onRetryAccounts={refreshAuthProviders}
          onRetryConfig={() => { if (!dirty) void loadConfig(); }}
        />
        <div className="models-settings-detail">
          {loading ? null : detailContent ?? (
            <div className="models-settings-detail-empty">
              {t("i18n.selectProviderModel")}
            </div>
          )}
        </div>
      </div>

      {pickerOpen && (
        <AddProviderPicker
          oauthProviders={oauthProviders}
          apiKeyProviders={apiKeyProviders}
          mobile={isMobile}
          onSelectOAuth={(id) => handleSelect({ type: "oauth", providerId: id })}
          onSelectApiKey={(id) => handleSelect({ type: "apikey", providerId: id })}
          onAddCustom={handleAddCustom}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {pendingDelete && (
        <DialogShell
          size="confirm"
          title={pendingDeleteTitle}
          ariaLabel={t("i18n.cancel")}
          onClose={() => setPendingDelete(null)}
          backdropDismissible={false}
          footer={(
            <>
              <button type="button" className="codex-dialog-button" onClick={() => setPendingDelete(null)}>{t("i18n.cancel")}</button>
              <button type="button" className="codex-dialog-button" data-variant="danger" onClick={confirmDelete}>{t("i18n.delete")}</button>
            </>
          )}
        >
          <p className="codex-dialog-copy">{t("models.deleteDraftNote")}</p>
        </DialogShell>
      )}
    </div>
  );
}
