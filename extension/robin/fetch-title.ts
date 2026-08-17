/**
 * Read a page's <title> so a pasted URL can be filed under a real name.
 *
 * Server-only. Never import this from a client component: it makes outbound
 * requests on the user's behalf, and it exists so the *server* can look up a
 * title the user or the agent did not supply.
 *
 * Deliberately conservative — it is fed URLs typed by a person or produced by a
 * model, so it caps the time spent, caps the bytes read, and refuses anything
 * that is not HTML. A failure is never fatal: callers fall back to the hostname.
 */

const TIMEOUT_MS = 5_000;
/** A <title> lives in <head>; anything past this is not worth buffering. */
const MAX_BYTES = 64 * 1024;
const MAX_TITLE_LENGTH = 200;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const code = entity[1]?.toLowerCase() === "x"
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Titles that describe the wall in front of a page rather than the page.
 *
 * A URL behind SSO answers with the login system's own page, so the title comes
 * back as something like "Web Login Service - Stale Request". Saving that as the
 * link's name is worse than saving nothing: it is confidently wrong, and every
 * such link ends up with the same meaningless name.
 */
/**
 * Unambiguous markers of a wall: these phrases do not appear in the title of a
 * page that is actually about something.
 */
const STRONG_INTERSTITIAL: RegExp[] = [
  /\bstale request\b/i,
  /\bjust a moment\b/i,              // Cloudflare
  /\battention required\b/i,
  /\bchecking your browser\b/i,
  /\bare you (a )?human\b/i,
  /\bshibboleth\b/i,
  /\baccess denied\b/i,
  /\bunauthori[sz]ed\b/i,
  /\b(40[0-9]|50[0-9])\b/,
  /\bpage not found\b/i,
];

/**
 * Weaker markers, only trusted at the start of the title.
 *
 * A login screen leads with "Sign in"; an article about login forms mentions it
 * mid-sentence. Anchoring is what keeps "How to design a login form — Smashing
 * Magazine" from being thrown away.
 */
const LEADING_INTERSTITIAL: RegExp[] = [
  /^\s*(web\s+)?log[- ]?in\b/i,
  /^\s*sign[- ]?(in|on)\b/i,
  /^\s*authentication\b/i,
  /^\s*sso\b/i,
  /^\s*redirecting\b/i,
  /^\s*loading\b/i,
  /^\s*forbidden\b/i,
  /^\s*not found\b/i,
  // Deliberately absent: a leading "Error" or "Forbidden" also begins
  // "Error Handling in Rust" and "Forbidden City travel guide". Discarding a
  // good title is worse than keeping a poor one — the user can rename a link,
  // but cannot recover a title we threw away. Numeric status codes in
  // STRONG_INTERSTITIAL cover the real error pages.
];

/** Titles that say nothing at all, whatever the page is. */
const EMPTY_TITLE = /^\s*(home|index|untitled|document|page|error)\s*$/i;

export function looksLikeInterstitial(title: string): boolean {
  return EMPTY_TITLE.test(title)
    || STRONG_INTERSTITIAL.some((pattern) => pattern.test(title))
    || LEADING_INTERSTITIAL.some((pattern) => pattern.test(title));
}

/**
 * A readable name derived from the URL itself, for when the page will not give
 * a usable one. "leetcode.com/problems/two-sum" becomes "leetcode.com · two sum",
 * which at least says what the link is.
 */
export function nameFromUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const host = parsed.hostname.replace(/^www\./, "");
  const segments = parsed.pathname.split("/").filter(Boolean);

  // Walk back from the end for a segment that carries meaning — ids, hashes and
  // file extensions do not.
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = decodeURIComponent(segments[index] as string).replace(/\.[a-z0-9]{1,5}$/i, "");
    const words = segment.replace(/[-_+]+/g, " ").trim();
    const meaningful = words.length > 1
      && !/^\d+$/.test(words)
      && !/^[0-9a-f]{8,}$/i.test(words)
      && !/^(index|home|default|view|page|en|zh)$/i.test(words);
    if (meaningful) return `${host} · ${words}`;
  }
  return host;
}

/**
 * Pick the best icon declared in a page's head.
 *
 * Preference order is size, then format: a 180px apple-touch-icon beats a 16px
 * .ico, and PNG beats ICO at equal size. `sizes="any"` usually marks an SVG,
 * which is rejected downstream, so it does not win by default.
 */
export function extractIconHref(html: string, baseUrl: string): string | null {
  const candidates: { href: string; score: number }[] = [];

  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    if (!/\b(icon|shortcut icon|apple-touch-icon)\b/.test(rel)) continue;

    const href = /\bhref\s*=\s*["']([^"']+)/i.exec(tag)?.[1];
    if (!href) continue;

    const sizes = /\bsizes\s*=\s*["']?([^"'>\s]+)/i.exec(tag)?.[1] ?? "";
    const pixels = Number.parseInt(sizes.split("x")[0] ?? "", 10);
    let score = Number.isFinite(pixels) ? Math.min(pixels, 512) : 32;
    if (/\.png(\?|$)/i.test(href)) score += 8;
    if (/\.svg(\?|$)/i.test(href)) score -= 16;
    if (rel.includes("apple-touch-icon")) score += 4;

    candidates.push({ href, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]?.href;

  try {
    // Resolved against the final URL, which may differ from the requested one
    // after a redirect — a relative "/favicon.png" belongs to wherever we landed.
    return new URL(best ?? "/favicon.ico", baseUrl).toString();
  } catch {
    return null;
  }
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match?.[1]) return null;
  const title = decodeEntities(match[1]).replace(/\s+/g, " ").trim();
  if (!title) return null;
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

export interface PageMetadata {
  /** Absent when the page gave no usable title (a login wall, an error page). */
  title: string | null;
  /** Absolute URL of the best declared icon, or the conventional /favicon.ico. */
  iconUrl: string | null;
}

/**
 * Read a page's head once and take both the title and the icon from it.
 *
 * One request rather than two: the icon link lives in the same head the title
 * does, so fetching it separately would double the cost for no gain.
 */
export async function fetchPageMetadata(url: string): Promise<PageMetadata> {
  const empty: PageMetadata = { title: null, iconUrl: null };
  if (!/^https?:$/i.test(new URL(url).protocol)) return empty;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Some sites serve a stub or an error to unknown clients.
        "User-Agent": "Mozilla/5.0 (compatible; RobinDashboard/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok || !response.body) return empty;
    if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("html")) return empty;

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let html = "";
    let bytesRead = 0;
    try {
      while (bytesRead < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesRead += value.byteLength;
        html += decoder.decode(value, { stream: true });
        // The whole head, not just the title: icon links sit alongside it, and
        // often after it. The body is of no interest either way.
        if (/<\/head>/i.test(html)) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const title = extractTitle(html);
    return {
      // A login wall or bot check answers with its own title; better to fall
      // back to the URL than to record the wall's name as the page's.
      title: title && !looksLikeInterstitial(title) ? title : null,
      iconUrl: extractIconHref(html, response.url || url),
    };
  } catch {
    // Unreachable host, TLS failure, timeout, malformed response — all just
    // mean "nothing available".
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

/** Convenience wrapper for callers that only need the title. */
export async function fetchPageTitle(url: string): Promise<string | null> {
  return (await fetchPageMetadata(url)).title;
}
