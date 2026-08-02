"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { ConfigModal, ConfigListRow, ModalButton } from "@/components/ui/ConfigModal";

// 跟随上游重写（2026-08-02）：上游已移除 csrf header 机制（见 components/AgentsConfig），
// 这里用原生 fetch 替代已删的 csrfFetchJson，保持 { ok, data } 调用契约。
// init 用宽松类型以兼容原 csrfFetchJson 调用方在 body 里直接传对象的写法，
// 函数内将对象 body 自动 JSON 序列化。
async function apiFetchJson<T = unknown>(
  url: string,
  init?: Record<string, unknown>,
): Promise<{ ok: boolean; data: T; status?: number }> {
  try {
    const body =
      init?.body != null && typeof init.body === "object" && !(init.body instanceof FormData)
        ? JSON.stringify(init.body)
        : (init?.body as BodyInit | undefined);
    const res = await fetch(url, {
      ...init,
      body,
      headers: {
        "Content-Type": "application/json",
        ...((init?.headers as Record<string, string>) ?? {}),
      },
    } as RequestInit);
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, data, status: res.status };
  } catch {
    return { ok: false, data: {} as T };
  }
}

// ── Types (mirror app/api/prompts/* responses) ───────────────────────────────

interface ModuleRow {
  id: string;
  source: string;
  category: string;
  tags: string[];
  heading?: string;
  alwaysOn: boolean;
  enabled: boolean;
  text: string;
  compressedText?: string;
  estimatedTokens: number;
}

interface Summary {
  count: number;
  totalTokens: number;
  enabledTokens: number;
  savedTokens: number;
}

interface ModulesResponse {
  modules: ModuleRow[];
  summary: Summary;
  agentsMdModular: boolean;
}

interface PreviewResponse {
  selected: Array<{ id: string; source: string; category: string }>;
  skipped: Array<{ id: string; source: string; category: string }>;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  usedLlm: boolean;
}

const SOURCE_ORDER = ["app", "agents-md", "orchestrator", "engine"] as const;

// Category → dot color (aligns with design token palette).
const CATEGORY_COLOR: Record<string, string> = {
  identity: "#6366F1",
  constraints: "#EF4444",
  tone: "#0EA5E9",
  "output-format": "#3B82F6",
  grounding: "#22C55E",
  examples: "#F59E0B",
  localization: "#14B8A6",
  safety: "#EF4444",
  other: "#94A3B8",
};

interface Props {
  cwd?: string | null;
  onClose: () => void;
}

