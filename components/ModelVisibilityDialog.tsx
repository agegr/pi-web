"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { computeVisibilitySave, hasAdvancedPatterns, modelRefKey, type VisibleModelRef } from "@/lib/model-visibility";

interface VisibilityModelEntry {
  id: string;
  name: string;
  provider: string;
}

interface VisibilityResponse {
  patterns?: string[] | null;
  models?: VisibilityModelEntry[];
  /** Models the current scope resolves to, computed server-side with pi's matcher. */
  visible?: VisibleModelRef[];
  modelError?: string;
  error?: string;
}

const MODEL_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareEntries(a: VisibilityModelEntry, b: VisibilityModelEntry): number {
  return MODEL_COLLATOR.compare(a.provider, b.provider)
    || MODEL_COLLATOR.compare(a.name || a.id, b.name || b.id)
    || MODEL_COLLATOR.compare(a.id, b.id);
}

/**
 * Dialog (Settings → Models) that manages which models the chat selector offers.
 *
 * It edits pi's global `enabledModels` setting (~/.pi/agent/settings.json):
 * the checkbox list starts from the models the current scope resolves to
 * (computed server-side with pi's matcher) and saving writes exact
 * `provider/modelId` patterns — or clears the setting when every available
 * model stays visible. This is also the supported way to hide built-in catalog
 * models that models.json can only override, never remove (#560).
 */
