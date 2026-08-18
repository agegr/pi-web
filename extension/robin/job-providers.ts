/**
 * Public ATS and job-board readers.
 *
 * Ported from career-ops (MIT, github.com/santifer/career-ops) — its
 * `providers/` layer, narrowed to the boards worth having on day one and
 * rewritten in TypeScript. The provider contract is theirs: a module knows how
 * to recognise a careers URL and how to turn one board into postings, and
 * knows nothing about filtering, storage, or scoring.
 *
 * Three rules are carried over verbatim because they are what makes it safe to
 * point this at a URL a user typed:
 *
 *   - every request target is checked against a host allow-list (or a tight
 *     per-tenant pattern) BEFORE the fetch,
 *   - `redirect: "error"` — a 302 must not be able to walk the request onto
 *     another host after the check passed,
 *   - a board that fails is logged and skipped, never fatal to the scan.
 *
 * Only public, no-auth endpoints belong here. Anything requiring a login or
 * forbidding automated access does not, whatever it would add to coverage.
 *
 * No node builtins: this module is loaded by jiti inside the pi extension and
 * by webpack on the Next.js server, so it uses global fetch and nothing else.
 */
import { cleanDescription, type TrackedCompany } from "./jobs.ts";

/** What a provider hands back. Everything else is derived downstream. */
export interface RawPosting {
  title: string;
  url: string;
  company: string;
  location: string;
  /** YYYY-MM-DD (UTC), when the board reports one. */
  postedAt?: string;
  /** Only when the listing endpoint already carried it — never a second request. */
  description?: string;
}

export interface FetchContext {
  fetchJson: (url: string, options?: { timeoutMs?: number }) => Promise<unknown>;
}

