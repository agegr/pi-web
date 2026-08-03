"use client";

import { useI18n } from "@/hooks/useI18n";
import { type PlanConfigSlice, type ControllerMode } from "@/lib/plan-mode-store";
import { Slider } from "./Slider";

export function ConfigSection({
  planConfig,
  onConfig,
  roles,
  modelOptions,
  roleModels,
  onRoleModel,
}: {
  planConfig: PlanConfigSlice;
  onConfig: (patch: Partial<PlanConfigSlice>) => void;
  roles: Array<{ id: string; name: string; modelId: string | null }>;
  modelOptions: Array<{ id: string; name: string; provider: string }>;
  roleModels: Record<string, string>;
  onRoleModel: (roleId: string, modelId: string) => void;
}) {
  const { t } = useI18n();
  const modes: ControllerMode[] = ["hybrid", "deterministic", "llm"];
  return (
    <div
      style={{
        borderBottom: "1px solid var(--border)",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "color-mix(in srgb, var(--bg) 60%, transparent)",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("plan.configHint")}</div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--text)", width: 84, flexShrink: 0 }}>
          {t("plan.controllerMode")}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {modes.map((m) => {
            const active = planConfig.controllerMode === m;
            return (
              <button
                key={m}
                onClick={() => onConfig({ controllerMode: m })}
                style={{
                  padding: "3px 9px",
                  borderRadius: 7,
                  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  background: active
                    ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                    : "none",
                  color: active ? "var(--text)" : "var(--text-muted)",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {t(`plan.controller.${m}`)}
              </button>
            );
          })}
        </div>
      </div>

      <Slider
        label={t("plan.maxRounds")}
        min={1}
        max={8}
        value={planConfig.maxRounds}
        onChange={(v) => onConfig({ maxRounds: v })}
      />
      <Slider
        label={t("plan.stabilizeThreshold")}
        min={0.5}
        max={0.99}
        step={0.01}
        value={planConfig.stabilizeThreshold}
        onChange={(v) => onConfig({ stabilizeThreshold: v })}
      />
      <Slider
        label={t("plan.concurrency")}
        min={1}
        max={4}
        value={planConfig.concurrency}
        onChange={(v) => onConfig({ concurrency: v })}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>
          {t("plan.roleModel")}
        </span>
        {roles.length === 0 ? (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("plan.emptyHistory")}</span>
        ) : (
          roles.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", width: 90, flexShrink: 0 }}>
                {r.name}
              </span>
              <select
                value={roleModels[r.id] ?? ""}
                onChange={(e) => void onRoleModel(r.id, e.target.value)}
                style={{
                  flex: 1,
                  background: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 11,
                  padding: "3px 6px",
                }}
              >
                <option value="">{t("plan.roleModelDefault")}</option>
                {modelOptions.map((m) => (
                  <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
