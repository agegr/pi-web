/**
 * Parse a repo identifier into "owner/repo" format.
 * Pure function — no Node.js deps, safe for client-side use.
 * Accepts: "owner/repo" or "https://github.com/owner/repo[.git]"
 */
export function parseRepo(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname === "github.com") {
      const parts = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
      if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    }
  } catch { /* not a URL */ }
  return null;
}
