"use client";

import { Fragment, useEffect, useId, useRef } from "react";
import type { ButtonHTMLAttributes, ClipboardEvent, CSSProperties, HTMLAttributes, ReactNode, Ref } from "react";

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
 * completes it; on, a click switches the whole group off. `checked` replaces
 * that rule for a group holding rows no switch can turn on, which would
 * otherwise keep it off for good.
 */
export function ConfigSidebarGroupSwitch({
  enabled,
  total,
  checked,
  label,
  disabled = false,
  loading = false,
  describedBy,
  onChange,
}: {
  enabled: number;
  total: number;
  /** Whether the switch reads on; every row on (`enabled === total`) when absent. */
  checked?: boolean;
  label: string;
  disabled?: boolean;
  loading?: boolean;
  /** The id of the visible text that says why the switch is disabled. */
  describedBy?: string;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <span className="config-sidebar-group-switch">
      <span className="config-sidebar-group-count">{enabled}/{total}</span>
      <ConfigSwitch
        checked={checked ?? (total > 0 && enabled === total)}
        disabled={disabled}
        loading={loading}
        label={label}
        describedBy={describedBy}
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

/** A sidebar row; `ref` reaches its button (a prop since React 19), so a panel can move focus to it. */
export function ConfigSidebarItem({
  active = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; ref?: Ref<HTMLButtonElement> }) {
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

export interface ConfigScopeOption<S extends string> {
  value: S;
  label: string;
  disabled?: boolean;
}

/**
 * Chooses the scope something is written to. Why an option is unavailable is
 * shown as text under the control, never only as a tooltip, which a touch
 * screen cannot show. `children` share the switch's line (the submit button,
 * where the result goes), so the reason sits under that whole line instead of
 * pulling them out of line with the switch.
 */
export function ConfigScopeSwitch<S extends string>({
  value,
  options,
  label,
  disabledReason,
  size = "default",
  onChange,
  children,
}: {
  value: S;
  options: readonly ConfigScopeOption<S>[];
  /** Names the group for assistive technology. */
  label: string;
  /** Shown while any option is disabled. */
  disabledReason?: string | null;
  size?: "default" | "small";
  onChange: (value: S) => void;
  children?: ReactNode;
}) {
  const reasonId = useId();
  const reason = disabledReason && options.some((option) => option.disabled) ? disabledReason : null;
  return (
    <div className="config-scope-switch-field">
      <div className="config-scope-switch-row">
        <div role="group" aria-label={label} className={`config-scope-switch${size === "small" ? " is-small" : ""}`}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={option.value === value}
              aria-describedby={option.disabled && reason ? reasonId : undefined}
              disabled={option.disabled}
              className="config-scope-switch-option"
              onClick={() => {
                if (!option.disabled) onChange(option.value);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        {children}
      </div>
      {reason && (
        <span id={reasonId} className="config-scope-switch-reason">
          {reason}
        </span>
      )}
    </div>
  );
}

/**
 * A path that may wrap between folders: a break opportunity after each
 * separator, so a narrow pane breaks `~/.pi/agent/agents/` before the file
 * name instead of inside it. A split, not a lookbehind, which Safari 16.2
 * cannot parse.
 */
function pathWithBreaks(path: string): ReactNode[] {
  return path.split(/([\\/])/).map((part, index) => (
    part === "/" || part === "\\" ? <Fragment key={index}>{part}<wbr /></Fragment> : part
  ));
}

/**
 * Where an add or create pane saves: the scope switch and the path that
 * choice writes to, first under the pane's title. A detail pane shows its
 * scope tag and path in that place, so every settings section reads and
 * chooses a scope in the same spot. Why an option is unavailable is visible
 * text under the line; `children` follow it (a Trust button, what saving
 * there means).
 */
export function ConfigSaveTarget<S extends string>({
  value,
  options,
  label,
  path,
  disabledReason,
  onChange,
  children,
}: {
  value: S;
  options: readonly ConfigScopeOption<S>[];
  /** Names the group for assistive technology. */
  label: string;
  /** Where the chosen scope writes, shortened for display; a string wraps between folders. */
  path: ReactNode;
  disabledReason?: string | null;
  onChange: (value: S) => void;
  children?: ReactNode;
}) {
  return (
    <div className="config-save-target">
      <ConfigScopeSwitch
        value={value}
        options={options}
        label={label}
        disabledReason={disabledReason}
        size="small"
        onChange={onChange}
      >
        <span className="config-save-target-path">{typeof path === "string" ? pathWithBreaks(path) : path}</span>
      </ConfigScopeSwitch>
      {children}
    </div>
  );
}

/**
 * Whether a key in a multiline add box submits it: Cmd/Ctrl+Enter, never a
 * plain Enter (a line break) and never while an input method composes, whose
 * Enter picks a candidate.
 */
export function addSourceKeySubmits(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  nativeEvent?: { isComposing?: boolean };
  keyCode?: number;
}): boolean {
  if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return false;
  // Safari reports a composing Enter as keyCode 229 without isComposing.
  return event.nativeEvent?.isComposing !== true && event.keyCode !== 229;
}

/** A catalog an add pane installs from: its address, its label, and an optional icon before the label. */
export interface ConfigAddSourceCatalog {
  href: string;
  label: string;
  icon?: ReactNode;
}

/**
 * The top of every add pane: its title, the catalogs it installs from as
 * links at the right of the title, and where the result is saved (a
 * `ConfigSaveTarget`) under both.
 */
export function ConfigAddSourceHeading({
  title,
  catalogs,
  target,
}: {
  title: string;
  catalogs: readonly ConfigAddSourceCatalog[];
  target: ReactNode;
}) {
  return (
    <div className="config-add-source-heading">
      <div className="config-add-source-title-row">
        <ConfigDetailTitle>{title}</ConfigDetailTitle>
        <span className="config-add-source-catalogs">
          {catalogs.map((catalog) => (
            <a key={catalog.href} href={catalog.href} target="_blank" rel="noopener noreferrer" className="config-add-source-catalog">
              {catalog.icon}
              {catalog.label}
            </a>
          ))}
        </span>
      </div>
      {target}
    </div>
  );
}

/** An example the add form offers: its text, or its text beside what it is (a format, a client). */
export type ConfigAddSourceExample = string | { label: string; value: string };

/**
 * The add form of a list-detail panel: its heading (`ConfigAddSourceHeading`:
 * the title, the catalog links, where the result is saved), one source box, the
 * caller's controls (at least the submit button) as `children`, and examples
 * that fill the box. Enter submits while `canSubmit` holds; `normalizeValue` rewrites a
 * paste or the box on blur, e.g. to drop a pasted `pi install` prefix.
 *
 * `multiline` makes the box a textarea for pasting a whole config: Enter
 * inserts a line break and Cmd/Ctrl+Enter submits (never while an input method
 * composes), the paste-box rule. The box takes focus on mount except on a
 * coarse pointer, where a phone keyboard would cover what the panel says; the
 * single-line box keeps taking it everywhere.
 */
export function ConfigAddSourcePanel({
  title,
  catalogs,
  target,
  inputLabel,
  inputId,
  placeholder,
  value,
  canSubmit,
  normalizeValue,
  onValueChange,
  onSubmit,
  examplesLabel,
  examples,
  error,
  multiline = false,
  children,
}: {
  title: string;
  catalogs: readonly ConfigAddSourceCatalog[];
  /** Where the result is saved: a `ConfigSaveTarget`. */
  target: ReactNode;
  inputLabel: string;
  inputId?: string;
  placeholder: string;
  value: string;
  canSubmit: boolean;
  normalizeValue?: (value: string) => string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  examplesLabel: string;
  examples: readonly ConfigAddSourceExample[];
  error?: string | null;
  /** A textarea instead of one line: Enter adds a line, Cmd/Ctrl+Enter submits. */
  multiline?: boolean;
  children?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!multiline) {
      inputRef.current?.focus();
      return;
    }
    if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) return;
    textareaRef.current?.focus();
  }, [multiline]);

  const onPaste = (event: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!normalizeValue) return;
    const pasted = event.clipboardData.getData("text");
    const normalized = normalizeValue(pasted);
    if (normalized === pasted) return;
    event.preventDefault();
    onValueChange(normalized);
  };

  return (
    <ConfigDetailStack className="is-fill">
      <ConfigAddSourceHeading
        title={title}
        catalogs={catalogs}
        target={target}
      />

      <ConfigField label={inputLabel}>
        {multiline ? (
          <textarea
            id={inputId}
            ref={textareaRef}
            value={value}
            aria-label={inputLabel}
            className="config-add-source-input is-multiline"
            placeholder={placeholder}
            rows={5}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(event) => onValueChange(event.target.value)}
            onPaste={onPaste}
            onBlur={(event) => {
              if (normalizeValue) onValueChange(normalizeValue(event.currentTarget.value));
            }}
            onKeyDown={(event) => {
              if (!addSourceKeySubmits(event)) return;
              event.preventDefault();
              if (canSubmit) onSubmit();
            }}
          />
        ) : (
          <input
            id={inputId}
            ref={inputRef}
            value={value}
            aria-label={inputLabel}
            className="config-add-source-input"
            placeholder={placeholder}
            onChange={(event) => onValueChange(event.target.value)}
            onPaste={onPaste}
            onBlur={(event) => {
              if (normalizeValue) onValueChange(normalizeValue(event.currentTarget.value));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSubmit) onSubmit();
            }}
          />
        )}
      </ConfigField>

      {children}

      {examples.length > 0 && (
        <div className="config-add-source-examples">
          <div className="config-add-source-examples-label">{examplesLabel}</div>
          <div className="config-add-source-example-list">
            {examples.map((example) => typeof example === "string" ? (
              <button
                key={example}
                type="button"
                className="config-add-source-example"
                onClick={() => onValueChange(example)}
              >
                {example}
              </button>
            ) : (
              <button
                key={example.value}
                type="button"
                className="config-add-source-example has-label"
                onClick={() => onValueChange(example.value)}
              >
                <span className="config-add-source-example-label">{example.label}</span>
                <span className="config-add-source-example-value">{example.value}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="config-add-source-error">
          {error}
        </div>
      )}
    </ConfigDetailStack>
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
 * Says why a panel's project resources are not loaded. The trust button
 * appears only when the caller can act on it, so the panel never offers a
 * button that does nothing.
 */
export function ConfigTrustNotice({
  id,
  message,
  trustLabel,
  trusting = false,
  onTrust,
}: {
  id?: string;
  message: string;
  trustLabel?: string;
  trusting?: boolean;
  onTrust?: () => void;
}) {
  return (
    <ConfigNotice
      id={id}
      action={onTrust && trustLabel ? (
        <ConfigButton size="small" onClick={onTrust} disabled={trusting}>
          {trustLabel}
        </ConfigButton>
      ) : undefined}
    >
      {message}
    </ConfigNotice>
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

/**
 * A footer's one-line status. With `details` the summary opens a visible
 * list, so diagnostics are readable on a touch screen instead of hiding in a
 * tooltip.
 */
export function ConfigFooterStatus({
  summary,
  tone = "default",
  details,
}: {
  summary: ReactNode;
  tone?: "default" | "warning" | "error";
  details?: readonly ReactNode[];
}) {
  const className = `config-footer-status-summary${tone === "default" ? "" : ` is-${tone}`}`;
  if (!details?.length) return <span className={className}>{summary}</span>;
  return (
    <details className="config-footer-status-details">
      <summary className={className}>{summary}</summary>
      <ul className="config-footer-status-list">
        {details.map((detail, index) => (
          <li key={index}>{detail}</li>
        ))}
      </ul>
    </details>
  );
}

/** A button; `ref` reaches it (a prop since React 19), so a panel can move focus to it. */
export function ConfigButton({
  variant = "secondary",
  size = "default",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ConfigButtonVariant; size?: ConfigButtonSize; ref?: Ref<HTMLButtonElement> }) {
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
  describedBy,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  loading?: boolean;
  size?: "default" | "small";
  label: string;
  /** The id of visible text about the switch, such as why it is disabled; never only its tooltip. */
  describedBy?: string;
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
      aria-describedby={describedBy}
      title={label}
      disabled={inactive}
      className={`config-switch${size === "small" ? " is-small" : ""}${loading ? " is-loading" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="config-switch-knob" aria-hidden="true" />
    </button>
  );
}

export function ConfigListAction({ active = false, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; ref?: Ref<HTMLButtonElement> }) {
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

export function ConfigStatusDot({ active, color }: { active?: boolean; color?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`config-status-dot${active ? " is-active" : active === false ? " is-inactive" : ""}`}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}
