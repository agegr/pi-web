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

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match?.[1]) return null;
  const title = decodeEntities(match[1]).replace(/\s+/g, " ").trim();
  if (!title) return null;
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

export async function fetchPageTitle(url: string): Promise<string | null> {
  if (!/^https?:$/i.test(new URL(url).protocol)) return null;

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
    if (!response.ok || !response.body) return null;
    if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("html")) return null;

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
        // Stop as soon as the title is complete rather than draining the page.
        if (/<\/title>/i.test(html)) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return extractTitle(html);
  } catch {
    // Unreachable host, TLS failure, timeout, malformed response — all just
    // mean "no title available".
    return null;
  } finally {
    clearTimeout(timer);
  }
}
