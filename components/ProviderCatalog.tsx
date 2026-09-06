"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

interface CatalogModel {
  id: string;
  name: string;
  api: string;
  reasoning: boolean;
  input: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  visible: boolean;
}

interface CatalogResponse {
  provider: string;
  models: CatalogModel[];
  enabledModels: string[] | null;
  modelScopeWarnings?: string[];
  error?: string;
}

function formatContext(contextWindow?: number): string {
  if (!contextWindow || contextWindow <= 0) return "—";
  if (contextWindow >= 1_000_000) return `${Number((contextWindow / 1_000_000).toFixed(1))}M`;
  if (contextWindow >= 1000) return `${Math.round(contextWindow / 1000)}K`;
  return String(contextWindow);
}

function formatPrice(cost?: { input?: number; output?: number }): string {
  if (!cost || cost.input === undefined || cost.output === undefined) return "";
  return `$${cost.input}/$${cost.output}`;
}

/**
 * Catalog of every model a configured provider offers (static baseline ∪
 * pi.dev remote catalog). Each row carries a toggle that mirrors the model's
 * current visibility: flipping it rewrites this provider's allowlist segment
 * to the desired exact-entry set; "enable all" collapses the segment back to
 * a single `provider/*` glob. Other providers' segments are never touched.
 */