export interface Provider {
  id: string;
  /** Human label for the settings UI. */
  label: string;
  /** True when this provider handles the company's URL. */
  detect?: (company: TrackedCompany) => boolean;
  /** Aggregator feeds need no company and are enabled by id instead. */
  board?: boolean;
  fetch: (company: TrackedCompany, ctx: FetchContext) => Promise<RawPosting[]>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * A board that identifies its client honestly gets fewer 403s than one
 * pretending to be Chrome, and this is a personal-scale scanner either way.
 */
const USER_AGENT = "robin-jobs/1.0 (+https://github.com/agegr/pi-web)";

export function makeFetchContext(fetchImpl: typeof fetch = fetch): FetchContext {
  return {
    async fetchJson(url, options = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      try {
        const response = await fetchImpl(url, {
          signal: controller.signal,
          // A server-side redirect would land on a host the allow-list never
          // saw. Refusing to follow it is what keeps that check meaningful.
          redirect: "error",
          headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/* ─────────────────────────── helpers ─────────────────────────── */

/** NaN-safe: `|| undefined` would also throw away a legitimate epoch 0. */
function toDateString(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString().slice(0, 10);
}

function assertHost(url: string, allowed: (hostname: string) => boolean, provider: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${provider}: invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${provider}: URL must use HTTPS: ${url}`);
  if (!allowed(parsed.hostname)) {
    throw new Error(`${provider}: untrusted hostname "${parsed.hostname}"`);
  }
  return parsed.toString();
}

/** Parse a company URL, returning null rather than throwing — detect() calls this. */
function parseUrl(value: string): URL | null {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function rows(value: unknown, key: string): Record<string, unknown>[] {
  const list = (value as Record<string, unknown> | null)?.[key];
  return Array.isArray(list) ? list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

/** Postings whose URL we could not trust are dropped rather than rendered. */
function usable(postings: RawPosting[]): RawPosting[] {
  return postings.filter((posting) => posting.title !== "" && /^https?:\/\//i.test(posting.url));
}

/* ─────────────────────────── Greenhouse ─────────────────────────── */

const GREENHOUSE_HOSTS = new Set([
  "boards-api.greenhouse.io",
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "job-boards.eu.greenhouse.io",
]);

function greenhouseSlug(company: TrackedCompany): string | null {
  const parsed = parseUrl(company.url);
  if (!parsed || !GREENHOUSE_HOSTS.has(parsed.hostname)) return null;
  return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
}

const greenhouse: Provider = {
  id: "greenhouse",
  label: "Greenhouse",
  detect: (company) => greenhouseSlug(company) !== null,
  async fetch(company, ctx) {
    const slug = greenhouseSlug(company);
    if (!slug) throw new Error(`greenhouse: cannot derive a board slug from ${company.url}`);
    const api = assertHost(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`,
      (host) => GREENHOUSE_HOSTS.has(host),
      "greenhouse",
    );
    const json = await ctx.fetchJson(api);
    return usable(rows(json, "jobs").map((job) => ({
      title: str(job.title),
      url: str(job.absolute_url),
      company: company.name,
      location: str((job.location as Record<string, unknown> | undefined)?.name),
      postedAt: toDateString(job.first_published ?? job.updated_at),
    })));
  },
};

/* ────────────────────────────── Lever ────────────────────────────── */

function leverBoard(company: TrackedCompany): { host: string; slug: string } | null {
  const parsed = parseUrl(company.url);
  const host = parsed?.hostname.match(/^jobs\.((?:eu\.)?lever\.co)$/);
  if (!parsed || !host) return null;
  const slug = parsed.pathname.split("/").filter(Boolean)[0];
  return slug ? { host: host[1] as string, slug } : null;
}

const lever: Provider = {
  id: "lever",
  label: "Lever",
  detect: (company) => leverBoard(company) !== null,
  async fetch(company, ctx) {
    const board = leverBoard(company);
    if (!board) throw new Error(`lever: cannot derive a board slug from ${company.url}`);
    const api = assertHost(
      `https://api.${board.host}/v0/postings/${encodeURIComponent(board.slug)}`,
      (host) => host === "api.lever.co" || host === "api.eu.lever.co",
      "lever",
    );
    const json = await ctx.fetchJson(api);
    if (!Array.isArray(json)) return [];
    return usable(json.map((raw) => {
      const job = raw as Record<string, unknown>;
      // Lever ships the full description in the LIST payload, so a description
      // costs nothing extra here — unlike every other board in this file.
      const description = str(job.descriptionPlain);
      return {
        title: str(job.text),
        url: str(job.hostedUrl),
        company: company.name,
        location: str((job.categories as Record<string, unknown> | undefined)?.location),
        postedAt: toDateString(job.createdAt),
        ...(description ? { description: cleanDescription(description) } : {}),
      };
    }));
  },
};

/* ────────────────────────────── Ashby ────────────────────────────── */

function ashbySlug(company: TrackedCompany): string | null {
  const parsed = parseUrl(company.url);
  if (!parsed || parsed.hostname !== "jobs.ashbyhq.com") return null;
  return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
}

const ashby: Provider = {
  id: "ashby",
  label: "Ashby",
  detect: (company) => ashbySlug(company) !== null,
  async fetch(company, ctx) {
    const slug = ashbySlug(company);
    if (!slug) throw new Error(`ashby: cannot derive a board slug from ${company.url}`);
    const api = assertHost(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
      (host) => host === "api.ashbyhq.com",
      "ashby",
    );
    // Ashby's public posting-api has a latency floor around ten seconds that is
    // independent of board size, so the shared default would race it.
    const json = await ctx.fetchJson(api, { timeoutMs: 30_000 });
    return usable(rows(json, "jobs").map((job) => {
      // Extra hiring regions live in secondaryLocations; reading only
      // `location` makes an EU-eligible role look Canada-only and the location
      // filter then drops it.
      const secondary = Array.isArray(job.secondaryLocations)
        ? (job.secondaryLocations as Record<string, unknown>[]).map((entry) => str(entry?.location))
        : [];
      const location = [...new Set([str(job.location), ...secondary].filter(Boolean))].join(" · ");
      return {
        title: str(job.title),
        url: str(job.jobUrl),
        company: company.name,
        location,
        postedAt: toDateString(job.publishedAt),
      };
    }));
  },
};

/* ────────────────────────── SmartRecruiters ────────────────────────── */

const SMARTRECRUITERS_CAREERS = new Set(["careers.smartrecruiters.com", "jobs.smartrecruiters.com"]);
const SMARTRECRUITERS_PAGE = 100;
const SMARTRECRUITERS_MAX_PAGES = 20;

function smartRecruitersSlug(company: TrackedCompany): string | null {
  const parsed = parseUrl(company.url);
  if (!parsed || !SMARTRECRUITERS_CAREERS.has(parsed.hostname)) return null;
  return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
}

/**
 * Rewrite the API `ref` into the public posting page.
 *
 * The public site has no `/postings/` segment, so carrying the ref over yields
 * a 404 — which then reads as an expired posting rather than a bad URL.
 * SmartRecruiters resolves by id alone; the trailing title slug is cosmetic.
 */
export function smartRecruitersPublicUrl(ref: string, slug: string, id: string, title: string): string {
  const slugified = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const suffix = slugified ? `-${slugified}` : "";
  const parsed = parseUrl(ref);
  if (parsed && parsed.hostname === "api.smartrecruiters.com" && parsed.pathname.startsWith("/v1/companies/")) {
    const [refSlug, postings, refId] = parsed.pathname.slice("/v1/companies/".length).split("/").filter(Boolean);
    if (refSlug && postings === "postings" && refId) {
      return `https://jobs.smartrecruiters.com/${refSlug}/${refId}${suffix}`;
    }
  }
  return id ? `https://jobs.smartrecruiters.com/${slug}/${id}${suffix}` : "";
}

const smartrecruiters: Provider = {
  id: "smartrecruiters",
  label: "SmartRecruiters",
  detect: (company) => smartRecruitersSlug(company) !== null,
  async fetch(company, ctx) {
    const slug = smartRecruitersSlug(company);
    if (!slug) throw new Error(`smartrecruiters: cannot derive a company slug from ${company.url}`);
    const all: RawPosting[] = [];
    for (let page = 0; page < SMARTRECRUITERS_MAX_PAGES; page += 1) {
      const api = assertHost(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings`
        + `?limit=${SMARTRECRUITERS_PAGE}&offset=${page * SMARTRECRUITERS_PAGE}&status=PUBLIC`,
        (host) => host === "api.smartrecruiters.com",
        "smartrecruiters",
      );
      const json = await ctx.fetchJson(api);
      const content = rows(json, "content");
      if (content.length === 0) break;
      all.push(...content.map((job) => {
        const loc = (job.location ?? {}) as Record<string, unknown>;
        const full = str(loc.fullLocation)
          || [str(loc.city), str(loc.region), str(loc.country)].filter(Boolean).join(", ");
        return {
          title: str(job.name),
          url: smartRecruitersPublicUrl(str(job.ref), slug, str(job.id), str(job.name)),
          company: company.name,
          location: [full, loc.remote ? "Remote" : ""].filter(Boolean).join(", "),
          postedAt: toDateString(job.releasedDate ?? job.createdOn),
        };
      }));
      if (content.length < SMARTRECRUITERS_PAGE) break;
    }
    return usable(all);
  },
};

/* ───────────────────────────── Recruitee ───────────────────────────── */

const RECRUITEE_HOST = /^[a-z0-9][a-z0-9-]*\.recruitee\.com$/;

const recruitee: Provider = {
  id: "recruitee",
  label: "Recruitee",
  detect: (company) => {
    const parsed = parseUrl(company.url);
    return parsed !== null && RECRUITEE_HOST.test(parsed.hostname);
  },
  async fetch(company, ctx) {
    const parsed = parseUrl(company.url);
    if (!parsed || !RECRUITEE_HOST.test(parsed.hostname)) {
      throw new Error(`recruitee: ${company.url} is not a recruitee tenant`);
    }
    const api = assertHost(
      `https://${parsed.hostname}/api/offers/`,
      (host) => RECRUITEE_HOST.test(host),
      "recruitee",
    );
    const json = await ctx.fetchJson(api);
    return usable(rows(json, "offers").map((job) => {
      // Recruitee tenants often publish on their own domain, so the per-offer
      // URL is deliberately NOT host-locked. It is display-only — recorded and
      // rendered, never fetched by us — and it came from the tenant API we
      // already validated.
      const raw = str(job.careers_url) || str(job.url);
      const link = parseUrl(raw);
      return {
        title: str(job.title),
        url: link ? link.href : "",
        company: company.name,
        location: str(job.location)
          || [str(job.city), str(job.country), job.remote ? "Remote" : ""].filter(Boolean).join(", "),
        postedAt: toDateString(job.published_at ?? job.created_at),
      };
    }));
  },
};

/* ───────────────────── Aggregator feeds (no company) ───────────────────── */

const remoteok: Provider = {
  id: "remoteok",
  label: "RemoteOK",
  board: true,
  async fetch(_company, ctx) {
    const json = await ctx.fetchJson("https://remoteok.com/api");
    if (!Array.isArray(json)) throw new Error("remoteok: expected a JSON array");
    // Index 0 is a {legal, last_updated} metadata row, not a posting.
    return usable(json.map((raw) => {
      const job = raw as Record<string, unknown>;
      return {
        title: str(job.position),
        url: str(job.url),
        company: str(job.company) || "RemoteOK",
        location: str(job.location) || "Remote",
        postedAt: toDateString(job.date),
      };
    }));
  },
};

const remotive: Provider = {
  id: "remotive",
  label: "Remotive",
  board: true,
  async fetch(_company, ctx) {
    const json = await ctx.fetchJson("https://remotive.com/api/remote-jobs");
    return usable(rows(json, "jobs").map((job) => ({
      title: str(job.title),
      url: str(job.url),
      company: str(job.company_name) || "Remotive",
      location: str(job.candidate_required_location) || "Remote",
      postedAt: toDateString(job.publication_date),
    })));
  },
};

/* ───────────────────────────── registry ───────────────────────────── */

/** Alphabetical, so detect() precedence is the same on every machine. */
export const PROVIDERS: readonly Provider[] = [
  ashby,
  greenhouse,
  lever,
  recruitee,
  remoteok,
  remotive,
  smartrecruiters,
];

/** Company-less feeds, offered as checkboxes in the settings UI. */
export const BOARD_PROVIDERS: readonly Provider[] = PROVIDERS.filter((provider) => provider.board === true);

export const COMPANY_PROVIDERS: readonly Provider[] = PROVIDERS.filter((provider) => provider.board !== true);

export function providerById(id: string): Provider | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

/**
 * Which provider handles a company. An explicit `provider` wins, so a branded
 * careers URL can stay in the UI while the scan targets the real board.
 *
 * Returns null rather than a default: there is no generic "just fetch it"
 * fallback, and that is deliberate. Every request this scanner makes has to
 * come from a module that validated the host first.
 */
export function resolveProvider(company: TrackedCompany): Provider | null {
  if (company.provider) return providerById(company.provider) ?? null;
  return COMPANY_PROVIDERS.find((provider) => provider.detect?.(company)) ?? null;
}
