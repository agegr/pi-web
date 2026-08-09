"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  return (
    <>
      <button
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
        title={t("chat.previewImage")}
      >
        {children}
      </button>
      {open && portalTarget && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("chat.previewImage")}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            background: "rgba(0, 0, 0, 0.72)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            style={{
              display: "block",
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              borderRadius: 8,
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.4)",
            }}
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("chat.close")}
            title={t("chat.close")}
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              width: 34,
              height: 34,
              border: "1px solid rgba(255, 255, 255, 0.5)",
              borderRadius: "50%",
              background: "rgba(0, 0, 0, 0.45)",
              color: "#fff",
              cursor: "pointer",
              fontSize: 24,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>,
        portalTarget,
      )}
    </>
  );
}
