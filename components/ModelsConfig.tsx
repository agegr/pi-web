"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
// Color icons (have their own fill colors — no background needed)
import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import GoogleColorIcon from "@lobehub/icons/es/Google/components/Color";
import DeepSeekColorIcon from "@lobehub/icons/es/DeepSeek/components/Color";
import GroqIcon from "@lobehub/icons/es/Groq/components/Mono";
import MistralColorIcon from "@lobehub/icons/es/Mistral/components/Color";
import MoonshotIcon from "@lobehub/icons/es/Moonshot/components/Mono";
import MinimaxColorIcon from "@lobehub/icons/es/Minimax/components/Color";
import FireworksColorIcon from "@lobehub/icons/es/Fireworks/components/Color";
import HuggingFaceColorIcon from "@lobehub/icons/es/HuggingFace/components/Color";
import CerebrasColorIcon from "@lobehub/icons/es/Cerebras/components/Color";
import OpenRouterIcon from "@lobehub/icons/es/OpenRouter/components/Mono";
import XAIIcon from "@lobehub/icons/es/XAI/components/Mono";
import CloudflareColorIcon from "@lobehub/icons/es/Cloudflare/components/Color";
import VercelIcon from "@lobehub/icons/es/Vercel/components/Mono";
import GithubCopilotIcon from "@lobehub/icons/es/GithubCopilot/components/Mono";
import AwsColorIcon from "@lobehub/icons/es/Aws/components/Color";
import AzureColorIcon from "@lobehub/icons/es/Azure/components/Color";
import KimiColorIcon from "@lobehub/icons/es/Kimi/components/Color";
import QwenColorIcon from "@lobehub/icons/es/Qwen/components/Color";
import ZhipuColorIcon from "@lobehub/icons/es/Zhipu/components/Color";
import CohereColorIcon from "@lobehub/icons/es/Cohere/components/Color";
import PerplexityColorIcon from "@lobehub/icons/es/Perplexity/components/Color";
import TogetherColorIcon from "@lobehub/icons/es/Together/components/Color";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import AntGroupColorIcon from "@lobehub/icons/es/AntGroup/components/Color";
import NvidiaColorIcon from "@lobehub/icons/es/Nvidia/components/Color";
import OpenCodeIcon from "@lobehub/icons/es/OpenCode/components/Mono";
import XiaomiMiMoIcon from "@lobehub/icons/es/XiaomiMiMo/components/Mono";
import ZAIIcon from "@lobehub/icons/es/ZAI/components/Mono";

type IconComponent = React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;

