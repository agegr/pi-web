/** Client-side navigation only; the content endpoint independently authorizes every read. */
export type SkillDocumentLink =
  | { kind: "external" }
  | { kind: "document"; document: string; anchor: string }
  | { kind: "error"; reason: "outside" | "unsupported" | "invalid" };

export function resolveSkillDocumentLink(href: string, currentDocument: string): SkillDocumentLink {
  if (!href) return { kind: "error", reason: "invalid" };
  if (/^(?:https?:|mailto:|\/\/)/i.test(href)) return { kind: "external" };
  try {
    const hash = href.indexOf("#");
    const pathname = decodeURIComponent(hash < 0 ? href : href.slice(0, hash));
    const anchor = hash < 0 ? "" : decodeURIComponent(href.slice(hash + 1));
    if (/[\x00-\x1f\x7f]/.test(pathname + anchor)) return { kind: "error", reason: "invalid" };
    if (/^(?:\/|\\|[a-z][a-z0-9+.-]*:)/i.test(pathname) || pathname.includes("\\")) {
      return { kind: "error", reason: "outside" };
    }
    if (!pathname) return { kind: "document", document: currentDocument, anchor };
    // Queries are not filesystem names here. Encoded delimiters in filenames are
    // fine: only a literal query delimiter in the original URL is refused.
    if ((hash < 0 ? href : href.slice(0, hash)).includes("?")) return { kind: "error", reason: "unsupported" };
    const parts = currentDocument.split("/").slice(0, -1);
    for (const part of pathname.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!parts.length) return { kind: "error", reason: "outside" };
        parts.pop();
      } else {
        parts.push(part);
      }
    }
    const document = parts.join("/");
    if (!/\.(?:md|markdown)$/i.test(document)) return { kind: "error", reason: "unsupported" };
    return { kind: "document", document, anchor };
  } catch {
    return { kind: "error", reason: "invalid" };
  }
}
