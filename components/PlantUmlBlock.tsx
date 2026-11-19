"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { plantUmlSvgUrl } from "@/lib/plantuml";
import { CodeBlock, DiagramZoomDialog, PreviewFrame, PreviewToggleButton } from "./MermaidBlock";

/**
 * The sources the user chose to render on plantuml.com, for the page's life:
 * a block that remounts (a session opened again) starts with the picture of
 * one. A block's preview is tied to its source, never to the block, so a block
 * handed another one's state (React matches Markdown blocks by position, and a
 * fence inserted above shifts them) or whose source changed never sends a
 * source nobody approved.
 */
const approvedSources = new Set<string>();

export function approvePlantUmlSource(code: string): void {
  approvedSources.add(code);
}

export type PlantUmlResult =
  | { code: string; status: "ready"; url: string }
  | { code: string; status: "tooLong" }
  | { code: string; status: "failed" };

/**
 * A ```plantuml fence: the source, and a button naming plantuml.com that
 * renders it there. Nothing leaves the page before that click, which is per
 * source; an empty fence has no button.
 */
export function PlantUmlBlock({ code, lang, isStreaming }: { code: string; lang: string; isStreaming?: boolean }) {
  const { t } = useI18n();
  const renderable = code.trim() !== "";
  // The source this block shows the picture of: always an approved one, and
  // only while it is still the block's source.
  const [shownCode, setShownCode] = useState(() => (approvedSources.has(code) ? code : null));
  const [result, setResult] = useState<PlantUmlResult | null>(null);
  const previewVisible = renderable && shownCode === code && !isStreaming;
  const current = result?.code === code ? result : undefined;

  useEffect(() => {
    if (!previewVisible || current) return;
    let cancelled = false;
    plantUmlSvgUrl(code).then(
      (url) => {
        if (!cancelled) setResult(url ? { code, status: "ready", url } : { code, status: "tooLong" });
      },
      () => {
        if (!cancelled) setResult({ code, status: "failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code, current, previewVisible]);

  const previewButton = useMemo(() => (
    <PreviewToggleButton
      isStreaming={isStreaming}
      previewVisible={previewVisible}
      onToggle={() => {
        if (previewVisible) {
          setShownCode(null);
        } else {
          approvePlantUmlSource(code);
          setShownCode(code);
        }
      }}
      title={previewVisible ? t("i18n.showPlantUmlSource") : t("i18n.renderOnPlantUml")}
      previewLabel={t("i18n.renderOnPlantUml")}
    />
  ), [code, isStreaming, previewVisible, t]);

  if (!previewVisible) {
    return <CodeBlock code={code} lang={lang} headerAction={renderable ? previewButton : undefined} isStreaming={isStreaming} />;
  }

  return (
    <PreviewFrame lang={lang} actions={previewButton}>
      <PlantUmlPreviewBody result={current} />
    </PreviewFrame>
  );
}

/** The preview's body: undefined while the source is being encoded. */
export function PlantUmlPreviewBody({ result }: { result: PlantUmlResult | undefined }) {
  const { t } = useI18n();
  if (!result) return <div className="mermaid-block mermaid-block-loading" aria-label={t("i18n.renderingPlantUml")} />;
  if (result.status === "tooLong") return <div className="mermaid-block mermaid-block-error">{t("i18n.plantUmlTooLong")}</div>;
  if (result.status === "failed") return <div className="mermaid-block mermaid-block-error">{t("i18n.plantUmlLoadFailed")}</div>;
  // Keyed by URL: another source starts with no load state and a closed viewer.
  return <PlantUmlImage key={result.url} url={result.url} />;
}

/**
 * The server's SVG, only ever as an <img> (no script runs, nothing it links
 * to loads), sent with no referrer. A failed load stays failed until the block
 * is shown again (Source, then Render), which mounts a new one.
 */
function PlantUmlImage({ url }: { url: string }) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);

  if (failed) return <div className="mermaid-block mermaid-block-error">{t("i18n.plantUmlLoadFailed")}</div>;

  const image = (className: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={t("i18n.plantUmlDiagram")}
      className={className}
      referrerPolicy="no-referrer"
      // plantuml.com answers a syntax error with HTTP 400 and an SVG of the
      // error. Headless Chrome draws that body (onLoad); an engine that
      // refuses an image with an error status lands in onError instead.
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  );

  return (
    <>
      {!loaded && <div className="mermaid-block mermaid-block-loading" aria-label={t("i18n.renderingPlantUml")} />}
      {!zoomOpen && (
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
      {zoomOpen && (
        <DiagramZoomDialog title={t("i18n.plantUmlDiagram")} label={t("i18n.plantUmlViewer")} onClose={() => setZoomOpen(false)}>
          {image("svg-zoom-image")}
        </DiagramZoomDialog>
      )}
    </>
  );
}
