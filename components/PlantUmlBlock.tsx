"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { plantUmlSvgUrl } from "@/lib/plantuml";
import { CodeBlock, DiagramZoomDialog, PreviewFrame, PreviewToggleButton } from "./MermaidBlock";

/**
 * A ```plantuml fence: the source, and a button naming plantuml.com that
 * renders it there. Nothing leaves the page before that click, which is per
 * block and never remembered. The picture is only ever an <img> (no script,
 * nothing it links to loads), sent with no referrer.
 */
export function PlantUmlBlock({ code, lang, isStreaming }: { code: string; lang: string; isStreaming?: boolean }) {
  const { t } = useI18n();
  const [showPreview, setShowPreview] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  // url null: too long to send.
  const [encoded, setEncoded] = useState<{ code: string; url: string | null } | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const previewVisible = showPreview && !isStreaming;
  const current = encoded?.code === code ? encoded : null;

  useEffect(() => {
    if (!previewVisible || current) return;
    let cancelled = false;
    plantUmlSvgUrl(code).then((url) => {
      if (!cancelled) setEncoded({ code, url });
    });
    return () => {
      cancelled = true;
    };
  }, [code, current, previewVisible]);

  const previewButton = useMemo(() => (
    <PreviewToggleButton
      isStreaming={isStreaming}
      previewVisible={previewVisible}
      onToggle={() => {
        // Showing it again retries a failed load.
        setFailedUrl(null);
        setShowPreview((v) => !v);
      }}
      title={previewVisible ? t("i18n.showPlantUmlSource") : t("i18n.renderOnPlantUml")}
      previewLabel={t("i18n.renderOnPlantUml")}
    />
  ), [isStreaming, previewVisible, t]);

  if (!previewVisible) {
    return <CodeBlock code={code} lang={lang} headerAction={previewButton} isStreaming={isStreaming} />;
  }

  const url = current?.url;
  const loaded = !!url && loadedUrl === url;
  const image = (className: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url ?? undefined}
      alt={t("i18n.plantUmlDiagram")}
      className={className}
      referrerPolicy="no-referrer"
      // A diagram with a syntax error still loads: the server draws the error.
      onLoad={() => setLoadedUrl(url ?? null)}
      onError={() => setFailedUrl(url ?? null)}
    />
  );

  return (
    <PreviewFrame lang={lang} actions={previewButton}>
      {current && current.url === null ? (
        <div className="mermaid-block mermaid-block-error">{t("i18n.plantUmlTooLong")}</div>
      ) : url && failedUrl === url ? (
        <div className="mermaid-block mermaid-block-error">{t("i18n.plantUmlLoadFailed")}</div>
      ) : (
        <>
          {!loaded && <div className="mermaid-block mermaid-block-loading" />}
          {url && !zoomOpen && (
            <button
              type="button"
              className="mermaid-block mermaid-preview-button"
              title={t("i18n.openPlantUmlViewer")}
              aria-label={t("i18n.openPlantUmlViewer")}
              // Hidden, the image still loads; the placeholder shows meanwhile.
              hidden={!loaded}
              onClick={() => setZoomOpen(true)}
            >
              {image("svg-block-image")}
            </button>
          )}
          {url && zoomOpen && (
            <DiagramZoomDialog title={t("i18n.plantUmlDiagram")} label={t("i18n.plantUmlViewer")} onClose={() => setZoomOpen(false)}>
              {image("svg-zoom-image")}
            </DiagramZoomDialog>
          )}
        </>
      )}
    </PreviewFrame>
  );
}
