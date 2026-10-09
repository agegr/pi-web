"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { interactivePreviewDocument, interactivePreviewError, interactivePreviewHeight, type InteractivePreviewError } from "@/lib/interactive-preview";
import { useI18n } from "@/hooks/useI18n";
import { CloseIcon, EyeIcon, RefreshIcon, SpinnerIcon } from "./SidebarIcons";
import { CodeBlock } from "./MermaidBlock";

export function InteractivePreview({ code, isStreaming, complete }: {
  code: string;
  isStreaming?: boolean;
  complete: boolean;
}) {
  const { t } = useI18n();
  const [showSource, setShowSource] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [run, setRun] = useState(0);
  const [errors, setErrors] = useState<InteractivePreviewError[]>([]);
  const [copied, setCopied] = useState<"source" | "errors" | null>(null);
  const [frameHeight, setFrameHeight] = useState(320);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ready = complete && !isStreaming;
  const sourceVisible = showSource;
  const documentSource = useMemo(() => interactivePreviewDocument(code), [code]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !expanded) return;
    const expandButton = expandRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.close();
    dialog.showModal();
    expandButton?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      dialog.close();
      if (dialog.isConnected) dialog.show();
      expandButton?.focus({ preventScroll: true });
    };
  }, [expanded]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      if (event.data?.type === "pi-html:error") {
        const error = interactivePreviewError(event.data);
        if (error) setErrors((previous) => previous.length >= 5 || previous.some((item) =>
          item.kind === error.kind && item.message === error.message && item.line === error.line && item.column === error.column)
          ? previous : [...previous, error]);
      }
      if (event.data?.type === "pi-html:escape") setExpanded(false);
      if (event.data?.type === "pi-html:resize" && !expanded) {
        const height = interactivePreviewHeight(event.data.height);
        if (height !== null) setFrameHeight(height);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [expanded]);

  useEffect(() => {
    if (!expanded && !showSource) {
      iframeRef.current?.contentWindow?.postMessage({ type: "pi-html:measure" }, "*");
    }
  }, [expanded, showSource]);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "pi-interactive.html";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const errorText = errors.map((error) => {
    const kind = t(error.kind === "promise" ? "chat.previewPromiseError" : "chat.previewRuntimeError");
    const location = error.line === undefined ? "" : `\n${t("chat.previewErrorLocation", {
      line: error.line, column: error.column ?? "?",
    })}`;
    return `${kind}: ${error.message || t("chat.previewUnknownError")}${location}`;
  }).join("\n\n");

  const copy = async (value: string, target: "source" | "errors") => {
    try {
      await copyText(value);
      setCopied(target);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      open
      className={`interactive-preview${expanded ? " is-expanded" : ""}`}
      aria-label={t("chat.interactivePreview")}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setExpanded(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !expanded) return;
        event.preventDefault();
        event.stopPropagation();
        setExpanded(false);
      }}
    >
      <div className="markdown-code-header">
        <span className="interactive-preview-label">
          <span className="markdown-code-lang">pi-html</span>
          {isStreaming && <SpinnerIcon size={14} label={t("chat.generatingPreview")} />}
        </span>
        <div className="markdown-code-actions">
          <button type="button" className="interactive-preview-action"
            title={sourceVisible ? (ready ? t("i18n.preview") : t("chat.collapseSource")) : t("i18n.source")}
            aria-label={sourceVisible ? (ready ? t("i18n.preview") : t("chat.collapseSource")) : t("i18n.source")}
            aria-pressed={showSource} onClick={() => setShowSource((value) => !value)}>
            {sourceVisible ? <EyeIcon size={15} /> : <PreviewIcon kind="code" />}
          </button>
          <button type="button" className="interactive-preview-action" disabled={!ready}
            title={t("chat.restartPreview")} aria-label={t("chat.restartPreview")}
            onClick={() => {
              setErrors([]); setCopied(null); clearTimeout(copyTimer.current); setRun((value) => value + 1);
            }}>
            <RefreshIcon size={15} />
          </button>
          <button type="button" className="interactive-preview-action" title={t("i18n.downloadFile")}
            aria-label={t("i18n.downloadFile")} disabled={!ready} onClick={download}>
            <PreviewIcon kind="download" />
          </button>
          <button type="button" className="interactive-preview-action"
            title={copied === "source" ? t("i18n.copied") : t("i18n.copy")} aria-label={copied === "source" ? t("i18n.copied") : t("i18n.copy")}
            onClick={() => void copy(code, "source")}>
            <PreviewIcon kind={copied === "source" ? "check" : "copy"} />
          </button>
          <button ref={expandRef} type="button" className="interactive-preview-action" disabled={!ready}
            title={expanded ? t("i18n.close") : t("i18n.expand")}
            aria-label={expanded ? t("i18n.close") : t("i18n.expand")}
            aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? <CloseIcon size={15} /> : <PreviewIcon kind="expand" />}
          </button>
        </div>
      </div>
      {errors.length > 0 && <div className="interactive-preview-error">
        <div className="interactive-preview-error-heading">
          <span role="status">{t("chat.previewError")}</span>
          <button type="button" className="interactive-preview-action"
            title={copied === "errors" ? t("i18n.copied") : t("chat.copyPreviewErrors")}
            aria-label={copied === "errors" ? t("i18n.copied") : t("chat.copyPreviewErrors")}
            onClick={() => void copy(`pi-html\n${errorText}`, "errors")}>
            <PreviewIcon kind={copied === "errors" ? "check" : "copy"} />
          </button>
        </div>
        <details>
          <summary>{t("chat.previewErrorDetails")}</summary>
          <pre>{errorText}</pre>
        </details>
      </div>}
      <div className="interactive-preview-source" hidden={!sourceVisible}>
        {sourceVisible && <CodeBlock code={code} lang="html" hideHeader isStreaming={isStreaming} />}
      </div>
      <div className="interactive-preview-frame" hidden={sourceVisible || !ready}
        style={expanded ? undefined : { height: frameHeight }}>
        {ready && <iframe
          key={run}
          ref={iframeRef}
          srcDoc={documentSource}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
          title={t("chat.interactivePreview")}
        />}
      </div>
    </dialog>
  );
}

function PreviewIcon({ kind }: { kind: "code" | "copy" | "check" | "download" | "expand" }) {
  const paths = {
    code: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18",
    copy: "M9 9h12v12H9zM15 5V3H3v12h2",
    check: "m5 12 4 4L19 6",
    download: "M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4",
    expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  };
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}
