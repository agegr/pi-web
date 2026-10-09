export const INTERACTIVE_PREVIEW_LANGUAGE = "pi-html";

/** Reject pathological untrusted reports without imposing a normal preview size. */
export function interactivePreviewHeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100_000) return null;
  return Math.ceil(value);
}

/** Use the Markdown parser's source range to require an explicitly closed fence. */
export function isCompleteInteractiveFence(
  markdown: string,
  position?: { start: { offset?: number }; end: { offset?: number } },
): boolean {
  if (position?.start.offset === undefined || position.end.offset === undefined) return false;
  const source = markdown.slice(position.start.offset, position.end.offset);
  const opener = /^(`{3,}|~{3,})pi-html[ \t]*\r?\n/i.exec(source);
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

export function interactivePreviewDocument(code: string): string {
  return `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${INTERACTIVE_PREVIEW_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 16px; box-sizing: border-box; font: 14px/1.5 system-ui, sans-serif; overflow-wrap: break-word; }
  img, canvas, svg { max-width: 100%; }
</style>
<script>
  addEventListener('error', function () { parent.postMessage({ type: 'pi-html:error' }, '*'); });
  addEventListener('unhandledrejection', function () { parent.postMessage({ type: 'pi-html:error' }, '*'); });
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
      previousHeight = 0;
      measure();
    });
    measure();
  });
</script>
${code}`;
}
