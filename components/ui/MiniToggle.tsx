"use client";

import type React from "react";

/**
 * 通用小型开关。从 PromptsConfig 抽出，供面板三点菜单的 L2 功能开关复用。
 * 无障碍：role="switch" + aria-checked。
 *
 * 历史原址：components/PromptsConfig.tsx 内联定义，仅 PromptsConfig 使用。
 * 抽出后 TodoPanel 三点菜单、未来面板均可复用，避免重复实现。
 */
export function MiniToggle({
  enabled,
  disabled,
  onToggle,
  title,
  ariaLabel,
}: {
  enabled: boolean;
  disabled?: boolean;
  onToggle: (e: React.MouseEvent) => void;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-checked={enabled}
      aria-label={ariaLabel}
      role="switch"
      title={title}
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
          background: "var(--accent-text)",
          transition: "left 0.18s",
        }}
      />
    </button>
  );
}
