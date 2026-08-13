import { Gauge } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { formatCompact, type ConversationContextModel } from "@/lib/conversation-context";

interface Props {
  model: ConversationContextModel;
  onOpenDetails(): void;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="desktop-context-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricSection({ title, value, children }: { title: string; value: string; children: React.ReactNode }) {
  return (
    <section className="desktop-context-metrics">
      <div className="desktop-context-metric-heading"><span>{title}</span><strong>{value}</strong></div>
      <div className="desktop-context-metric-grid">{children}</div>
    </section>
  );
}

export function DesktopConversationContext({ model, onOpenDetails }: Props) {
  const { t } = useI18n();
  return (
    <aside className="desktop-conversation-context" aria-label={t("context.title")}>
      <button type="button" className="desktop-context-heading" onClick={onOpenDetails}>
        <Gauge size={14} aria-hidden="true" />
        <span>{t("context.title")}</span>
      </button>
      <section className="desktop-context-capacity">
        <div
          className="desktop-context-ring"
          style={{ "--context-percent": `${model.percent ?? 0}%` } as React.CSSProperties}
        >
          <div className="desktop-context-ring-label">
            <strong>{model.percent === null ? "?" : `${model.percent.toFixed(1)}%`}</strong>
            <span>{t("context.used")}</span>
          </div>
        </div>
        <div>
          <span>{t("context.capacity")}</span>
          <strong>{formatCompact(model.usedTokens ?? 0)} <small>/ {formatCompact(model.contextWindow)}</small></strong>
          <small>{t("context.available", { tokens: formatCompact(model.availableTokens) })}</small>
        </div>
      </section>
      <MetricSection title={t("context.totalTokens")} value={formatCompact(model.totalTokens)}>
        <Metric label={t("session.input")} value={formatCompact(model.inputTokens)} />
        <Metric label={t("session.output")} value={formatCompact(model.outputTokens)} />
      </MetricSection>
      <MetricSection title={t("session.cacheHitRate")} value={`${model.cacheRate.toFixed(1)}%`}>
        <Metric label={t("session.cacheRead")} value={formatCompact(model.cacheRead)} />
        <Metric label={t("session.cacheWrite")} value={formatCompact(model.cacheWrite)} />
      </MetricSection>
      <footer className="desktop-context-footer">
        <div><span>{t("context.model")}</span><strong>{model.modelLabel || t("context.unknown")}</strong></div>
        <div><span>{t("session.cost")}</span><strong>${model.cost.toFixed(4)}</strong></div>
      </footer>
    </aside>
  );
}
