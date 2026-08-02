"use client";

// 极简配置模态/面板原语 —— 重建自上游删除的 components/ui/ConfigModal。
//
// 跟随上游重写（2026-08-02）：上游 8c51f77 删除了原 ConfigModal，而 PromptsConfig
// 依赖它。此处仅重建 PromptsConfig 实际用到的三件套（ConfigModal / ConfigListRow /
// ModalButton），并将 ConfigModal 改为「面板内嵌」形态（不再渲染全屏 fixed 遮罩），
// 以便直接挂入 WorkspacePanelsHost 的右侧面板列；关闭由宿主通过 onClose 控制。

import type { CSSProperties, ReactNode } from "react";

// ── Modal / Panel container ──────────────────────────────────────────────────

export interface ConfigModalProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose?: () => void;
  /** Kept for API compatibility; ignored in panel-embedded layout. */
  width?: number | string;
  height?: number | string;
  left?: ReactNode;
  right?: ReactNode;
  footer?: ReactNode;
}

export function ConfigModal({ title, subtitle, onClose, left, right, footer }: ConfigModalProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{title}</span>
          {subtitle != null && (
            <code
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                maxWidth: 320,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {subtitle}
            </code>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "2px 6px",
              flexShrink: 0,
            }}
            aria-label="close"
          >
            ×
          </button>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", flexDirection: "row", overflow: "hidden" }}>
        {left != null && (
          <div
            style={{
              width: 240,
              flexShrink: 0,
              borderRight: "1px solid var(--border)",
              overflowY: "auto",
              padding: 10,
            }}
          >
            {left}
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>{right}</div>
      </div>

      {/* Footer */}
      {footer != null && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
            padding: "10px 16px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}

// ── List row ─────────────────────────────────────────────────────────────────

export function ConfigListRow({
  selected,
  onClick,
  children,
  leading,
  hoverable = true,
  className,
  style,
}: {
  selected: boolean;
  onClick?: () => void;
  children: ReactNode;
  leading?: ReactNode;
  hoverable?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      onClick={onClick}
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 8px",
        borderRadius: 5,
        cursor: hoverable ? "pointer" : "default",
        background: selected ? "var(--bg-selected)" : "none",
        ...style,
      }}
      onMouseEnter={(e) => {
        if (hoverable && !selected) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (hoverable && !selected) e.currentTarget.style.background = "none";
      }}
    >
      {leading}
      {children}
    </div>
  );
}

// ── Footer buttons ────────────────────────────────────────────────────────────

type ModalButtonVariant = "primary" | "secondary" | "danger";

export function ModalButton({
  variant = "secondary",
  onClick,
  children,
  disabled,
  title,
  type = "button",
}: {
  variant?: ModalButtonVariant;
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  const variants: Record<ModalButtonVariant, CSSProperties> = {
    primary: { background: "var(--accent)", color: "#fff", border: "none" },
    secondary: {
      background: "none",
      border: "1px solid var(--border)",
      color: "var(--text-muted)",
    },
    danger: {
      background: "none",
      border: "1px solid rgba(239,68,68,0.3)",
      color: "#ef4444",
    },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: "6px 14px",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...variants[variant],
      }}
    >
      {children}
    </button>
  );
}
