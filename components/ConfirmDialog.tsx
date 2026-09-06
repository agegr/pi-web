"use client";

import { useCallback, useState, type ReactNode } from "react";

export interface ConfirmOptions {
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
}

/**
 * In-app replacement for window.confirm, styled to match the panel theme.
 * `const { confirm, element } = useConfirmDialog();` then render `element`
 * anywhere in the component tree and `await confirm({ message })`.
 */
export function useConfirmDialog(): { confirm: (opts: ConfirmOptions) => Promise<boolean>; element: ReactNode } {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...opts, resolve })),
    [],
  );

  const close = useCallback((v: boolean) => {
    setState((prev) => {
      prev?.resolve(v);
      return null;
    });
  }, []);

  const element: ReactNode = state ? (
    <div
      onClick={() => close(false)}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") close(false); }}
        style={{
          background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8,
          padding: 16, maxWidth: 360, width: "100%",
          boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
        }}
      >
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--text)", whiteSpace: "pre-wrap" }}>
          {state.message}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button
            type="button"
            onClick={() => close(false)}
            style={{
              padding: "5px 12px", background: "none", border: "1px solid var(--border)",
              borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", fontSize: 12,
            }}
          >
            {state.cancelText ?? "Cancel"}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => close(true)}
            style={{
              padding: "5px 14px", border: "none", borderRadius: 5, cursor: "pointer",
              fontSize: 12, fontWeight: 600,
              background: state.danger ? "#ef4444" : "var(--accent, #4ade80)",
              color: state.danger ? "#fff" : "#0b0f0c",
            }}
          >
            {state.confirmText ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, element };
}
