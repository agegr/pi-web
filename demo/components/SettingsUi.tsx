"use client";

import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";

type ConfigButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ConfigButtonSize = "small" | "default";

interface ConfigPanelShellProps {
  embedded: boolean;
  title: string;
  subtitle?: string;
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  height?: string;
}

export function ConfigPanelShell({
  embedded,
  title,
  subtitle,
  closeLabel = "Close",
  onClose,
  children,
  width = 900,
  height = "78vh",
}: ConfigPanelShellProps) {
  const panelStyle = embedded
    ? undefined
    : ({
        "--config-panel-width": `${width}px`,
        "--config-panel-height": height,
      } as CSSProperties);

  return (
    <div
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : "true"}
      aria-label={title}
      className={`config-panel-root ${embedded ? "is-embedded" : "is-modal"}`}
      onClick={(event) => {
        if (!embedded && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="config-panel-surface" style={panelStyle}>
        {!embedded && (
          <div className="config-panel-header">
            <strong className="config-panel-title">{title}</strong>
            {subtitle && (
              <code className="config-panel-subtitle" title={subtitle}>
                {subtitle}
              </code>
            )}
            <button
              type="button"
              className="config-close-button"
              onClick={onClose}
              title={closeLabel}
              aria-label={closeLabel}
            >
              ×
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function ConfigSplitView({ children }: { children: ReactNode }) {
  return <div className="config-split-view">{children}</div>;
}

export function ConfigSidebar({ children }: { children: ReactNode }) {
  return <aside className="config-sidebar">{children}</aside>;
}

export function ConfigSidebarList({ children }: { children: ReactNode }) {
  return <div className="config-sidebar-list">{children}</div>;
}

/** A sidebar group heading; `aside` sits at its right edge. */
export function ConfigSidebarGroupLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="config-sidebar-group-label">
      <span className="config-sidebar-group-label-text">{children}</span>
      {aside}
    </div>
  );
}

/**
 * Switches every row of a sidebar group at once, for a group heading's
 * `aside`. Like the provider switch in the Models panel it is on only while
 * every row is, so a partial group reads as off beside its count and one click
 * completes it; on, a click switches the whole group off.
 */
export function ConfigSidebarGroupSwitch({
  enabled,
  total,
  label,
  disabled = false,
  loading = false,
  onChange,
}: {
  enabled: number;
  total: number;
  label: string;
  disabled?: boolean;
  loading?: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <span className="config-sidebar-group-switch">
      <span className="config-sidebar-group-count">{enabled}/{total}</span>
      <ConfigSwitch
        size="small"
        checked={total > 0 && enabled === total}
        disabled={disabled}
        loading={loading}
        label={label}
        onChange={onChange}
      />
    </span>
  );
}

/** What the last group switch left undone, under that group's heading. */
export function ConfigSidebarGroupStatus({ error, note }: { error?: string | null; note?: string | null }) {
  if (!error && !note) return null;
  return (
    <div className="config-sidebar-group-status">
      {note && <div role="status" className="config-sidebar-group-note">{note}</div>}
      {error && <div role="alert" className="config-sidebar-group-error">{error}</div>}
    </div>
  );
}

export function ConfigSidebarItem({
  active = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      aria-current={active ? "page" : undefined}
      className={["config-sidebar-item", className].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}

export function ConfigSidebarText({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className={["config-sidebar-text", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailStack({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["config-detail-stack", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["config-detail-header", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailHeaderInfo({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["config-detail-header-info", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={["config-detail-actions", className].filter(Boolean).join(" ")}
    />
  );
}

export function ConfigDetailTitle({ children }: { children: ReactNode }) {
  return <div className="config-detail-title">{children}</div>;
}

export function ConfigSectionTitle({ children }: { children: ReactNode }) {
  return <div className="config-section-title">{children}</div>;
}

export function ConfigField({ label, children, style }: { label: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="config-field" style={style}>
      <span className="config-field-label">{label}</span>
      {children}
    </div>
  );
}

export function ConfigEmptyState({ children }: { children: ReactNode }) {
  return <div className="config-empty-state">{children}</div>;
}

export function ConfigDetail({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="config-detail" style={style}>
      {children}
    </div>
  );
}

export function ConfigFooter({ status, children }: { status?: ReactNode; children?: ReactNode }) {
  return (
    <footer className="config-footer">
      <div className="config-footer-status">{status}</div>
      <div className="config-footer-actions">{children}</div>
    </footer>
  );
}

export function ConfigButton({
  variant = "secondary",
  size = "default",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ConfigButtonVariant; size?: ConfigButtonSize }) {
  return (
    <button
      type="button"
      {...props}
      className={[
        "config-button",
        `config-button-${variant}`,
        `config-button-${size}`,
        className,
      ].filter(Boolean).join(" ")}
    >
      {children}
    </button>
  );
}

export function ConfigSwitch({
  checked,
  disabled = false,
  loading = false,
  size = "default",
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  loading?: boolean;
  size?: "default" | "small";
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const inactive = disabled || loading;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={loading || undefined}
      aria-label={label}
      title={label}
      disabled={inactive}
      className={`config-switch${size === "small" ? " is-small" : ""}${loading ? " is-loading" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="config-switch-knob" aria-hidden="true" />
    </button>
  );
}

export function ConfigListAction({ active = false, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <div className="config-list-action">
      <button
        type="button"
        {...props}
        aria-current={active ? "page" : undefined}
        className={["config-list-action-button", className].filter(Boolean).join(" ")}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {children}
      </button>
    </div>
  );
}

/** A banner above a panel's split view; `action` sits at its right edge. `id` lets a control it explains point at it. */
export function ConfigNotice({ id, action, children }: { id?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div id={id} role="status" className={`config-notice${action ? " has-action" : ""}`}>
      {action ? <span className="config-notice-text">{children}</span> : children}
      {action}
    </div>
  );
}

/**
 * A detail pane's two-column label/value grid. Each row is a
 * `ConfigDetailGridRow`; values wrap anywhere so a long path never widens the
 * pane.
 */
export function ConfigDetailGrid({ children }: { children: ReactNode }) {
  return <div className="config-detail-grid">{children}</div>;
}

export function ConfigDetailGridRow({
  label,
  tone = "muted",
  mono = false,
  className,
  style,
  children,
}: {
  label: ReactNode;
  /** `plain` leaves the color to the value's own children or `style`. */
  tone?: "plain" | "muted" | "dim" | "error";
  mono?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <>
      <div className="config-detail-grid-label">{label}</div>
      <div
        className={[
          "config-detail-grid-value",
          tone === "plain" ? null : `is-${tone}`,
          mono ? "is-mono" : null,
          className,
        ].filter(Boolean).join(" ")}
        style={style}
      >
        {children}
      </div>
    </>
  );
}

/** Where a row lives (`global`, `project`, …); a project scope is tinted. */
export function ConfigScopeTag({ scope, children }: { scope: string; children: ReactNode }) {
  return (
    <span className={`config-scope-tag${scope === "project" ? " is-project" : ""}`}>
      {children}
    </span>
  );
}

export function ConfigStatusDot({ active, color }: { active?: boolean; color?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`config-status-dot${active ? " is-active" : active === false ? " is-inactive" : ""}`}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}