export function ProviderCatalog({ providerId, displayName, cwd }: {
  providerId: string;
  displayName?: string;
  cwd?: string | null;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optimistic draft of this provider's visible model ids while toggle edits
  // are debounced into a single PUT.
  const [optimistic, setOptimistic] = useState<Set<string> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<Set<string> | null>(null);
  const seqRef = useRef(0);
  const [backfillNotice, setBackfillNotice] = useState<string | null>(null);

  const catalogUrl = `/api/models/catalog?provider=${encodeURIComponent(providerId)}${cwd ? `&cwd=${encodeURIComponent(cwd)}` : ""}`;

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(catalogUrl, signal ? { signal } : undefined);
      const d = await res.json() as CatalogResponse;
      if (!res.ok || d.error) {
        setError(d.error ?? `HTTP ${res.status}`);
      } else {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(String(e));
    }
  }, [catalogUrl]);

  useEffect(() => {
    setLoading(true);
    const controller = new AbortController();
    void load(controller.signal).finally(() => setLoading(false));
    return () => controller.abort();
  }, [load]);

  // data is state (stable reference between renders unless reloaded); memoize
  // so `models` keeps a stable identity for the useCallback deps below.
  const models = useMemo(() => data?.models ?? [], [data]);
  const patterns = data?.enabledModels ?? null;
  const allowlistActive = Array.isArray(patterns) && patterns.length > 0;

  const afterChange = useCallback(() => {
    setOptimistic(null);
    draftRef.current = null;
    void load();
    // Let the chat-side model selector pick up the new scope promptly instead
    // of waiting for its 60s TTL.
    window.dispatchEvent(new CustomEvent("pi:models-changed"));
  }, [load]);

  const putWhitelist = useCallback(async (action: "trim" | "reset-provider", modelIds?: string[]): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/models/enabled-models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(cwd ? { cwd } : {}), action, providerId, ...(modelIds ? { models: modelIds } : {}) }),
      });
      const d = await res.json() as { error?: string; warnings?: string[] };
      if (!res.ok || d.error) {
        setError(d.error ?? `HTTP ${res.status}`);
        return false;
      }
      if (d.warnings?.length) console.info("[ProviderCatalog] allowlist warnings:", d.warnings);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [cwd, providerId]);

  // Flush the accumulated toggle draft as ONE trim request. The target set is
  // the models that should stay visible, so the allowlist ends up with the
  // shortest possible segment regardless of toggle direction.
  const flushDraft = useCallback(async () => {
    const draft = draftRef.current;
    if (!draft) return;
    const seq = ++seqRef.current;
    const ok = await putWhitelist("trim", [...draft]);
    if (seq !== seqRef.current) return; // a newer edit superseded this flush
    if (ok) {
      await load();
      window.dispatchEvent(new CustomEvent("pi:models-changed"));
    }
    // Drop the optimistic draft either way; the next render reflects server
    // state (load has refreshed it on success).
    setOptimistic(null);
    draftRef.current = null;
  }, [putWhitelist, load]);

  const handleToggle = useCallback((m: CatalogModel) => {
    if (busy) return;
    setError(null);
    const base = optimistic ?? new Set(models.filter((x) => x.visible).map((x) => x.id));
    const next = new Set(base);
    if (next.has(m.id)) next.delete(m.id);
    else next.add(m.id);
    draftRef.current = next;
    setOptimistic(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void flushDraft(), 400);
  }, [busy, optimistic, models, flushDraft]);

  const visibleOf = useCallback((m: CatalogModel) => (optimistic ? optimistic.has(m.id) : m.visible), [optimistic]);

  // Master switch: all on / all off / partial. Flipping from partial or off
  // enables everything (compact provider/* segment); flipping from on
  // disables everything (segment removed).
  const handleMasterToggle = useCallback(async () => {
    if (busy || loading || models.length === 0) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setOptimistic(null);
    draftRef.current = null;
    setError(null);
    const allOn = models.every((m) => visibleOf(m));
    const ok = allOn
      ? await putWhitelist("trim", [])
      : await putWhitelist("reset-provider");
    if (ok) afterChange();
  }, [busy, loading, models, visibleOf, putWhitelist, afterChange]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/models/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cwd ? { cwd } : {}),
      });
      const d = await res.json() as { errors?: { provider: string; error: string }[]; backfill?: { changed: boolean; added: string[] } };
      if (!res.ok && d.errors?.length) {
        setError(d.errors[0].error);
      }
      if (d.backfill?.changed && d.backfill.added.length > 0) {
        setBackfillNotice(
          t("models.backfillNotice").replace("{providers}", d.backfill.added.map((p) => p.replace("/*", "")).join(", ")),
        );
        window.dispatchEvent(new CustomEvent("pi:models-changed"));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setOptimistic(null);
      draftRef.current = null;
      await load();
      setRefreshing(false);
    }
  }, [cwd, load, t]);

  const locked = busy;

  const visibleCount = loading ? 0 : models.filter((m) => visibleOf(m)).length;
  const allOn = !loading && models.length > 0 && visibleCount === models.length;
  const allOff = !loading && visibleCount === 0;
  // master: "on" | "off" | "partial"
  const master = allOn ? "on" : allOff ? "off" : "partial";

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
          {t("models.catalog")}
          {!loading && models.length > 0 && <span style={{ color: "var(--text-dim)", fontWeight: 400 }}> ({models.length})</span>}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          disabled={refreshing}
          onClick={handleRefresh}
          title={t("models.refreshCatalogHint")}
          style={{
            display: "flex", alignItems: "center", gap: 5, padding: "4px 10px",
            border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)",
            color: refreshing ? "var(--text-dim)" : "var(--text-muted)", cursor: refreshing ? "default" : "pointer",
            fontSize: 11,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={refreshing ? { animation: "spin 0.8s linear infinite" } : undefined} aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          </svg>
          {refreshing ? t("models.refreshing") : t("models.refreshCatalog")}
        </button>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {allowlistActive
              ? t("models.whitelistActive").replace("{count}", String(patterns?.length ?? 0))
              : t("models.whitelistInactive")}
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            role="switch"
            aria-checked={allOn ? true : allOff ? false : "mixed"}
            disabled={locked || loading || models.length === 0}
            onClick={() => void handleMasterToggle()}
            title={t("models.masterToggleHint")}
            style={{
              flexShrink: 0, width: 34, height: 17, borderRadius: 9, border: "none",
              position: "relative", padding: 0, marginRight: 9,
              background: master === "on" ? "var(--accent, #4ade80)" : master === "partial" ? "rgba(74,222,128,0.4)" : "var(--bg-panel)",
              boxShadow: "inset 0 0 0 1px var(--border)",
              cursor: locked || loading || models.length === 0 ? "default" : "pointer",
            }}
          >
            <span
              style={{
                position: "absolute", top: 2,
                left: master === "on" ? 19 : master === "partial" ? 10.5 : 2,
                width: 13, height: 13, borderRadius: "50%",
                background: master === "off" ? "var(--text-dim)" : "#0b0f0c",
                transition: "left 0.15s ease",
              }}
            />
          </button>
        </div>

      {backfillNotice && (
        <div style={{ marginBottom: 8, padding: "6px 10px", borderRadius: 5, background: "var(--bg-panel)", color: "var(--accent, #4ade80)", fontSize: 11 }}>{backfillNotice}</div>
      )}
      {error && (
        <div style={{ marginBottom: 8, padding: "6px 10px", borderRadius: 5, background: "var(--bg-panel)", color: "#f87171", fontSize: 11 }}>{error}</div>
      )}
      {(data?.modelScopeWarnings?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 8, padding: "6px 10px", borderRadius: 5, background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: 11 }}>
          {data?.modelScopeWarnings?.join("; ")}
        </div>
      )}

      {loading ? (
        <div style={{ padding: "10px 2px", fontSize: 12, color: "var(--text-muted)" }}>{t("i18n.loading")}</div>
      ) : models.length === 0 ? (
        <div style={{ padding: "10px 2px", fontSize: 12, color: "var(--text-dim)" }}>{t("models.catalogEmpty")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", maxHeight: "50vh", overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
          {models.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                background: visibleOf(m) ? "var(--bg-panel)" : "transparent",
                borderBottom: "1px solid var(--border)", minHeight: 30,
              }}
            >
              <span title={m.id} style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{m.name || m.id}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{m.id}</span>
              {m.input.includes("image") && (
                <span title={t("models.supportsImage")} style={{ flexShrink: 0, fontSize: 9, color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: 3, padding: "1px 4px" }}>{t("models.imageTag")}</span>
              )}
              {m.reasoning && (
                <span title={t("models.supportsReasoning")} style={{ flexShrink: 0, fontSize: 9, color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: 3, padding: "1px 4px" }}>{t("models.reasoningTag")}</span>
              )}
              <span style={{ flexShrink: 0, fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{formatContext(m.contextWindow)}</span>
              {formatPrice(m.cost) && (
                <span style={{ flexShrink: 0, fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{formatPrice(m.cost)}</span>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={visibleOf(m)}
                disabled={locked}
                onClick={() => handleToggle(m)}
                title={t("models.toggleHint")}
                style={{
                  flexShrink: 0, width: 30, height: 17, borderRadius: 9, border: "none",
                  position: "relative", padding: 0,
                  background: visibleOf(m) ? "var(--accent, #4ade80)" : "var(--bg-panel)",
                  boxShadow: "inset 0 0 0 1px var(--border)",
                  cursor: locked ? "default" : "pointer",
                }}
              >
                <span
                  style={{
                    position: "absolute", top: 2, left: visibleOf(m) ? 15 : 2,
                    width: 13, height: 13, borderRadius: "50%",
                    background: visibleOf(m) ? "#0b0f0c" : "var(--text-dim)",
                    transition: "left 0.15s ease",
                  }}
                />
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && models.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
            {displayName ? `${displayName} · ` : ""}{providerId}
          </span>
        </div>
      )}
      </div>
    </div>
  );
}
