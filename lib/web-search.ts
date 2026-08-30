/**
 * Minimal keyless web search for the research lens ("联网核实").
 *
 * Queries the DuckDuckGo HTML endpoint and parses result blocks with
 * regexes — deliberately dependency-free and best-effort: any failure
 * (blocked, redesigned, proxy missing) degrades to `ok: false` and the
 * explain route falls back to pure model knowledge.
 */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutcome {
  ok: boolean;
  query: string;
  results: WebSearchResult[];
  error?: string;
}

const SEARCH_URL = "https://html.duckduckgo.com/html/";
const DEFAULT_TIMEOUT_MS = 8000;

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function decodeResultUrl(href: string): string | null {
  try {
    const link = new URL(href, SEARCH_URL);
    const destination = link.searchParams.get("uddg") ?? link.href;
    const url = new URL(destination);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export async function searchWeb(
  query: string,
  options: { maxResults?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<WebSearchOutcome> {
  const maxResults = options.maxResults ?? 5;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", query);
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html",
        "User-Agent": "Mozilla/5.0 (compatible; pi-web-research/1.0)",
      },
      signal,
    });
    if (!response.ok) {
      return { ok: false, query, results: [], error: `HTTP ${response.status}` };
    }
    const html = await response.text();

    // Each organic result lives in a .result__body block pairing the title
    // anchor with its snippet, which keeps title/snippet association intact.
    const blocks = html.split(/class="result__body"/).slice(1);
    const results: WebSearchResult[] = [];
    for (const block of blocks) {
      const anchorMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!anchorMatch) continue;
      const resultUrl = decodeResultUrl(anchorMatch[1]);
      const title = stripTags(anchorMatch[2]);
      if (!resultUrl || !title) continue;
      const snippetMatch = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      results.push({
        title,
        url: resultUrl,
        snippet: snippetMatch ? stripTags(snippetMatch[1]) : "",
      });
      if (results.length >= maxResults) break;
    }
    if (results.length === 0) {
      return { ok: false, query, results: [], error: "No parseable results" };
    }
    return { ok: true, query, results };
  } catch (error) {
    return {
      ok: false,
      query,
      results: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
