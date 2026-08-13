"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { X } from "lucide-react";

export type DialogSize = "confirm" | "request" | "editor" | "tool" | "terminal";

export function DialogShell({
  size,
  title,
  ariaLabel,
  subtitle,
  onClose,
  dismissible = true,
  backdropDismissible = dismissible,
  returnFocusRef,
  showClose = false,
  bodyClassName,
  footer,
  children,
}: {
  size: DialogSize;
  title?: ReactNode;
  ariaLabel?: string;
  subtitle?: ReactNode;
  onClose(): void;
  dismissible?: boolean;
  backdropDismissible?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  showClose?: boolean;
  bodyClassName?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      (returnFocusRef?.current ?? previousFocusRef.current)?.focus({ preventScroll: true });
    };
  }, []);

  const handleCancel = (event: React.SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (dismissible) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="codex-dialog"
      data-size={size}
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : ariaLabel}
      onCancel={handleCancel}
      onClick={(event) => {
        if (backdropDismissible && event.target === event.currentTarget) onClose();
      }}
    >
      {(title || subtitle || showClose) && (
        <header className="codex-dialog-header">
          <div className="codex-dialog-heading">
            {title && <h2 id={titleId}>{title}</h2>}
            {subtitle && <div className="codex-dialog-subtitle">{subtitle}</div>}
          </div>
          {showClose && (
            <button type="button" className="codex-dialog-close" onClick={onClose} disabled={!dismissible} aria-label={ariaLabel ?? "Close"} title={ariaLabel ?? "Close"}>
              <X size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </header>
      )}
      <div className={`codex-dialog-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div>
      {footer && <footer className="codex-dialog-footer">{footer}</footer>}
    </dialog>
  );
}
