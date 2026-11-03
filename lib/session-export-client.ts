/** The file name a `Content-Disposition` header gives (RFC 6266 `filename*` first), else null. */
export function contentDispositionFileName(header: string | null): string | null {
  if (!header) return null;
  const extended = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // A malformed escape falls back to the plain name.
    }
  }
  const plain = header.match(/filename\s*=\s*"([^"]*)"/i) ?? header.match(/filename\s*=\s*([^;]+)/i);
  return plain?.[1].trim() || null;
}

/**
 * The composer's `/export`: downloads the session's HTML export, the file pi's
 * TUI writes. Fetched first, so a failure is a notice, not a downloaded error page.
 */
export async function downloadSessionExport(sessionId: string): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/export`, { cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  const url = URL.createObjectURL(await res.blob());
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = contentDispositionFileName(res.headers.get("Content-Disposition")) ?? "pi-session.html";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoked after the click has handed the blob to the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
