"use client";

import type { ReactNode, Ref } from "react";

/** The parts of a keydown the paste box decides on. */
export interface OAuthPasteKey {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  /** True while an input method composes text: its Enter commits the text, nothing more. */
  isComposing: boolean;
  /** 229 while an input method handles the key: Safari reports the Enter that commits a composition with `isComposing` false. */
  keyCode: number;
}

/**
 * Whether a key submits the box: Enter, never while an input method composes,
 * and only with Cmd or Ctrl unless `plainEnterSubmits`.
 */
export function oauthPasteKeySubmits(event: OAuthPasteKey, plainEnterSubmits: boolean): boolean {
  if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return false;
  return plainEnterSubmits || event.metaKey || event.ctrlKey;
}

/**
 * The paste step of a sign-in started on the server: what to do, an optional
 * line with a link to the sign-in page for when no browser window opened, and
 * one box for the redirected address or code. The box is always shown, since
 * a remote or phone browser cannot reach the server's own callback listener.
 * The button submits a non-empty value, and so does Enter, or only Cmd/Ctrl+Enter
 * when `plainEnterSubmits` is false; `disabled` holds both while a value is
 * being checked.
 */
export function OAuthPastePanel({
  message,
  hint,
  value,
  placeholder,
  submitLabel,
  inputLabel,
  disabled = false,
  plainEnterSubmits = true,
  inputRef,
  onValueChange,
  onSubmit,
}: {
  message: ReactNode;
  hint?: ReactNode;
  value: string;
  placeholder: string;
  submitLabel: string;
  /** The box's accessible name, when the placeholder alone would be its only label. */
  inputLabel?: string;
  disabled?: boolean;
  /** False: a plain Enter does nothing, and Cmd/Ctrl+Enter or the button submits, as in Settings › MCP's paste boxes. */
  plainEnterSubmits?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const canSubmit = !disabled && value.trim().length > 0;
  return (
    <div className="oauth-paste-panel">
      <p className="oauth-paste-message">{message}</p>
      {hint && <p className="oauth-paste-hint">{hint}</p>}
      <div className="oauth-paste-row">
        <input
          ref={inputRef}
          value={value}
          className="oauth-paste-input"
          placeholder={placeholder}
          aria-label={inputLabel}
          disabled={disabled || undefined}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            const submits = oauthPasteKeySubmits({
              key: event.key,
              metaKey: event.metaKey,
              ctrlKey: event.ctrlKey,
              isComposing: event.nativeEvent.isComposing,
              keyCode: event.keyCode,
            }, plainEnterSubmits);
            if (submits && canSubmit) onSubmit();
          }}
        />
        <button type="button" className="oauth-paste-submit" onClick={onSubmit} disabled={!canSubmit}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