// hasColor=true → Color icon (self-colored SVG, no wrapper)
// hasColor=false → Mono icon (rendered with currentColor, inherits theme text color)
const PROVIDER_ICONS: Record<string, { Icon: IconComponent; hasColor: boolean }> = {
  "anthropic":              { Icon: AnthropicIcon,        hasColor: false },
  "openai":                 { Icon: OpenAIIcon,           hasColor: false },
  "openai-codex":           { Icon: OpenAIIcon,           hasColor: false },
  "google":                 { Icon: GoogleColorIcon,      hasColor: true },
  "google-vertex":          { Icon: GoogleColorIcon,      hasColor: true },
  "ant-ling":               { Icon: AntGroupColorIcon,    hasColor: true },
  "deepseek":               { Icon: DeepSeekColorIcon,    hasColor: true },
  "groq":                   { Icon: GroqIcon,             hasColor: false },
  "mistral":                { Icon: MistralColorIcon,     hasColor: true },
  "moonshotai":             { Icon: MoonshotIcon,         hasColor: false },
  "moonshotai-cn":          { Icon: MoonshotIcon,         hasColor: false },
  "moonshot":               { Icon: MoonshotIcon,         hasColor: false },
  "minimax":                { Icon: MinimaxColorIcon,     hasColor: true },
  "minimax-cn":             { Icon: MinimaxColorIcon,     hasColor: true },
  "fireworks":              { Icon: FireworksColorIcon,   hasColor: true },
  "huggingface":            { Icon: HuggingFaceColorIcon, hasColor: true },
  "cerebras":               { Icon: CerebrasColorIcon,    hasColor: true },
  "openrouter":             { Icon: OpenRouterIcon,       hasColor: false },
  "xai":                    { Icon: XAIIcon,              hasColor: false },
  "cloudflare-ai-gateway":  { Icon: CloudflareColorIcon,  hasColor: true },
  "cloudflare-workers-ai":  { Icon: CloudflareColorIcon,  hasColor: true },
  "vercel-ai-gateway":      { Icon: VercelIcon,           hasColor: false },
  "github-copilot":         { Icon: GithubCopilotIcon,    hasColor: false },
  "amazon-bedrock":         { Icon: AwsColorIcon,         hasColor: true },
  "azure-openai-responses": { Icon: AzureColorIcon,       hasColor: true },
  "kimi-coding":            { Icon: KimiColorIcon,        hasColor: true },
  "nvidia":                 { Icon: NvidiaColorIcon,      hasColor: true },
  "opencode":               { Icon: OpenCodeIcon,         hasColor: false },
  "opencode-go":            { Icon: OpenCodeIcon,         hasColor: false },
  "qwen":                   { Icon: QwenColorIcon,        hasColor: true },
  "xiaomi":                 { Icon: XiaomiMiMoIcon,       hasColor: false },
  "xiaomi-token-plan-ams":  { Icon: XiaomiMiMoIcon,       hasColor: false },
  "xiaomi-token-plan-cn":   { Icon: XiaomiMiMoIcon,       hasColor: false },
  "xiaomi-token-plan-sgp":  { Icon: XiaomiMiMoIcon,       hasColor: false },
  "zai":                    { Icon: ZAIIcon,              hasColor: false },
  "zai-coding-cn":          { Icon: ZAIIcon,              hasColor: false },
  "zhipu":                  { Icon: ZhipuColorIcon,       hasColor: true },
  "cohere":                 { Icon: CohereColorIcon,      hasColor: true },
  "perplexity":             { Icon: PerplexityColorIcon,  hasColor: true },
  "together":               { Icon: TogetherColorIcon,    hasColor: true },
  "grok":                   { Icon: GrokIcon,             hasColor: false },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface OAuthProvider {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
  /** Provider also accepts an API key, so it appears in both picker sections. */
  supportsApiKey?: boolean;
}

interface ApiKeyProvider {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  /** Provider also supports OAuth, so it appears in both picker sections. */
  supportsOAuth?: boolean;
}

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

interface ModelEntry {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; tiers?: unknown };
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
}

interface ProviderEntry {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  models?: ModelEntry[];
  modelOverrides?: Record<string, unknown>;
}

interface ModelsJson {
  providers?: Record<string, ProviderEntry>;
}

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

type Selection =
  | { type: "provider"; name: string }
  | { type: "model"; providerName: string; index: number }
  | { type: "oauth"; providerId: string }
  | { type: "apikey"; providerId: string };

const API_OPTIONS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const;

