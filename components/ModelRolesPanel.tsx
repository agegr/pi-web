"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { ModelRoleAssignment, ModelRoleScope } from "@/lib/api-types";
import { useI18n } from "@/hooks/useI18n";

interface ModelEntry {
  id: string;
  name: string;
  provider: string;
}

interface Props {
  /** Working directory the roles are resolved against (project layer + model scope). */
  cwd: string | null;
  /** Notifies the shell that a role changed so open sessions refresh their picker. */
  onRolesChanged?: () => void;
}

const SCOPES: ModelRoleScope[] = ["global", "project"];

function selectorFor(model: ModelEntry): string {
  return `${model.provider}/${model.id}`;
}

/**
 * Assign a model to each of omp's roles.
 *
 * omp routes work by role rather than by "the current model": `default` runs
 * ordinary turns, `smol` runs cheap subagent work, `slow` runs deep reasoning,
 * `plan` drives plan mode, `commit` writes changelogs. This panel writes the
 * same `modelRoles` record `omp`'s `/model` selector writes, so an assignment
 * made here is what the next terminal session uses too.
 */
export function ModelRolesPanel({ cwd, onRolesChanged }: Props) {
  const { t } = useI18n();
  const [roles, setRoles] = useState<ModelRoleAssignment[]>([]);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [scope, setScope] = useState<ModelRoleScope>("global");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!cwd) {
      setRoles([]);
      setModels([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const query = `?cwd=${encodeURIComponent(cwd)}`;
      const [rolesRes, modelsRes] = await Promise.all([
        fetch(`/api/model-roles${query}`, signal ? { signal } : undefined),
        fetch(`/api/models${query}`, signal ? { signal } : undefined),
      ]);
      if (!rolesRes.ok) throw new Error(`HTTP ${rolesRes.status}`);
      const rolesData = await rolesRes.json() as { roles?: ModelRoleAssignment[]; error?: string };
      if (rolesData.error) throw new Error(rolesData.error);
      const modelsData = await modelsRes.json() as { modelList?: ModelEntry[] };
      setRoles(rolesData.roles ?? []);
      setModels(modelsData.modelList ?? []);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const assign = useCallback(async (role: string, selector: string | null) => {
    if (!cwd) return;
    setPendingRole(role);
    setError(null);
    try {
      const res = await fetch("/api/model-roles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, role, selector, scope }),
      });
      const data = await res.json() as { roles?: ModelRoleAssignment[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRoles(data.roles ?? []);
      onRolesChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingRole(null);
    }
  }, [cwd, scope, onRolesChanged]);

  const visibleRoles = useMemo(() => roles.filter((role) => !role.hidden), [roles]);

  if (!cwd) {
    return <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("roles.needsProject")}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
          {t("roles.title")}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {t("roles.description")}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("roles.scope")}</span>
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
          {SCOPES.map((option) => (
            <button
              key={option}
              onClick={() => setScope(option)}
              style={{
                padding: "4px 10px",
                border: "none",
                background: scope === option ? "var(--bg-selected)" : "transparent",
                color: scope === option ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: scope === option ? 600 : 400,
              }}
            >
              {option === "global" ? t("roles.scopeGlobal") : t("roles.scopeProject")}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
          {scope === "global" ? "~/.omp/agent/config.yml" : ".omp/config.yml"}
        </span>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: "var(--danger, #ff4757)" }}>{error}</div>
      )}

      {loading ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("i18n.loading")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {visibleRoles.map((role) => {
            const current = role.resolved ? `${role.resolved.provider}/${role.resolved.modelId}` : "";
            return (
              <div
                key={role.role}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  background: "var(--bg-panel)",
                }}
              >
                <span style={{
                  flexShrink: 0,
                  minWidth: 62,
                  padding: "2px 6px",
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                  background: "var(--bg-subtle)",
                  color: "var(--accent)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textAlign: "center",
                }}>
                  {role.tag ?? role.role.toUpperCase()}
                </span>

                <div style={{ minWidth: 0, flex: "0 0 auto", width: 128 }}>
                  <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 600 }}>{role.name}</div>
                  <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
                    {t(`roles.source.${role.source}`)}
                  </div>
                </div>

                <select
                  value={current}
                  disabled={pendingRole === role.role}
                  onChange={(e) => assign(role.role, e.target.value || null)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "5px 8px",
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  <option value="">{t("roles.unset")}</option>
                  {models.map((model) => (
                    <option key={selectorFor(model)} value={selectorFor(model)}>
                      {model.name} — {model.provider}
                    </option>
                  ))}
                  {/* A selector configured outside the enabled scope still needs
                      to render as the current value instead of silently resetting. */}
                  {current && !models.some((model) => selectorFor(model) === current) && (
                    <option value={current}>{current}</option>
                  )}
                </select>

                {role.warning && (
                  <span title={role.warning} style={{ color: "var(--warning, #ffb347)", fontSize: 12 }}>!</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
