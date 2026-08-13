import { Gauge } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { formatCompact, type ConversationContextModel } from "@/lib/conversation-context";

interface Props {
  model: ConversationContextModel;
  onOpenDetails(): void;
}

function getContextTone(percent: number | null) {
  if (percent !== null && percent >= 95) return "#dc2626";
  if (percent !== null && percent >= 80) return "#d97706";
  return "var(--accent)";
}

export function DesktopConversationContext({ model, onOpenDetails }: Props) {
  const { t, locale } = useI18n();
  const turns = model.userMessages;
  const toolCalls = model.toolCalls;
  const progressStyle = {
    "--context-percent": `${model.percent ?? 0}%`,
    "--context-tone": getContextTone(model.percent),
  } as React.CSSProperties;

  return (
    <aside className="desktop-conversation-context" aria-label={t("context.title")}>
      <button type="button" className="desktop-context-heading" onClick={onOpenDetails}>
        <Gauge size={14} aria-hidden="true" />
        <span>{t("context.title")}</span>
        <strong>{model.percent === null ? "?" : `${model.percent.toFixed(1)}%`}</strong>
      </button>
      <section className="desktop-context-capacity">
        <div className="desktop-context-capacity-copy">
          <strong>{formatCompact(model.usedTokens ?? 0)} <small>/ {formatCompact(model.contextWindow)}</small></strong>
          <span>{t("context.available", { tokens: formatCompact(model.availableTokens) })}</span>
        </div>
        <div className="desktop-context-progress" style={progressStyle} aria-label={`${model.percent ?? 0}% ${t("context.used")}`}>
          <span />
        </div>
      </section>
      <div className="desktop-context-activity">
        <span>{turns.toLocaleString(locale)} {t(turns === 1 ? "session.turn" : "session.turns")}</span>
        <span>{toolCalls.toLocaleString(locale)} {t("context.toolCalls")}</span>
        {model.cacheHitRate !== null && <span className="desktop-context-cache-rate">{t("session.cacheHitRate")} <strong>{model.cacheHitRate.toFixed(1)}%</strong></span>}
      </div>
    </aside>
  );
}
