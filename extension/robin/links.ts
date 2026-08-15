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
  /** UTC instant, ISO 8601. */
  createdAt: string;
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
