"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";

interface ImagePreviewProps {
  src: string;
  alt?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function ImagePreview({ src, alt = "", children, className, style }: ImagePreviewProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = triggerRef.current;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      if (trigger?.isConnected) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [open]);

  const closePreview = () => {
    if (dialogRef.current?.open) dialogRef.current.close();
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        style={{
          display: "block",
          padding: 0,
          border: "none",
          background: "none",
          color: "inherit",
          cursor: "zoom-in",
          ...style,
        }}
        onClick={() => setOpen(true)}
        aria-label={t("chat.previewImage")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("chat.previewImage")}
      >
        {children}
      </button>
      {open && (
        <dialog
          ref={dialogRef}
          className="codex-viewer image-preview-dialog"
          aria-label={t("chat.previewImage")}
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            closePreview();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            closePreview();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closePreview();
          }}
        >
          <img className="image-preview-image" src={src} alt={alt} />
          <button
            ref={closeButtonRef}
            type="button"
            className="codex-viewer-close image-preview-close"
            onClick={closePreview}
            aria-label={t("chat.close")}
            title={t("chat.close")}
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </dialog>
      )}
    </>
  );
}