export function ModelVisibilityDialog({
  cwd,
  onClose,
  onChanged,
}: {
  /** Project whose extension-registered providers should be listed; omit for global only. */
  cwd?: string | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [models, setModels] = useState<VisibilityModelEntry[] | null>(null);
  const [patterns, setPatterns] = useState<string[] | null>(null);
  const [visibleModels, setVisibleModels] = useState<readonly VisibleModelRef[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setCheckedKeys(new Set());
    setModels(null);
    setPatterns(null);
    setVisibleModels([]);
    setLoadError(null);
    setSaveError(null);
    setFilter("");
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    fetch(`/api/models-visibility${query}`)
      .then(async (res) => {
        const data = await res.json() as VisibilityResponse;
        if (requestId !== requestIdRef.current) return;
        if (!res.ok || data.error || !data.models) {
          setLoadError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        const visible = data.visible ?? [];
        setModels([...data.models].sort(compareEntries));
        setPatterns(data.patterns ?? null);
        setVisibleModels(visible);
        setCheckedKeys(new Set(visible.map(modelRefKey)));
      })
      .catch((error) => {
        if (requestId !== requestIdRef.current) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      });
  }, [cwd]);

  const allChecked = useMemo(
    () => (models ?? []).filter((model) => checkedKeys.has(modelRefKey(model))),
    [models, checkedKeys],
  );
  const checkedCount = allChecked.length;
  const totalCount = models?.length ?? 0;
  const initialKeys = useMemo(() => {
    const keys = new Set(visibleModels.map(modelRefKey));
    // An unset scope shows every model, so the pristine selection is "all".
    if (!patterns || patterns.length === 0) {
      for (const model of models ?? []) keys.add(modelRefKey(model));
    }
    return keys;
  }, [visibleModels, patterns, models]);
  const dirty = useMemo(() => {
    if (checkedKeys.size !== initialKeys.size) return true;
    for (const key of checkedKeys) {
      if (!initialKeys.has(key)) return true;
    }
    return false;
  }, [checkedKeys, initialKeys]);

  const groups = useMemo(() => {
    const normalizedQuery = filter.trim().toLocaleLowerCase();
    const matches = (models ?? []).filter((model) => !normalizedQuery
      || `${model.name} ${model.id}`.toLocaleLowerCase().includes(normalizedQuery));
    const byProvider: { provider: string; options: VisibilityModelEntry[] }[] = [];
    for (const model of matches) {
      const group = byProvider.find((entry) => entry.provider === model.provider);
      if (group) group.options.push(model);
      else byProvider.push({ provider: model.provider, options: [model] });
    }
    return { matches, byProvider };
  }, [models, filter]);

  const toggleModel = useCallback((model: VisibilityModelEntry) => {
    const key = modelRefKey(model);
    setCheckedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleProvider = useCallback((provider: string, options: VisibilityModelEntry[]) => {
    const keys = options.map(modelRefKey);
    const allSelected = keys.every((key) => checkedKeys.has(key));
    setCheckedKeys((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (allSelected) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }, [checkedKeys]);

  const toggleAll = useCallback(() => {
    setCheckedKeys((current) => {
      if (models && current.size >= models.length) return new Set();
      return new Set((models ?? []).map(modelRefKey));
    });
  }, [models]);

  const handleSave = useCallback(async () => {
    if (!models || saving) return;
    const save = computeVisibilitySave(allChecked, models.length);
    if (!save) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/models-visibility", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(cwd ? { cwd } : {}),
          patterns: save.type === "clear" ? null : save.patterns,
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || data.error) {
        setSaveError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      onChanged?.();
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [allChecked, cwd, models, onChanged, onClose, saving]);

  const emptySelection = models !== null && checkedCount === 0;
  const canSave = dirty && !emptySelection && !saving && models !== null;
  const warning = emptySelection
    ? t("models.visibilityEmptySelection")
    : saveError;

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.4)",
      }}
      onClick={(event) => {
        if (!saving && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-visibility-title"
        style={{
          width: isMobile ? "calc(100vw - 16px)" : 560,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : "70vh",
          maxHeight: "calc(100dvh - 16px)",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: 10,
          background: "var(--bg)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
          overflow: "hidden",
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !saving) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        {/* Header */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div id="model-visibility-title" style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
            {t("models.visibilityTitle")}
          </div>
          <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.5, color: "var(--text-dim)" }}>
            {t("models.visibilityDescription")}
          </div>
          {hasAdvancedPatterns(patterns) && (
            <div style={{ marginTop: 8, padding: "6px 9px", border: "1px solid rgba(217,119,6,0.35)", borderRadius: 5, color: "#d97706", fontSize: 11, lineHeight: 1.5 }}>
              {t("models.visibilityAdvancedNotice")}
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {loadError ? (
            <div style={{ padding: 20, color: "#ef4444", fontSize: 12 }}>{loadError}</div>
          ) : models === null ? (
            <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 12 }}>{t("i18n.loading")}</div>
          ) : (
            <>
              <label
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0,
                  cursor: "pointer", color: "var(--text-muted)", fontSize: 11, fontWeight: 600,
                }}
              >
                <input
                  type="checkbox"
                  checked={checkedCount === totalCount && totalCount > 0}
                  onChange={toggleAll}
                  style={{ width: 13, height: 13, accentColor: "var(--accent)", flexShrink: 0 }}
                />
                {t("models.visibilitySelectAll")}
                <span style={{ marginLeft: "auto", fontWeight: 400, color: "var(--text-dim)" }}>
                  {t("models.visibilityShown", { shown: checkedCount, total: totalCount })}
                </span>
              </label>
              {(models.length > 8 || filter.trim()) && (
                <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                  <input
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder={t("chat.filterModels")}
                    aria-label={t("chat.filterModels")}
                    autoComplete="off"
                    spellCheck={false}
                    style={{
                      width: "100%", boxSizing: "border-box", padding: "5px 8px",
                      border: "1px solid var(--border)", borderRadius: 5, outline: "none",
                      background: "var(--bg)", color: "var(--text)",
                      fontFamily: "var(--font-mono)", fontSize: 11,
                    }}
                  />
                </div>
              )}
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                {groups.byProvider.length === 0 ? (
                  <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>
                    {t("chat.noMatchingModels")}
                  </div>
                ) : groups.byProvider.map((group, index) => {
                  const selectableKeys = group.options.map(modelRefKey);
                  const allSelected = selectableKeys.every((key) => checkedKeys.has(key));
                  const someSelected = !allSelected && selectableKeys.some((key) => checkedKeys.has(key));
                  return (
                    <div key={group.provider}>
                      <label
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "6px 12px 4px",
                          borderTop: index > 0 ? "1px solid var(--border)" : "none",
                          color: "var(--text-dim)", fontSize: 10, fontWeight: 600,
                          textTransform: "uppercase", letterSpacing: "0.06em",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(node) => { if (node) node.indeterminate = someSelected; }}
                          onChange={() => toggleProvider(group.provider, group.options)}
                          style={{ width: 12, height: 12, accentColor: "var(--accent)", flexShrink: 0 }}
                        />
                        {group.provider}
                      </label>
                      {group.options.map((model) => {
                        const key = modelRefKey(model);
                        const checked = checkedKeys.has(key);
                        return (
                          <label
                            key={key}
                            style={{
                              display: "flex", alignItems: "center", gap: 8,
                              padding: "5px 12px 5px 20px", cursor: "pointer",
                              color: "var(--text)", fontSize: 12,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleModel(model)}
                              style={{ width: 13, height: 13, accentColor: "var(--accent)", flexShrink: 0 }}
                            />
                            <span style={{ minWidth: 0, flex: 1 }}>
                              <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {model.name || model.id}
                              </span>
                              {model.name && model.name !== model.id && (
                                <code style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)" }}>
                                  {model.id}
                                </code>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10,
          padding: "10px 16px", borderTop: "1px solid var(--border)", flexShrink: 0,
        }}>
          {warning && (
            <span title={warning} style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: emptySelection || saveError ? "#ef4444" : "var(--text-dim)" }}>
              {warning}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{ padding: "6px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: saving ? "not-allowed" : "pointer", fontSize: 13 }}
          >
            {t("i18n.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            style={{
              padding: "6px 16px",
              background: canSave ? "var(--accent)" : "var(--bg-panel)",
              border: "none", borderRadius: 6,
              color: canSave ? "#fff" : "var(--text-dim)",
              cursor: canSave ? "pointer" : "not-allowed",
              fontSize: 13, fontWeight: 600,
            }}
          >
            {saving ? t("i18n.saving") : t("i18n.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
