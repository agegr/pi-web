const PROVIDER_ICONS: Record<string, { symbol: string; color: boolean }> = {
  anthropic: { symbol: "anthropic", color: false },
  openai: { symbol: "openai", color: false },
  "openai-codex": { symbol: "openai", color: false },
  google: { symbol: "google", color: true },
  "google-vertex": { symbol: "google", color: true },
  "ant-ling": { symbol: "antgroup", color: true },
  deepseek: { symbol: "deepseek", color: true },
  groq: { symbol: "groq", color: false },
  mistral: { symbol: "mistral", color: true },
  moonshotai: { symbol: "moonshot", color: false },
  "moonshotai-cn": { symbol: "moonshot", color: false },
  moonshot: { symbol: "moonshot", color: false },
  minimax: { symbol: "minimax", color: true },
  "minimax-cn": { symbol: "minimax", color: true },
  fireworks: { symbol: "fireworks", color: true },
  huggingface: { symbol: "huggingface", color: true },
  cerebras: { symbol: "cerebras", color: true },
  openrouter: { symbol: "openrouter", color: false },
  xai: { symbol: "xai", color: false },
  "cloudflare-ai-gateway": { symbol: "cloudflare", color: true },
  "cloudflare-workers-ai": { symbol: "cloudflare", color: true },
  "vercel-ai-gateway": { symbol: "vercel", color: false },
  "github-copilot": { symbol: "githubcopilot", color: false },
  "amazon-bedrock": { symbol: "aws", color: true },
  "azure-openai-responses": { symbol: "azure", color: true },
  "kimi-coding": { symbol: "kimi", color: true },
  nvidia: { symbol: "nvidia", color: true },
  opencode: { symbol: "opencode", color: false },
  "opencode-go": { symbol: "opencode", color: false },
  qwen: { symbol: "qwen", color: true },
  xiaomi: { symbol: "xiaomimimo", color: false },
  "xiaomi-token-plan-ams": { symbol: "xiaomimimo", color: false },
  "xiaomi-token-plan-cn": { symbol: "xiaomimimo", color: false },
  "xiaomi-token-plan-sgp": { symbol: "xiaomimimo", color: false },
  zai: { symbol: "zai", color: false },
  "zai-coding-cn": { symbol: "zai", color: false },
  zhipu: { symbol: "zhipu", color: true },
  cohere: { symbol: "cohere", color: true },
  perplexity: { symbol: "perplexity", color: true },
  together: { symbol: "together", color: true },
  grok: { symbol: "grok", color: false },
};

function SpriteIcon({ symbol, color, size }: { symbol: string; color: boolean; size: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color ? undefined : "currentColor"}
      style={{ color: "var(--text-muted)", flexShrink: 0 }}
    >
      <use href={`/provider-icons.svg#${symbol}`} />
    </svg>
  );
}

export function ProviderIcon({ id, size }: { id: string; size: number }) {
  const icon = PROVIDER_ICONS[id.toLowerCase()];
  if (icon) return <SpriteIcon symbol={icon.symbol} color={icon.color} size={size} />;

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

const MODEL_ICON_RULES: Array<[RegExp, string]> = [
  [/\b(?:claude|anthropic)\b/i, "anthropic"],
  [/\b(?:gpt|chatgpt|codex|o[1-9](?:[-.]\d+)?)\b/i, "openai"],
  [/\b(?:gemini|gemma)\b/i, "google"],
  [/\bdeepseek\b/i, "deepseek"],
  [/\b(?:grok|xai)\b/i, "grok"],
  [/\b(?:qwen|通义)\b/i, "qwen"],
  [/\b(?:glm|chatglm|智谱)\b/i, "zhipu"],
  [/\b(?:mistral|mixtral)\b/i, "mistral"],
  [/\b(?:kimi|moonshot)\b/i, "moonshot"],
  [/\bminimax\b/i, "minimax"],
];

function DefaultModelIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" />
    </svg>
  );
}

export function ModelIcon({ provider, modelId, modelName, size = 14 }: { provider: string; modelId: string; modelName?: string; size?: number }) {
  const text = `${modelId} ${modelName ?? ""}`;
  const matchedSymbol = MODEL_ICON_RULES.find(([pattern]) => pattern.test(text))?.[1];
  const providerIcon = PROVIDER_ICONS[provider.toLowerCase()];
  if (matchedSymbol) {
    const icon = PROVIDER_ICONS[matchedSymbol];
    return <SpriteIcon symbol={icon.symbol} color={icon.color} size={size} />;
  }
  if (providerIcon) return <SpriteIcon symbol={providerIcon.symbol} color={providerIcon.color} size={size} />;
  return <DefaultModelIcon size={size} />;
}