// ── Form field helpers ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>{label}</label>
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
  fontSize: 12,
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
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12a18.45 18.45 0 0 1 5.06-6.94" />
            <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
            <path d="M1 1l22 22" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
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
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 13, height: 13, accentColor: "var(--accent)", cursor: "pointer" }} />
      {label}
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{children}</div>;
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
        <button onClick={onDelete}
          style={{ padding: "3px 8px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: "#ef4444", cursor: "pointer", fontSize: 11 }}>
           {t("i18n.delete")}
        </button>
      </div>

       <Field label={t("i18n.providerName")}>
        <TextInput value={editingName} onChange={setEditingName} placeholder="provider-name" mono />
        {editingName !== name && editingName.trim() && (
          <button onClick={() => onRename(editingName.trim())}
            style={{ marginTop: 4, padding: "3px 10px", background: "var(--accent)", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 11, alignSelf: "flex-start" }}>
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
        <span style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
          Prefix with <code style={{ fontFamily: "var(--font-mono)" }}>!</code> to run a shell command, or use an env var name
        </span>
      </Field>

      <Field label="API">
        <Select value={provider.api ?? "openai-completions"} onChange={(v) => set("api", v)} options={API_OPTIONS} required />
      </Field>

      <Field label="Headers">
        <HeaderListEditor
          headers={provider.headers}
          onChange={(headers) => set("headers", headers)}
        />
        <span style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
          Added to every request from this provider (e.g. User-Agent). Useful for gateways with bot detection.
        </span>
      </Field>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {discoveryState.phase !== "success" && (
          <button
            onClick={handleDiscoverModels}
            disabled={!provider.baseUrl?.trim() || discoveryState.phase === "loading"}
            style={{
              alignSelf: "flex-start", height: 30, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 5,
              background: "var(--bg-panel)", color: !provider.baseUrl?.trim() || discoveryState.phase === "loading" ? "var(--text-dim)" : "var(--text-muted)",
              cursor: !provider.baseUrl?.trim() || discoveryState.phase === "loading" ? "not-allowed" : "pointer", fontSize: 11,
            }}
          >
            {discoveryState.phase === "loading" ? t("models.discoveryFetching") : t("models.discoveryFetch")}
          </button>
        )}

        {discoveryState.phase === "error" && (
          <div style={{ padding: "7px 9px", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 5, color: "#ef4444", fontSize: 11, lineHeight: 1.4 }}>
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
                  color: "var(--text-muted)", fontSize: 10, fontWeight: 600,
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
                <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 11 }}>{t("models.discoveryNoMatches")}</div>
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
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: 11 }}>{model.name ?? model.id}</span>
                      {model.name && <code style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)" }}>{model.id}</code>}
                    </span>
                    {alreadyAdded && <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{t("models.discoveryAdded")}</span>}
                  </label>
                );
              })}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span title={discoveryState.endpoint} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 10 }}>
                {filteredDiscoveredModels.length > shownDiscoveredModels.length
                  ? t("models.discoveryShowing", { shown: shownDiscoveredModels.length, total: filteredDiscoveredModels.length })
                  : t("models.discoveryFetched", { count: discoveryState.models.length })}
              </span>
              <button
                onClick={addSelectedModels}
                disabled={selectedCount === 0}
                style={{ height: 28, padding: "0 11px", border: "none", borderRadius: 5, background: selectedCount ? "var(--accent)" : "var(--bg-panel)", color: selectedCount ? "#fff" : "var(--text-dim)", cursor: selectedCount ? "pointer" : "not-allowed", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}
              >
                {selectedCount
                  ? t("models.discoveryAddSelectedCount", { count: selectedCount })
                  : t("models.discoveryAddSelected")}
              </button>
            </div>
          </>
        )}
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
          fontSize: 10,
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
                fontSize: 11,
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
                  fontSize: 11,
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
    fontSize: 11,
    lineHeight: 1,
  } satisfies React.CSSProperties;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((row) => (
        <div key={row.id} style={{ display: "flex", gap: 6 }}>
          <input value={row.name} onChange={(e) => setEntry(row.id, { name: e.target.value })}
            placeholder="Header-Name" style={{ ...inputStyle, fontFamily: "var(--font-mono)", flex: 1 }} />
          <input value={row.value} onChange={(e) => setEntry(row.id, { value: e.target.value })}
            placeholder="value" style={{ ...inputStyle, fontFamily: "var(--font-mono)", flex: 1 }} />
          <button onClick={() => removeEntry(row.id)} style={rowBtnStyle}>✕</button>
        </div>
      ))}
      <button onClick={() => setRows((current) => [
        ...current,
        { id: nextRowIdRef.current++, name: "", value: "" },
      ])}
        style={{ padding: "5px 9px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer", fontSize: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, alignSelf: "flex-start" }}>
        + Add header
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
                fontSize: 11,
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
              fontSize: 11,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
              gap: 5,
            }}
          >
            {testState.phase === "success" && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
             {testState.phase === "testing" ? t("i18n.checking") : testState.phase === "success" ? t("common.ok") : t("i18n.test")}
          </button>
          <button onClick={onDelete}
            style={{ height: 24, padding: "0 8px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: "#ef4444", cursor: "pointer", fontSize: 11, boxSizing: "border-box" }}>
             {t("i18n.remove")}
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
              fontSize: 11,
            }}
          >
            {catalogState.phase === "loading" ? t("models.catalogFilling") : t("models.catalogFill")}
          </button>
          <a
            href="https://github.com/anomalyco/models.dev"
            target="_blank"
            rel="noreferrer"
            style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10, textDecoration: "none" }}
          >
            {t("models.catalogSource")}
          </a>
        </div>

        {catalogStatusText && (
          <div
            aria-live="polite"
            style={{
              marginTop: 8, display: "flex", alignItems: "center",
              justifyContent: "space-between", gap: 8, color: catalogStatusColor, fontSize: 10,
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
                style={{ flexShrink: 0, padding: "0 2px", border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontSize: 10 }}
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
            style={{ padding: "2px 4px", border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer", fontSize: 10 }}
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
          <div style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 600, textTransform: "uppercase" }}>
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
                <div aria-live="polite" style={{ gridColumn: "1 / -1", color: "#d97706", fontSize: 10 }}>
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
                    <div style={{ fontSize: 10, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
                    <div style={{ marginTop: 3, color: missing ? "var(--text-dim)" : "var(--text)", fontSize: 12, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
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
            <span style={{ display: "block", fontSize: 11, fontWeight: 600 }}>{t("models.advancedSettings")}</span>
            <span style={{ display: "block", marginTop: 3, color: "var(--text-dim)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {advancedSummary}
            </span>
          </span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ color: "var(--text-dim)", transform: advancedOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
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
              <span style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
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
                        style={{ fontSize: 10, padding: "2px 5px", background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer" }}
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
          <span style={{ fontSize: 11, color: provider.loggedIn ? "#4ade80" : "var(--text-dim)" }}>
             {provider.loggedIn ? t("i18n.connected") : t("i18n.notConnected")}
          </span>
        </div>
      </div>

      {/* Status */}
      <div style={{ minHeight: 48 }}>
        {loginState.phase === "idle" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
             {provider.loggedIn ? "Already connected. You can re-login or disconnect." : `Connect your ${provider.name} account.`}
          </p>
        )}
        {loginState.phase === "connecting" && (
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{t("i18n.openingBrowser")}</p>
        )}
        {loginState.phase === "select" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {loginState.message}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {loginState.options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => submitSelection(loginState.token, option.id)}
                  style={{ padding: "6px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", cursor: "pointer", fontSize: 12, textAlign: "left" }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {(loginState.phase === "auth" || loginState.phase === "prompt") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {loginState.phase === "auth"
                ? "Complete sign-in in the browser, then copy the redirect URL from the address bar and paste it below."
                : loginState.message}
            </p>
            {loginState.phase === "auth" && (
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
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
                style={{ flex: 1, padding: "6px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontSize: 12, outline: "none", fontFamily: "var(--font-mono)", boxSizing: "border-box" }}
              />
              <button
                onClick={() => submitCode(loginState.token, inputValue)}
                disabled={!inputValue.trim()}
                style={{ padding: "6px 12px", background: inputValue.trim() ? "var(--accent)" : "var(--bg-panel)", border: "none", borderRadius: 5, color: inputValue.trim() ? "#fff" : "var(--text-dim)", cursor: inputValue.trim() ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 600, flexShrink: 0 }}
              >
                 {t("i18n.submit")}
              </button>
            </div>
          </div>
        )}
        {loginState.phase === "device_code" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Open the verification page and enter this code:
            </p>
            <div style={{ padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontSize: 16, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: 0 }}>
              {loginState.userCode}
            </div>
            <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
              <a href={loginState.verificationUri} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
                {loginState.verificationUri}
              </a>
              {loginState.expiresInSeconds ? ` Expires in ${Math.ceil(loginState.expiresInSeconds / 60)} minutes.` : ""}
            </p>
          </div>
        )}
        {loginState.phase === "progress" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{loginState.message}</p>
        )}
        {loginState.phase === "success" && (
             <p style={{ margin: 0, fontSize: 12, color: "#4ade80" }}>{t("i18n.connectedSuccessfully")}</p>
        )}
        {loginState.phase === "error" && (
          <p style={{ margin: 0, fontSize: 12, color: "#f87171" }}>{loginState.message}</p>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        {isWorking ? (
          <button
            onClick={() => { eventSourceRef.current?.close(); setLoginState({ phase: "idle" }); }}
            style={{ padding: "5px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
          >
             {t("i18n.cancel")}
          </button>
        ) : (
          <>
            <button
              onClick={handleLogin}
              style={{ padding: "5px 14px", background: "var(--accent)", border: "none", borderRadius: 5, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
            >
               {provider.loggedIn ? t("i18n.relogin") : t("i18n.login")}
            </button>
            {provider.loggedIn && (
              <button
                onClick={handleLogout}
                style={{ padding: "5px 12px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 5, color: "#ef4444", cursor: "pointer", fontSize: 12 }}
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
          <span style={{ fontSize: 11, color: provider.configured ? "#4ade80" : "var(--text-dim)" }}>
             {provider.configured ? t("i18n.configured") : t("i18n.notConfigured")}
          </span>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
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
              fontSize: 12, fontWeight: 600, flexShrink: 0,
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            {savedOk && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
             {savedOk ? t("i18n.saved") : saving ? t("i18n.saving") : t("i18n.save")}
          </button>
        </div>
      </Field>

      {error && <p style={{ margin: 0, fontSize: 12, color: "#f87171" }}>{error}</p>}

      {provider.configured && (
        <button
          onClick={handleRemove}
          disabled={removing}
          style={{
            alignSelf: "flex-start", padding: "5px 12px",
            background: "none", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 5, color: "#ef4444",
            cursor: removing ? "not-allowed" : "pointer", fontSize: 12,
          }}
        >
           {removing ? t("i18n.removing") : t("i18n.disconnect")}
        </button>
      )}
    </div>
  );
}

// ── Provider icon ─────────────────────────────────────────────────────────────

function ProviderIcon({ id, size }: { id: string; size: number }) {
  const pi = PROVIDER_ICONS[id];
  if (!pi) {
    const label = id
      .split(/[-_]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?";
    return (
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          border: "1px solid var(--border)",
          borderRadius: 4,
          color: "var(--text-dim)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontSize: Math.max(8, Math.floor(size * 0.42)),
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {label}
      </span>
    );
  }
  // Color icons: self-colored SVG, no wrapper needed
  if (pi.hasColor) return <pi.Icon size={size} />;
  // Mono icons: use currentColor so they adapt to light/dark theme
  return <pi.Icon size={size} style={{ color: "var(--text-muted)" }} />;
}

// ── Add provider picker ───────────────────────────────────────────────────────

interface AddProviderPickerProps {
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  onSelectOAuth: (id: string) => void;
  onSelectApiKey: (id: string) => void;
  onAddCustom: () => void;
  onClose: () => void;
}

function AddProviderPicker({
  oauthProviders, apiKeyProviders,
  onSelectOAuth, onSelectApiKey, onAddCustom, onClose,
}: AddProviderPickerProps) {
  const [search, setSearch] = useState("");
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);

  const q = search.trim().toLowerCase();

  const availableOAuth = oauthProviders.filter((p) => !p.loggedIn && (!q || p.name.toLowerCase().includes(q)));
  const availableApiKey = apiKeyProviders.filter((p) => !p.configured && (!q || p.displayName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)));
  const showCustom = !q || "custom".includes(q) || "openai-compatible".includes(q) || "anthropic-compatible".includes(q);

  const totalCount = availableOAuth.length + availableApiKey.length + (showCustom ? 1 : 0);

  const cardStyle: React.CSSProperties = {
    display: "flex", flexDirection: "row", alignItems: "center", gap: 8,
    padding: "10px 12px",
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    boxSizing: "border-box",
    cursor: "pointer",
    minWidth: 0,
    textAlign: "left",
    transition: "border-color 0.12s, background 0.12s",
    width: "100%",
  };



  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: 820, maxWidth: "calc(100vw - 32px)", maxHeight: "min(72vh, calc(100vh - 32px))", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.22)", overflow: "hidden" }}>
        {/* Search */}
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)", flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
             placeholder={t("i18n.searchProviders")}
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }}
          />
        </div>

        {/* Card grid */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {totalCount === 0 ? (
            <div style={{ padding: "20px 0", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>{t("i18n.noProviders")}</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 8 }}>
              {showCustom && (
                 <div style={{ gridColumn: "1 / -1", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("i18n.custom")}</div>
              )}
              {showCustom && (
                <button
                  onClick={() => { onAddCustom(); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>OpenAI / Anthropic compatible</div>
                     <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{t("i18n.customEndpoint")}</div>
                  </div>
                  <span style={{ width: 26, height: 26, borderRadius: 5, background: "var(--bg-hover)", border: "1px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)" }}>
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </span>
                </button>
              )}

              {availableOAuth.length > 0 && (
                 <div style={{ gridColumn: "1 / -1", paddingTop: showCustom ? 6 : 0, fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("i18n.subscriptions")}</div>
              )}
              {availableOAuth.map((p) => (
                <button key={p.id} onClick={() => { onSelectOAuth(p.id); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>OAuth</div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

              {availableApiKey.length > 0 && (
                <div style={{ gridColumn: "1 / -1", paddingTop: availableOAuth.length > 0 ? 6 : 0, fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>API Key</div>
              )}
              {availableApiKey.map((p) => (
                <button key={p.id} onClick={() => { onSelectApiKey(p.id); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.displayName}</div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{p.modelCount} models</div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ModelsConfig({ onClose }: { onClose: () => void }) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [config, setConfig] = useState<ModelsJson>({ providers: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const loadOAuthProviders = useCallback(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((d: { providers?: OAuthProvider[] }) => {
        if (Array.isArray(d.providers)) setOauthProviders(d.providers);
      })
      .catch(() => {});
  }, []);

  const loadApiKeyProviders = useCallback(() => {
    fetch("/api/auth/all-providers")
      .then((r) => r.json())
      .then((d: { providers?: ApiKeyProvider[] }) => {
        if (Array.isArray(d.providers)) setApiKeyProviders(d.providers);
      })
      .catch(() => {});
  }, []);

  // A dual-auth provider moves between the two lists when its credential type
  // changes, so any auth change has to reload both — refreshing only one leaves
  // the provider rendered twice, and disconnecting the stale row would delete
  // the credential that was just created (#309).
  const refreshAuthProviders = useCallback(() => {
    loadOAuthProviders();
    loadApiKeyProviders();
  }, [loadOAuthProviders, loadApiKeyProviders]);

  useEffect(() => {
    fetch("/api/models-config")
      .then((r) => r.json())
      .then((d: ModelsJson) => {
        const normalized = d.providers ? d : { ...d, providers: {} };
        setConfig(normalized);
        const keys = Object.keys(normalized.providers ?? {});
        if (keys.length > 0) setSelection({ type: "provider", name: keys[0] });
      })
      .catch(() => setConfig({ providers: {} }))
      .finally(() => setLoading(false));
    refreshAuthProviders();
  }, [refreshAuthProviders]);

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
      const providers = { ...(prev.providers ?? {}) };
      delete providers[name];
      return { ...prev, providers };
    });
    setConfig((prev) => {
      const remaining = Object.keys(prev.providers ?? {});
      setSelection(remaining.length > 0 ? { type: "provider", name: remaining[0] } : null);
      return prev;
    });
  }, []);

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
      if (!res.ok || d.error) setSaveError(d.error ?? `HTTP ${res.status}`);
      else { setSavedOk(true); setTimeout(() => setSavedOk(false), 2000); }
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [config]);

  const providers = Object.entries(config.providers ?? {});
  const activeOAuth = oauthProviders.filter((p) => p.loggedIn);
  const activeApiKey = apiKeyProviders.filter((p) => p.configured);

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
          onDelete={() => deleteProvider(selection.name)}
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
        onDelete={() => removeModel(selection.providerName, selection.index)}
      />
    );
  })();

  return (
    <>
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: isMobile ? "calc(100vw - 16px)" : 860, maxWidth: "calc(100vw - 16px)", height: isMobile ? "calc(100dvh - 16px)" : "78vh", maxHeight: "calc(100dvh - 16px)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
             <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("common.models")}</span>
            <code style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>~/.pi/agent/models.json</code>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>

          {/* Left: tree */}
          <div style={{
            width: isMobile ? "100%" : 210,
            maxHeight: isMobile ? "40vh" : undefined,
            borderRight: isMobile ? "none" : "1px solid var(--border)",
            borderBottom: isMobile ? "1px solid var(--border)" : "none",
            display: "flex", flexDirection: "column", flexShrink: 0, background: "var(--bg-panel)",
          }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
              {/* Active OAuth subscriptions */}
              {activeOAuth.map((p) => {
                const isSelected = selection?.type === "oauth" && selection.providerId === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelection({ type: "oauth", providerId: p.id })}
                    style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 5, cursor: "pointer", background: isSelected ? "var(--bg-selected)" : "none" }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "none"; }}
                  >
                    <ProviderIcon id={p.id} size={16} />
                    <span style={{ fontSize: 12, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  </div>
                );
              })}

              {/* Active API key providers */}
              {activeApiKey.map((p) => {
                const isSelected = selection?.type === "apikey" && selection.providerId === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelection({ type: "apikey", providerId: p.id })}
                    style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 5, cursor: "pointer", background: isSelected ? "var(--bg-selected)" : "none" }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "none"; }}
                  >
                    <ProviderIcon id={p.id} size={16} />
                    <span style={{ fontSize: 12, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.displayName}</span>
                  </div>
                );
              })}

              {/* Divider before custom providers, only when there are active managed providers */}
              {(activeOAuth.length > 0 || activeApiKey.length > 0) && providers.length > 0 && (
                <div style={{ margin: "4px 8px", borderTop: "1px solid var(--border)" }} />
              )}

              {/* Custom providers */}
              {loading ? (
                 <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-muted)" }}>{t("i18n.loading")}</div>
              ) : providers.map(([pName, pData]) => {
                const isProviderSelected = selection?.type === "provider" && selection.name === pName;
                const models = pData.models ?? [];
                return (
                  <div key={pName} style={{ marginBottom: 2 }}>
                    {/* Provider row */}
                    <div
                      onClick={() => setSelection({ type: "provider", name: pName })}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 8px", borderRadius: 5, cursor: "pointer", background: isProviderSelected ? "var(--bg-selected)" : "none" }}
                      onMouseEnter={(e) => { if (!isProviderSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { if (!isProviderSelected) e.currentTarget.style.background = "none"; }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)", flexShrink: 0 }}>
                        <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
                        <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
                        <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
                        <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
                        <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
                      </svg>
                      <span style={{ fontSize: 12, fontWeight: isProviderSelected ? 600 : 400, color: "var(--text)", fontFamily: "var(--font-mono)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {pName}
                      </span>
                    </div>

                    {/* Model rows */}
                    {models.map((m, i) => {
                      const isModelSelected = selection?.type === "model" && selection.providerName === pName && selection.index === i;
                      return (
                        <div
                          key={i}
                          onClick={() => setSelection({ type: "model", providerName: pName, index: i })}
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px 5px 26px", borderRadius: 5, cursor: "pointer", background: isModelSelected ? "var(--bg-selected)" : "none" }}
                          onMouseEnter={(e) => { if (!isModelSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { if (!isModelSelected) e.currentTarget.style.background = "none"; }}
                        >
                          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: m.id ? "var(--text-muted)" : "var(--text-dim)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                             {m.id || t("i18n.newModel")}
                          </span>
                          {m.reasoning && (
                            <span style={{ fontSize: 9, padding: "1px 4px", background: "rgba(99,102,241,0.12)", color: "rgba(99,102,241,0.8)", borderRadius: 3, flexShrink: 0 }}>T</span>
                          )}
                        </div>
                      );
                    })}

                    {/* Add model button */}
                    <div
                      onClick={(e) => { e.stopPropagation(); addModel(pName); }}
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px 4px 26px", borderRadius: 5, cursor: "pointer", color: "var(--text-dim)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                    >
                       <span style={{ fontSize: 11 }}>+ {t("i18n.model")}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add provider */}
            <div style={{ borderTop: "1px solid var(--border)", padding: "8px 6px" }}>
              <button onClick={() => setPickerOpen(true)} style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                width: "100%", padding: "6px 0", background: "none", border: "1px dashed var(--border)", borderRadius: 5,
                color: "var(--text-muted)", cursor: "pointer", fontSize: 12,
              }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
              >
                 + {t("i18n.addProvider")}
              </button>
            </div>
          </div>

          {/* Right: detail */}
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {loading ? null : detailContent ?? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 13 }}>
                 {t("i18n.selectProviderModel")}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "10px 18px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          {saveError && <span style={{ fontSize: 12, color: "#f87171", flex: 1 }}>{saveError}</span>}
          <button onClick={onClose} style={{ padding: "6px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>
             {t("i18n.cancel")}
          </button>
          <button onClick={handleSave} disabled={saving || savedOk} style={{
            position: "relative",
            padding: "6px 16px",
            minWidth: 92,
            background: savedOk ? "#16a34a" : saving ? "var(--bg-panel)" : "var(--accent)",
            border: "none", borderRadius: 6,
            color: savedOk ? "#fff" : saving ? "var(--text-muted)" : "#fff",
            cursor: (saving || savedOk) ? "default" : "pointer", fontSize: 13, fontWeight: 600,
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            transition: "background-color 0.2s ease, color 0.2s ease",
            animation: savedOk ? "saved-pop 0.45s ease" : undefined,
          }}>
            {savedOk && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                style={{ strokeDasharray: 18, animation: "saved-check-draw 0.35s ease forwards", flexShrink: 0 }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
             <span>{savedOk ? t("i18n.saved") : saving ? t("i18n.saving") : t("i18n.save")}</span>
          </button>
        </div>
      </div>
    </div>
    {pickerOpen && (
      <AddProviderPicker
        oauthProviders={oauthProviders}
        apiKeyProviders={apiKeyProviders}
        onSelectOAuth={(id) => setSelection({ type: "oauth", providerId: id })}
        onSelectApiKey={(id) => setSelection({ type: "apikey", providerId: id })}
        onAddCustom={addCustomProvider}
        onClose={() => setPickerOpen(false)}
      />
    )}
    </>
  );
}
