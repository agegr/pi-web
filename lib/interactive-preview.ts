export const INTERACTIVE_PREVIEW_LANGUAGE = "pi-html";

/** Reject pathological untrusted reports without imposing a normal preview size. */
export function interactivePreviewHeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100_000) return null;
  return Math.ceil(value);
}

export interface InteractivePreviewError {
  kind: "runtime" | "promise";
  message: string;
  line?: number;
  column?: number;
}

/** Reports are untrusted even when they originate from the expected frame. */
export function interactivePreviewError(value: unknown): InteractivePreviewError | null {
  if (!value || typeof value !== "object") return null;
  const report = value as Record<string, unknown>;
  if ((report.kind !== "runtime" && report.kind !== "promise") || typeof report.message !== "string") return null;
  const message = report.message.slice(0, 1000).replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  const validPosition = (position: unknown): position is number =>
    typeof position === "number" && Number.isInteger(position) && position > 0 && position <= 1_000_000;
  const line = validPosition(report.line) ? report.line - INTERACTIVE_PREVIEW_PREFIX.split("\n").length + 1 : undefined;
  return {
    kind: report.kind,
    message,
    ...(line !== undefined && line > 0 ? {
      line,
      ...(validPosition(report.column) ? { column: report.column } : {}),
    } : {}),
  };
}

/** Use the Markdown parser's source range to require an explicitly closed fence. */
export function isCompleteInteractiveFence(
  markdown: string,
  position?: { start: { offset?: number; line?: number }; end: { offset?: number; line?: number } },
  code?: string,
): boolean {
  if (position?.start.offset === undefined || position.end.offset === undefined) return false;
  const source = markdown.slice(position.start.offset, position.end.offset);
  if (code !== undefined && position.start.line !== undefined && position.end.line !== undefined) {
    const contentLines = code ? code.split(/\r?\n/).length : 0;
    if (position.end.line - position.start.line <= contentLines) return false;
  }
  const opener = /^(`{3,}|~{3,})pi-html(?:[ \t]+[^\r\n]*)?\r?\n/i.exec(source);
  if (!opener) return false;
  const lastLine = source.slice(source.lastIndexOf("\n") + 1);
  const closer = /(?:^|[\s>])(`{3,}|~{3,})[ \t]*$/.exec(lastLine);
  return Boolean(closer && closer[1][0] === opener[1][0] && closer[1].length >= opener[1].length);
}

// The policy precedes all generated markup, so later meta tags cannot relax it.
export const INTERACTIVE_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const INTERACTIVE_PREVIEW_PREFIX = `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${INTERACTIVE_PREVIEW_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 16px; box-sizing: border-box; font: 14px/1.5 system-ui, sans-serif; overflow-wrap: break-word; }
  img, canvas, svg { max-width: 100%; }
</style>
<script>
  (function () {
  var reportedErrors = [];
  function reportError(kind, message, line, column) {
    if (reportedErrors.length >= 5) return;
    var report = { type: 'pi-html:error', kind: kind,
      message: typeof message === 'string' ? message.slice(0, 1000) : '',
      line: line, column: column };
    reportedErrors.push(report);
    parent.postMessage(report, '*');
  }
  addEventListener('error', function (event) {
    reportError('runtime', event.message,
      event.filename === 'about:srcdoc' ? event.lineno : undefined,
      event.filename === 'about:srcdoc' ? event.colno : undefined);
  });
  addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    var message = typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : '';
    var position = reason instanceof Error && typeof reason.stack === 'string'
      ? /about:srcdoc:(\\d+):(\\d+)/.exec(reason.stack) : null;
    reportError('promise', message, position ? Number(position[1]) : undefined,
      position ? Number(position[2]) : undefined);
  });
  addEventListener('keydown', function (event) {
    if (event.key === 'Escape') parent.postMessage({ type: 'pi-html:escape' }, '*');
  });
  addEventListener('DOMContentLoaded', function () {
    var scheduled = false;
    var previousHeight = 0;
    function measure() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        var body = document.body;
        var bounds = body.getBoundingClientRect();
        var marginBottom = parseFloat(getComputedStyle(body).marginBottom) || 0;
        var height = Math.ceil(Math.max(body.scrollHeight, bounds.height) + bounds.top + scrollY + marginBottom);
        if (height > 0 && height !== previousHeight) {
          previousHeight = height;
          parent.postMessage({ type: 'pi-html:resize', height: height }, '*');
        }
      });
    }
    new ResizeObserver(measure).observe(document.body);
    new MutationObserver(measure).observe(document.body, {
      attributes: true, childList: true, characterData: true, subtree: true
    });
    addEventListener('resize', measure);
    addEventListener('message', function (event) {
      if (event.source !== parent || event.data?.type !== 'pi-html:measure') return;
      reportedErrors.forEach(function (report) { parent.postMessage(report, '*'); });
      previousHeight = 0;
      measure();
    });
    measure();
  });
  })();
</script>
`;

export function interactivePreviewDocument(code: string): string {
  return INTERACTIVE_PREVIEW_PREFIX + code;
}
