/**
 * Convert a user-entered web address into a safe iframe URL.
 * Bare host names (for example `www.google.com`) default to HTTPS.
 */
export function normalizeWebUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** A compact, stable title for a web tab. */
export function getWebUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "") || url;
  } catch {
    return url;
  }
}