export function PromptsConfig({ cwd, onClose }: Props) {
  const { t } = useI18n();
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [agentsMdModular, setAgentsMdModular] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Preview state
  const [previewInput, setPreviewInput] = useState("");
  const [previewUseLlm, setPreviewUseLlm] = useState(false);
  const [previewRunning, setPreviewRunning] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { ok, data } = await apiFetchJson<ModulesResponse>("/api/prompts/modules", {
      method: "GET",
    });
    if (!ok || !Array.isArray(data.modules)) {
      setLoadError(t("promptOpt.loadFailed"));
      setLoading(false);
      return;
    }
    setModules(data.modules);
    setSummary(data.summary);
    setAgentsMdModular(Boolean(data.agentsMdModular));
    setLoading(false);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => modules.find((m) => m.id === selectedId) ?? null,
    [modules, selectedId],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, ModuleRow[]>();
    for (const m of modules) {
      const arr = map.get(m.source) ?? [];
      arr.push(m);
      map.set(m.source, arr);
    }
    return SOURCE_ORDER.filter((s) => map.has(s)).map((s) => ({
      source: s,
      items: map.get(s)!,
    }));
  }, [modules]);

  const sourceLabel = useCallback(
    (s: string) => {
      switch (s) {
        case "app":
          return t("promptOpt.sourceApp");
        case "agents-md":
          return t("promptOpt.sourceAgentsMd");
        case "orchestrator":
          return t("promptOpt.sourceOrchestrator");
        case "engine":
          return t("promptOpt.sourceEngine");
        default:
          return s;
      }
    },
    [t],
  );

  const toggleModule = useCallback(
    async (m: ModuleRow) => {
      if (m.alwaysOn) return;
      const next = !m.enabled;
      // Optimistic update
      setModules((prev) => prev.map((x) => (x.id === m.id ? { ...x, enabled: next } : x)));
      const { ok } = await apiFetchJson("/api/prompts/modules", {
        method: "PUT",
        body: { id: m.id, enabled: next },
      });
      if (!ok) {
        // revert on failure
        setModules((prev) => prev.map((x) => (x.id === m.id ? { ...x, enabled: !next } : x)));
        return;
      }
      void load();
    },
    [load],
  );

  const toggleAgentsMdModular = useCallback(async () => {
    const next = !agentsMdModular;
    setAgentsMdModular(next);
    const { ok } = await apiFetchJson("/api/prompts/modules", {
      method: "PUT",
      body: { agentsMdModular: next },
    });
    if (!ok) setAgentsMdModular(!next);
  }, [agentsMdModular]);

  const compress = useCallback(
    async (m: ModuleRow, useLlm: boolean) => {
      setBusyId(m.id);
      const { ok, data } = await apiFetchJson<{ text: string }>("/api/prompts/compress", {
        method: "POST",
        body: { id: m.id, useLlm, cwd: cwd ?? undefined },
      });
      setBusyId(null);
      if (ok && data.text) {
        setModules((prev) =>
          prev.map((x) => (x.id === m.id ? { ...x, compressedText: data.text } : x)),
        );
      }
      void load();
    },
    [cwd, load],
  );

  const resetCompression = useCallback(
    async (m: ModuleRow) => {
      setBusyId(m.id);
      const { ok } = await apiFetchJson("/api/prompts/modules", {
        method: "PUT",
        body: { id: m.id, compressedOverride: null },
      });
      setBusyId(null);
      if (ok) {
        setModules((prev) =>
          prev.map((x) => (x.id === m.id ? { ...x, compressedText: undefined } : x)),
        );
      }
      void load();
    },
    [load],
  );

  const runPreview = useCallback(async () => {
    if (!previewInput.trim()) return;
    setPreviewRunning(true);
    const { ok, data } = await apiFetchJson<PreviewResponse>("/api/prompts/preview-select", {
      method: "POST",
      body: { userInput: previewInput, useLlmSelect: previewUseLlm, cwd: cwd ?? undefined },
    });
    setPreviewRunning(false);
    if (ok) setPreview(data);
  }, [previewInput, previewUseLlm, cwd]);

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderLeft = () => {
    if (loading) return <div style={hintStyle}>…</div>;
    if (loadError) return <div style={{ ...hintStyle, color: "#ef4444" }}>{loadError}</div>;
    if (modules.length === 0) return <div style={hintStyle}>{t("promptOpt.empty")}</div>;
    return grouped.map((g) => (
      <div key={g.source} style={{ marginBottom: 10 }}>
        <div style={groupHeaderStyle}>{sourceLabel(g.source)}</div>
        {g.items.map((m) => (
          <ConfigListRow
            key={m.id}
            selected={m.id === selectedId}
            onClick={() => setSelectedId(m.id)}
            leading={
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: CATEGORY_COLOR[m.category] ?? "#94A3B8",
                  opacity: m.enabled || m.alwaysOn ? 1 : 0.35,
                }}
              />
            }
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={rowTitleStyle}>{m.heading ?? m.id}</div>
              <div style={rowMetaStyle}>
                {m.estimatedTokens} {t("promptOpt.tokens")}
                {m.compressedText ? ` · ${t("promptOpt.compressed")}` : ""}
              </div>
            </div>
            <MiniToggle
              enabled={m.enabled || m.alwaysOn}
              disabled={m.alwaysOn}
              onToggle={(e) => {
                e.stopPropagation();
                void toggleModule(m);
              }}
            />
          </ConfigListRow>
        ))}
      </div>
    ));
  };

  const renderDetail = () => {
    if (!selected)
      return <div style={{ ...hintStyle, paddingTop: 40 }}>{t("promptOpt.selectModule")}</div>;
    const m = selected;
    const original = m.text;
    const compressed = m.compressedText;
    const ratio =
      compressed && original.length > 0
        ? Math.round((1 - compressed.length / original.length) * 100)
        : null;
    const busy = busyId === m.id;
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: CATEGORY_COLOR[m.category] ?? "#94A3B8",
            }}
          />
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
            {m.heading ?? m.id}
          </span>
          {m.alwaysOn && <span style={badgeStyle}>{t("promptOpt.alwaysOn")}</span>}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={tagStyle}>{t(`promptOpt.category.${m.category}` as never)}</span>
          {m.tags.map((tag) => (
            <span key={tag} style={tagStyle}>
              #{tag}
            </span>
          ))}
          <span style={tagStyle}>
            {m.estimatedTokens} {t("promptOpt.tokens")}
          </span>
          {ratio !== null && (
            <span style={{ ...tagStyle, color: "#22C55E", borderColor: "rgba(34,197,94,0.4)" }}>
              {t("promptOpt.ratioLabel")} -{ratio}%
            </span>
          )}
        </div>

        {/* Action bar */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <ModalButton variant="primary" disabled={busy} onClick={() => void compress(m, false)}>
            {busy ? t("promptOpt.compressing") : t("promptOpt.compress")}
          </ModalButton>
          <ModalButton variant="secondary" disabled={busy} onClick={() => void compress(m, true)}>
            {t("promptOpt.llmRefine")}
          </ModalButton>
          {compressed && (
            <ModalButton variant="danger" disabled={busy} onClick={() => void resetCompression(m)}>
              {t("promptOpt.reset")}
            </ModalButton>
          )}
        </div>

        {/* Diff preview (original vs compressed) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={diffLabelStyle}>{t("promptOpt.original")}</div>
            <pre style={{ ...codeBlockStyle, color: "var(--text-muted)" }}>{original}</pre>
          </div>
          {compressed && (
            <div>
              <div style={{ ...diffLabelStyle, color: "#22C55E" }}>{t("promptOpt.compressed")}</div>
              <pre style={{ ...codeBlockStyle, color: "var(--text)" }}>{compressed}</pre>
            </div>
          )}
        </div>
      </div>
    );
  };

  const previewSelectedIds = new Set(preview?.selected.map((s) => s.id) ?? []);

  const rightPane = (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Summary + master switch */}
      <div style={summaryBarStyle}>
        {summary && (
          <div style={{ display: "flex", gap: 18 }}>
            <SummaryStat label={t("promptOpt.summaryModules")} value={String(summary.count)} />
            <SummaryStat
              label={t("promptOpt.summaryTokens")}
              value={String(summary.enabledTokens)}
            />
            <SummaryStat
              label={t("promptOpt.summarySaved")}
              value={String(summary.savedTokens)}
              accent="#22C55E"
            />
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>
              {t("promptOpt.agentsMdModular")}
            </span>
            <span
              style={{ fontSize: 10, color: "var(--text-dim)", maxWidth: 220, textAlign: "right" }}
            >
              {t("promptOpt.agentsMdModularHint")}
            </span>
          </div>
          <MiniToggle enabled={agentsMdModular} onToggle={() => void toggleAgentsMdModular()} />
        </div>
      </div>

      {/* Detail (scrollable) */}
      <div style={{ flex: 1, overflowY: "auto", paddingRight: 2 }}>{renderDetail()}</div>

      {/* Dynamic submission preview */}
      <div style={previewBoxStyle}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
          {t("promptOpt.previewTitle")}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          <input
            value={previewInput}
            onChange={(e) => setPreviewInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runPreview();
            }}
            placeholder={t("promptOpt.previewPlaceholder")}
            style={previewInputStyle}
          />
          <ModalButton
            variant="primary"
            disabled={previewRunning || !previewInput.trim()}
            onClick={() => void runPreview()}
          >
            {previewRunning ? t("promptOpt.previewRunning") : t("promptOpt.previewRun")}
          </ModalButton>
        </div>
        <label style={llmCheckStyle}>
          <input
            type="checkbox"
            checked={previewUseLlm}
            onChange={(e) => setPreviewUseLlm(e.target.checked)}
          />
          {t("promptOpt.useLlm")}
        </label>
        {preview && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: "#22C55E", fontWeight: 600, marginBottom: 6 }}>
              {t("promptOpt.previewResult")
                .replace("{selected}", String(preview.selected.length))
                .replace("{saved}", String(preview.tokensSaved))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {modules
                .filter((m) => m.enabled || m.alwaysOn)
                .map((m) => (
                  <span
                    key={m.id}
                    style={{
                      ...tagStyle,
                      opacity: previewSelectedIds.has(m.id) ? 1 : 0.35,
                      borderColor: previewSelectedIds.has(m.id)
                        ? "rgba(34,197,94,0.5)"
                        : "var(--border)",
                      color: previewSelectedIds.has(m.id) ? "#22C55E" : "var(--text-dim)",
                    }}
                  >
                    {m.heading ?? m.id}
                  </span>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <ConfigModal
      title={t("promptOpt.title")}
      subtitle={t("promptOpt.subtitle")}
      width={880}
      onClose={onClose}
      left={renderLeft()}
      right={rightPane}
      footer={
        <ModalButton variant="secondary" onClick={onClose}>
          {t("common.close")}
        </ModalButton>
      }
    />
  );
}

// ── Small sub-components ──────────────────────────────────────────────────────

function MiniToggle({
  enabled,
  disabled,
  onToggle,
}: {
  enabled: boolean;
  disabled?: boolean;
  onToggle: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      style={{
        flexShrink: 0,
        width: 34,
        height: 18,
        borderRadius: 9,
        border: "none",
        padding: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        background: enabled ? "var(--accent)" : "var(--border)",
        position: "relative",
        transition: "background 0.18s",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: enabled ? 18 : 2,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 0.18s",
        }}
      />
    </button>
  );
}

function SummaryStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: accent ?? "var(--text)" }}>{value}</span>
      <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{label}</span>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-dim)",
  padding: "8px 6px",
  textAlign: "center",
};

const groupHeaderStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: "var(--text-dim)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  padding: "4px 8px",
};

const rowTitleStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--text)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const rowMetaStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-dim)",
  fontFamily: "var(--font-mono)",
};

const summaryBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  paddingBottom: 12,
  marginBottom: 12,
  borderBottom: "1px solid var(--border)",
  flexShrink: 0,
};

const badgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  padding: "1px 6px",
  borderRadius: 4,
  background: "rgba(99,102,241,0.15)",
  color: "#818cf8",
};

const tagStyle: React.CSSProperties = {
  fontSize: 10,
  padding: "2px 7px",
  borderRadius: 4,
  border: "1px solid var(--border)",
  color: "var(--text-muted)",
  fontFamily: "var(--font-mono)",
};

const diffLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: "var(--text-dim)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 4,
};

const codeBlockStyle: React.CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.55,
  fontFamily: "var(--font-mono)",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "8px 10px",
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 220,
  overflowY: "auto",
};

const previewBoxStyle: React.CSSProperties = {
  flexShrink: 0,
  marginTop: 12,
  paddingTop: 12,
  borderTop: "1px solid var(--border)",
};

const previewInputStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 12,
  padding: "6px 10px",
  borderRadius: 6,
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  outline: "none",
};

const llmCheckStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  color: "var(--text-muted)",
  marginTop: 6,
  cursor: "pointer",
};
