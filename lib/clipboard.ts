function httpUrl(value: string): string | null {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

function decodeHtml(value: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    quot: '"',
    "#39": "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };
  return value.replace(/&(amp|quot|#39|lt|gt|nbsp);/gi, (entity, name: string) =>
    entities[name.toLowerCase()] ?? entity);
}

function markdownLink(label: string, url: string): string {
  const safeLabel = label.replace(/([\\[\]])/g, "\\$1").replace(/\s+/g, " ").trim() || url;
  return `[${safeLabel}](<${url.replace(/>/g, "%3E")}>)`;
}

/**
 * Preserve a copied rich-text link, or turn a URL pasted over selected text
 * into a Markdown link. Returns null when the browser's native paste is best.
 */
export function formatLinkPaste(plainText: string, html: string, selectedText: string): string | null {
  const selectedUrl = httpUrl(plainText);
  if (selectedText && selectedUrl) return markdownLink(selectedText, selectedUrl);
  if (!html) return null;

  const anchors = html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi);
  let result = plainText;
  let searchFrom = 0;
  let converted = false;

  for (const anchor of anchors) {
    const url = httpUrl(decodeHtml(anchor[2]));
    const label = decodeHtml(anchor[3].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
    if (!url || !label) continue;

    const index = result.indexOf(label, searchFrom);
    if (index < 0) continue;
    const replacement = markdownLink(label, url);
    result = result.slice(0, index) + replacement + result.slice(index + label.length);
    searchFrom = index + replacement.length;
    converted = true;
  }

  return converted ? result : null;
}

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve();
  } catch {
    return Promise.reject();
  }
}
