"use client";

import { STAGES } from "@/lib/unified-engine/unified-engine-types";
import type { Stage } from "@/lib/unified-engine/unified-engine-types";
import { useI18n } from "@/hooks/useI18n";

export function StageStepper({ current, running }: { current: Stage; running?: boolean }) {
  const { t } = useI18n();
  const idx = STAGES.indexOf(current);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {STAGES.map((s, i) => {
        const active = i === idx;
        const done = i < idx;
        const pulsing = active && running;
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                background: active
                  ? "var(--accent)"
                  : done
                    ? "color-mix(in srgb, var(--accent) 45%, transparent)"
                    : "var(--bg-hover)",
                color: active || done ? "#fff" : "var(--text-dim)",
                boxShadow: pulsing
                  ? "0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent)"
                  : active
                    ? "0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent)"
                    : "none",
                animation: pulsing ? "enginePulse 1.4s ease-in-out infinite" : "none",
                transition: "all .2s ease",
              }}
            >
              {i + 1}
            </div>
            <span
              style={{
                fontSize: 13,
                color: active ? "var(--text)" : "var(--text-dim)",
                fontWeight: active ? 600 : 400,
              }}
            >
              {t(`engine.stage.${s}`)}
            </span>
            {i < STAGES.length - 1 && (
              <div
                style={{
                  width: 22,
                  height: 2,
                  background: done ? "var(--accent)" : "var(--border)",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
