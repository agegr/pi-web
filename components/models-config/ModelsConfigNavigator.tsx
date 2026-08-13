"use client";

import { ChevronDown, Cpu, Plus, Search, X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import type { ModelsAccountItem, ModelsCustomProviderItem, Selection } from "./models-config-types";

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

export function ProviderIcon({ id, size }: { id: string; size: number }) {
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

export interface ModelsConfigNavigatorProps {
  selection: Selection | null;
  query: string;
  expandedProviders: ReadonlySet<string>;
  accounts: ModelsAccountItem[];
  providers: ModelsCustomProviderItem[];
  loading: boolean;
  errors: { accounts?: string; config?: string };
  onQueryChange(query: string): void;
  onToggleProvider(name: string): void;
  onSelect(selection: Selection): void;
  onAddProvider(): void;
  onAddModel(providerName: string): void;
  onRetryAccounts(): void;
  onRetryConfig(): void;
}

export function ModelsConfigNavigator({
  selection,
  query,
  expandedProviders,
  accounts,
  providers,
  loading,
  errors,
  onQueryChange,
  onToggleProvider,
  onSelect,
  onAddProvider,
  onAddModel,
  onRetryAccounts,
  onRetryConfig,
}: ModelsConfigNavigatorProps) {
  const { t } = useI18n();
  const noResults = !loading && !errors.config && accounts.length === 0 && providers.length === 0;

  return (
    <div className="models-settings-navigator">
      <div className="models-settings-search">
        <Search size={13} strokeWidth={2} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("models.searchPlaceholder")}
          aria-label={t("models.searchPlaceholder")}
          type="search"
        />
        {query && (
          <button type="button" onClick={() => onQueryChange("")} aria-label={t("i18n.clearSearch")} title={t("i18n.clearSearch")}>
            <X size={12} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="models-settings-navigator-scroll">
        {errors.accounts && (
          <div className="models-settings-nav-error" role="alert">
            <span>{errors.accounts}</span>
            <button type="button" onClick={onRetryAccounts}>{t("i18n.refresh")}</button>
          </div>
        )}
        {errors.config && (
          <div className="models-settings-nav-error" role="alert">
            <span>{errors.config}</span>
            <button type="button" onClick={onRetryConfig}>{t("i18n.refresh")}</button>
          </div>
        )}
        {loading ? (
          <div className="models-settings-nav-status">{t("i18n.loading")}</div>
        ) : noResults ? (
          <div className="models-settings-nav-status">
            <span>{t("models.noMatches")}</span>
            <button type="button" onClick={onAddProvider}>{t("i18n.addProvider")}</button>
          </div>
        ) : (
          <>
            {accounts.length > 0 && (
              <div className="models-settings-group" role="group" aria-label={t("models.accounts")}>
                <div className="models-settings-group-label">{t("models.accounts")}</div>
                {accounts.map((account) => {
                  const isSelected = (selection?.type === "oauth" || selection?.type === "apikey")
                    && selection.providerId === account.id;
                  return (
                    <button
                      key={account.id}
                      type="button"
                      className="models-settings-row"
                      data-selected={isSelected ? "true" : undefined}
                      onClick={() => onSelect(account.kind === "oauth"
                        ? { type: "oauth", providerId: account.id }
                        : { type: "apikey", providerId: account.id })}
                    >
                      <ProviderIcon id={account.id} size={16} />
                      <span className="models-settings-row-label">{account.name}</span>
                      <span className="models-settings-row-status" data-connected={account.connected ? "true" : undefined}>
                        {account.connected ? t("i18n.connected") : t("i18n.notConnected")}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {providers.length > 0 && (
              <div className="models-settings-group" role="group" aria-label={t("models.customProviders")}>
                <div className="models-settings-group-label">{t("models.customProviders")}</div>
                {providers.map((provider) => {
                  const expanded = expandedProviders.has(provider.name);
                  const isProviderSelected = selection?.type === "provider" && selection.name === provider.name;
                  return (
                    <div key={provider.name} className="models-settings-provider">
                      <div className="models-settings-provider-row">
                        <button
                          type="button"
                          className="models-settings-disclosure"
                          aria-expanded={expanded}
                          aria-controls={`models-provider-models-${provider.name}`}
                          onClick={() => onToggleProvider(provider.name)}
                          title={expanded ? t("i18n.hideDetails") : t("i18n.showDetails")}
                        >
                          <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="models-settings-row"
                          data-selected={isProviderSelected ? "true" : undefined}
                          onClick={() => onSelect({ type: "provider", name: provider.name })}
                        >
                          <Cpu size={12} strokeWidth={2} aria-hidden="true" />
                          <span className="models-settings-row-label">{provider.name}</span>
                          <span className="models-settings-row-count">{provider.modelCount}</span>
                        </button>
                      </div>
                      {expanded && (
                        <div id={`models-provider-models-${provider.name}`} className="models-settings-models">
                          {provider.models.map((model) => {
                            const isModelSelected = selection?.type === "model"
                              && selection.providerName === provider.name
                              && selection.index === model.index;
                            return (
                              <button
                                key={`${model.id}-${model.index}`}
                                type="button"
                                className="models-settings-row models-settings-model-row"
                                data-selected={isModelSelected ? "true" : undefined}
                                onClick={() => onSelect({ type: "model", providerName: provider.name, index: model.index })}
                              >
                                <span className="models-settings-row-label">{model.id || t("i18n.newModel")}</span>
                                {model.reasoning && (
                                  <span className="models-settings-thinking-badge" title={t("models.reasoning")}>T</span>
                                )}
                              </button>
                            );
                          })}
                          <button type="button" className="models-settings-add-model" onClick={() => onAddModel(provider.name)}>
                            <Plus size={11} strokeWidth={2} aria-hidden="true" />
                            <span>{t("i18n.model")}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <div className="models-settings-navigator-footer">
        <button type="button" className="models-settings-add-provider" onClick={onAddProvider}>
          <Plus size={12} strokeWidth={2} aria-hidden="true" />
          <span>{t("i18n.addProvider")}</span>
        </button>
      </div>
    </div>
  );
}
