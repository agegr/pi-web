/**
 * Saved links and app shortcuts for the Robin dashboard.
 *
 * Pure logic only — no node builtins. The dashboard imports `groupLinks` and
 * `normalizeUrl` into client components, and a `node:fs` import anywhere in
 * this module's graph fails the browser bundle. Reading and writing the file
 * lives in ./store.ts.
 */

export interface Link {
  id: string;
  title: string;
  url: string;
  /** Free-form grouping shown as a section heading, e.g. "Apps" or "Reading". */
  group?: string;
  /** File extension of the cached icon, absent when there is none. */
  icon?: string;
  /**
   * UTC instant of the last icon lookup, set whether or not one was found.
   * Without it a link whose site has no icon would be re-fetched forever.
   */
  iconCheckedAt?: string;
  /** UTC instant, ISO 8601. */
  createdAt: string;
}

/**
 * A deterministic tile for links with no icon.
 *
 * Derived from the host so it never changes, and computed locally so a missing
 * icon still costs no network request. Many favicons are illegible at this size
 * anyway, which makes this a reasonable fallback rather than a poor one.
 */
export function iconFallback(link: Pick<Link, "title" | "url">): { letter: string; hue: number } {
  let host = link.title;
  try {
    host = new URL(link.url).hostname.replace(/^www\./, "");
  } catch {
    // A malformed URL still deserves a tile; fall back to the title.
  }

  const letter = (/\p{L}|\p{N}/u.exec(host)?.[0] ?? "?").toUpperCase();
  let hash = 0;
  for (let index = 0; index < host.length; index += 1) {
    hash = (hash * 31 + host.charCodeAt(index)) % 360;
  }
  return { letter, hue: hash };
}

/**
 * Normalize a user-supplied URL and reject schemes that would execute when the
 * dashboard renders the link as an anchor. `javascript:` and `data:` are the
 * reason this function exists — everything stored here ends up in an href.
 */
export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("URL is empty");

  // A bare "github.com/x" has no scheme; default it rather than rejecting it.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Cannot read "${value}" as a URL`);
  }

  const allowed = new Set(["http:", "https:", "mailto:"]);
  if (!allowed.has(parsed.protocol)) {
    throw new Error(`Unsupported URL scheme "${parsed.protocol}" — use http, https, or mailto`);
  }
  return parsed.toString();
}

/** Group links for display, preserving first-seen group order. */
export function groupLinks(links: Link[]): { group: string; links: Link[] }[] {
  const groups = new Map<string, Link[]>();
  for (const link of links) {
    const key = link.group?.trim() || "Other";
    const existing = groups.get(key);
    if (existing) existing.push(link);
    else groups.set(key, [link]);
  }
  return [...groups].map(([group, items]) => ({ group, links: items }));
}

/** Reorder section blocks while preserving the order of links inside each one. */
export function reorderLinkGroups(links: Link[], order: string[]): Link[] {
  const groups = groupLinks(links);
  const byName = new Map(groups.map((group) => [group.group, group.links]));
  const uniqueOrder = [...new Set(order)];
  const requested = new Set(uniqueOrder);
  return [
    ...uniqueOrder.flatMap((name) => byName.get(name) ?? []),
    ...groups.filter(({ group }) => !requested.has(group)).flatMap(({ links: items }) => items),
  ];
}
