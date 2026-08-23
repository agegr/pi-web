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
  /**
   * Provider-native handle for a follow-up description fetch.
   *
   * Set by providers whose LIST endpoint omits the description, and consumed
   * only by that provider's own `hydrate`. It exists because the public URL is
   * not always a usable key: a Greenhouse board can hand out branded links
   * like `https://nuro.ai/careersitem?gh_jid=8122990`, and re-deriving the
   * board slug from one of those is guesswork. Never rendered, never stored.
   */
  ref?: { board: string; id: string };
}

export interface FetchRequest {
  timeoutMs?: number;
  /**
   * Present means POST, and the value is JSON-encoded as the body.
   *
   * Only Workday needs it, and only because its public jobs endpoint takes a
   * paging window in the body rather than the query string. No provider here
   * sends a POST that changes anything on the far side.
   */
  body?: unknown;
  /**
   * Follow up to this many redirects, re-checking every hop.
   *
   * The default everywhere else is `redirect: "error"`, because a 302 must not
   * be able to walk a request onto a host the allow-list never saw. This opts
   * into following one — and only with `allowHost`, which is re-run on each
   * Location before the next request goes out. That is the same guarantee,
   * enforced per hop instead of by refusing to move.
   */
  redirects?: number;
  /** Required whenever `redirects` is set: vets the host of every hop. */
  allowHost?: (hostname: string) => boolean;
  /** Stop reading after this many bytes. A page is not allowed to be a download. */
  maxBytes?: number;
}

export interface FetchContext {
  fetchJson: (url: string, options?: FetchRequest) => Promise<unknown>;
  /** For the two boards that publish a markdown table instead of JSON. */
  fetchText: (url: string, options?: FetchRequest) => Promise<string>;
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
  /**
   * Fill in `description` on postings the filters already accepted.
   *
   * Split from `fetch` on purpose. Some boards only serve a description from a
   * per-posting endpoint, and paying for that during discovery means one
   * request per posting across a quarter of a million of them. Running it
   * AFTER the title/location/freshness filters turns the same work into a few
   * hundred requests against postings that are actually going to be scored.
   *
   * Mutates in place and never throws: a description is an improvement to a
   * posting, not a precondition for having one. A board that refuses to serve
   * one leaves the posting exactly as it was.
   */
  hydrate?: (postings: RawPosting[], ctx: FetchContext) => Promise<void>;
  /**
   * Recover this provider's own `ref` from a public posting URL.
   *
   * What makes the community lists worth reading: they hand back an apply link
   * on whatever ATS the employer uses, and this is how a posting discovered
   * through one of them still gets a description read out of Greenhouse or
   * Workday. Returns null for a URL this provider does not own.
   */
  refFromUrl?: (url: string) => { board: string; id: string } | null;
  /**
   * Is this posting still open?
   *
   * Separate from a plain HTTP check because the public page routinely cannot
   * answer. An Ashby posting that was taken down still serves 200 and a
   * one-kilobyte JavaScript shell — identical to a live one but for the
   * `<title>` — so the only honest oracle is the board API that produced the
   * posting in the first place.
   *
   * "unknown" is a real answer and the safe one: a timeout, a 403 or a 500 is
   * a fact about the network, not about the job, and dropping a good posting
   * over one is worse than showing a stale link.
   */
  probe?: (urls: readonly string[], ctx: FetchContext) => Promise<Map<string, "live" | "dead">>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * A board that identifies its client honestly gets fewer 403s than one
 * pretending to be Chrome, and this is a personal-scale scanner either way.
 */
const USER_AGENT = "robin-jobs/1.0 (+https://github.com/agegr/pi-web)";

export function makeFetchContext(fetchImpl: typeof fetch = fetch): FetchContext {
  const send = async (url: string, accept: string, options: FetchRequest) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const hops = options.redirects ?? 0;
    try {
      let target = url;
      for (let hop = 0; ; hop += 1) {
        const response = await fetchImpl(target, {
          signal: controller.signal,
          // A server-side redirect would land on a host the allow-list never
          // saw. Refusing to follow it is what keeps that check meaningful;
          // "manual" plus the re-check below is the same promise, kept a hop
          // at a time.
          redirect: hops > 0 ? "manual" : "error",
          ...(options.body === undefined
            ? {}
            : { method: "POST", body: JSON.stringify(options.body) }),
          headers: {
            Accept: accept,
            "User-Agent": USER_AGENT,
            ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          },
        });

        const location = response.status >= 300 && response.status < 400
          ? response.headers.get("location")
          : null;
        if (!location || hop >= hops) {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response;
        }

        const next = new URL(location, target);
        if (next.protocol !== "https:") throw new Error(`redirect left HTTPS: ${next.href}`);
        if (!options.allowHost?.(next.hostname)) {
          throw new Error(`redirect to untrusted host "${next.hostname}"`);
        }
        target = next.toString();
      }
    } finally {
      clearTimeout(timer);
    }
  };

  /** Read a body, refusing to keep going past `maxBytes`. */
  const readCapped = async (response: Response, maxBytes: number | undefined): Promise<string> => {
    if (!maxBytes || !response.body) return response.text();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let out = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
      if (out.length >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
    return out;
  };

  return {
    async fetchJson(url, options = {}) {
      return (await send(url, "application/json", options)).json();
    },
    async fetchText(url, options = {}) {
      const response = await send(url, "text/html, text/markdown, text/plain, */*", options);
      return readCapped(response, options.maxBytes);
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

/**
 * Run `worker` over `items`, at most `limit` in flight.
 *
 * Four, not the scan's six: a hydrate pass aims every one of its requests at
 * the same ATS that just served the listing, so it is the least polite traffic
 * this file generates and the most likely to be throttled.
 */
const HYDRATE_CONCURRENCY = 4;

async function eachLimited<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      // One posting that will not load a description must not cost the others
      // theirs — this whole pass is best-effort by contract.
      await worker(item).catch(() => {});
    }
  }));
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
  /**
   * Both shapes a Greenhouse posting link comes in:
   * `job-boards.greenhouse.io/{slug}/jobs/{id}` for the hosted board, and any
   * employer domain carrying `?gh_jid={id}` for a branded careers page. The
   * branded form has no slug in it, so it is only resolvable when the board is
   * also in the URL — which is why the hosted form is checked first.
   */
  refFromUrl(url) {
    const parsed = parseUrl(url);
    if (!parsed) return null;
    if (GREENHOUSE_HOSTS.has(parsed.hostname)) {
      const [slug, jobs, id] = parsed.pathname.split("/").filter(Boolean);
      if (slug && jobs === "jobs" && id && /^\d+$/.test(id)) return { board: slug, id };
    }
    return null;
  },
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
      // The board slug and the numeric id, kept for hydrate(). `absolute_url`
      // is frequently a branded careers page — nuro.ai/careersitem?gh_jid=…,
      // stripe.com/jobs/search?gh_jid=… — so it is not a reliable key.
      ...(str(job.id) || typeof job.id === "number" ? { ref: { board: slug, id: String(job.id) } } : {}),
    })));
  },

  probe: (urls, ctx) => probeBySingleFetch(urls, ctx, (url) => {
    const ref = greenhouse.refFromUrl?.(url);
    return ref
      ? `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.board)}/jobs/${encodeURIComponent(ref.id)}`
      : null;
  }),

  /**
   * One request per posting, against `/v1/boards/{slug}/jobs/{id}`.
   *
   * The list endpoint does take `?content=true`, which would make this free —
   * but it returns the description for EVERY posting on the board, and a big
   * board goes from 360 KB to 4.4 MB. Across a directory sweep that is
   * hundreds of megabytes to keep a few hundred descriptions. Twelve kilobytes
   * per surviving posting is the cheaper side of that trade by two orders of
   * magnitude.
   */
  async hydrate(postings, ctx) {
    const targets = postings.filter((posting) => posting.ref && !posting.description);
    await eachLimited(targets, HYDRATE_CONCURRENCY, async (posting) => {
      const { board, id } = posting.ref as { board: string; id: string };
      const api = assertHost(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(id)}`,
        (host) => GREENHOUSE_HOSTS.has(host),
        "greenhouse",
      );
      const detail = await ctx.fetchJson(api) as Record<string, unknown>;
      const content = str(detail?.content);
      if (content) posting.description = cleanDescription(content);
    });
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

const LEVER_API_HOSTS = new Set(["api.lever.co", "api.eu.lever.co"]);

/**
 * Everything Lever calls a posting, as one block of text.
 *
 * `descriptionPlain` alone is the intro paragraph. The requirements — the
 * section that actually says "Minimum 2 years of experience" — live in
 * `lists`, a separate array of titled HTML blocks, and reading only the
 * description means the years figure is never seen at all.
 */
function leverText(job: Record<string, unknown>): string {
  const lists = Array.isArray(job.lists) ? job.lists as Record<string, unknown>[] : [];
  return [
    str(job.descriptionPlain),
    ...lists.map((entry) => `${str(entry.text)}: ${str(entry.content)}`),
    str(job.additionalPlain),
  ].filter((part) => part && part !== ": ").join("\n\n");
}

const lever: Provider = {
  id: "lever",
  label: "Lever",
  detect: (company) => leverBoard(company) !== null,
  refFromUrl(url) {
    const parsed = parseUrl(url);
    if (!parsed || !/^jobs\.(?:eu\.)?lever\.co$/.test(parsed.hostname)) return null;
    const [slug, id] = parsed.pathname.split("/").filter(Boolean);
    const host = parsed.hostname === "jobs.eu.lever.co" ? "api.eu.lever.co" : "api.lever.co";
    return slug && id ? { board: `${host}/${slug}`, id } : null;
  },
  probe: (urls, ctx) => probeBySingleFetch(urls, ctx, (url) => {
    const ref = lever.refFromUrl?.(url);
    if (!ref) return null;
    const [host, slug] = ref.board.split("/");
    // Safe by construction — refFromUrl only ever writes one of the two API
    // hosts — but checked anyway, because "safe by construction" is a property
    // of code somebody else is free to change.
    return host && slug
      ? assertHost(
        `https://${host}/v0/postings/${encodeURIComponent(slug)}/${encodeURIComponent(ref.id)}`,
        (name) => LEVER_API_HOSTS.has(name),
        "lever",
      )
      : null;
  }),
  async hydrate(postings, ctx) {
    const targets = postings.filter((posting) => posting.ref);
    await eachLimited(targets, HYDRATE_CONCURRENCY, async (posting) => {
      const { board, id } = posting.ref as { board: string; id: string };
      const [host, slug] = board.split("/");
      if (!host || !slug) return;
      const api = assertHost(
        `https://${host}/v0/postings/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
        (name) => LEVER_API_HOSTS.has(name),
        "lever",
      );
      const detail = await ctx.fetchJson(api) as Record<string, unknown>;
      const text = leverText(detail);
      if (text) posting.description = cleanDescription(text);
    });
  },
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
      // Lever ships the whole posting in the LIST payload, so a description
      // costs nothing extra here — unlike every other board in this file.
      const description = leverText(job);
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
  refFromUrl(url) {
    const parsed = parseUrl(url);
    if (!parsed || parsed.hostname !== "jobs.ashbyhq.com") return null;
    const [slug, id] = parsed.pathname.split("/").filter(Boolean);
    // `/{slug}/{id}/application` is the apply link the community lists carry;
    // the id is in the same position either way.
    return slug && id ? { board: slug, id } : null;
  },

  /**
   * Ashby's board is the only thing that knows. The posting page answers 200
   * for a role that was pulled down weeks ago, so absence from the board is
   * the sole honest signal — and it is definitive, because the board is
   * exactly what listed the posting to begin with.
   */
  async probe(urls, ctx) {
    const verdicts = new Map<string, "live" | "dead">();
    const boards = new Map<string, { url: string; id: string }[]>();
    for (const url of urls) {
      const ref = ashby.refFromUrl?.(url);
      if (!ref) continue;
      const group = boards.get(ref.board);
      if (group) group.push({ url, id: ref.id });
      else boards.set(ref.board, [{ url, id: ref.id }]);
    }
    await eachLimited([...boards], HYDRATE_CONCURRENCY, async ([slug, group]) => {
      const api = assertHost(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
        (host) => host === "api.ashbyhq.com",
        "ashby",
      );
      const json = await ctx.fetchJson(api, { timeoutMs: 30_000 });
      const open = new Set(rows(json, "jobs").map((job) => str(job.id)));
      // Only meaningful when the board answered with something; an empty board
      // is far more likely to be a bad slug than every role closing at once.
      if (open.size === 0) return;
      for (const entry of group) verdicts.set(entry.url, open.has(entry.id) ? "live" : "dead");
    });
    return verdicts;
  },

  /**
   * Ashby publishes no per-posting endpoint, only the whole board — so this
   * reads the board once per employer and picks the postings out of it.
   *
   * That sounds expensive and is not, in the one situation it runs: a handful
   * of links harvested from a community list, spread across small boards, and
   * only after filtering. The board is fetched once per slug however many of
   * its postings are in the batch, which is the point of grouping here.
   */
  async hydrate(postings, ctx) {
    const boards = new Map<string, RawPosting[]>();
    for (const posting of postings) {
      if (!posting.ref) continue;
      const group = boards.get(posting.ref.board);
      if (group) group.push(posting);
      else boards.set(posting.ref.board, [posting]);
    }
    await eachLimited([...boards], HYDRATE_CONCURRENCY, async ([slug, group]) => {
      const api = assertHost(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
        (host) => host === "api.ashbyhq.com",
        "ashby",
      );
      const json = await ctx.fetchJson(api, { timeoutMs: 30_000 });
      const byId = new Map(rows(json, "jobs").map((job) => [str(job.id), str(job.descriptionPlain)]));
      for (const posting of group) {
        const description = byId.get(posting.ref?.id ?? "");
        if (description) posting.description = cleanDescription(description);
      }
    });
  },
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
      // `descriptionPlain` rides along in the SAME response — it is most of why
      // the payload is measured in megabytes. Reading it costs nothing; not
      // reading it was throwing away the only field that says how many years
      // of experience the employer wants.
      const description = str(job.descriptionPlain);
      return {
        title: str(job.title),
        url: str(job.jobUrl),
        company: company.name,
        location,
        postedAt: toDateString(job.publishedAt),
        ...(description ? { description: cleanDescription(description) } : {}),
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

/* ─────────────────────────── Workday ─────────────────────────── */

/**
 * Workday is where the enterprise half of the market actually lives — on a
 * sample of three thousand active new-grad postings it carried 27.5% of them,
 * more than Greenhouse, Ashby and Lever combined. Ported from career-ops's
 * `providers/workday.mjs` (MIT).
 *
 * Unlike the three directory ATSes it publishes no customer list, so there is
 * no way to enumerate tenants: this provider only ever works from a careers
 * URL the user supplied. That is a real ceiling, not an oversight.
 */
const WORKDAY_HOST = /^[a-z0-9][a-z0-9-]*\.wd\d+[a-z0-9-]*\.myworkdayjobs\.com$/;
/** The server caps a page at twenty however much more you ask for. */
const WORKDAY_PAGE = 20;
/**
 * Eight hundred postings from one employer, and no further.
 *
 * The CXS endpoint answers in about three seconds regardless of page size, so
 * this bound is a time budget rather than a data one: a large tenant read to
 * the end costs the better part of a minute, and the postings past the first
 * few hundred are the ones the title filter was always going to drop.
 */
const WORKDAY_MAX_PAGES = 40;

/**
 * Six pages in flight against one tenant.
 *
 * Higher than the hydrate default because each Workday tenant is its own
 * hostname — this is not the shared-host situation the other providers are
 * being careful about — and because a sequential walk of forty slow pages is
 * two minutes nobody will wait for.
 */
const WORKDAY_CONCURRENCY = 6;

interface WorkdaySite { origin: string; tenant: string; site: string }

/** `https://<tenant>.<wdN>.myworkdayjobs.com[/<locale>]/<site>` → its CXS coordinates. */
export function workdaySite(url: string): WorkdaySite | null {
  const parsed = parseUrl(url);
  if (!parsed || !WORKDAY_HOST.test(parsed.hostname)) return null;
  const tenant = parsed.hostname.split(".")[0];
  // A locale segment ("en-US") may sit in front of the site id, and skipping it
  // is the difference between the right board and a 404.
  const segments = parsed.pathname.split("/").filter(Boolean)
    .filter((segment) => !/^[a-z]{2}-[A-Z]{2}$/.test(segment));
  const site = segments[0];
  return tenant && site ? { origin: `https://${parsed.hostname}`, tenant, site } : null;
}

/**
 * Workday reports "Posted 5 Days Ago", never a date.
 *
 * "30+ Days Ago" is deliberately given up on rather than guessed at: it is
 * unbounded, and a posting dated wrongly at exactly 30 days would sail through
 * a freshness window it should not. hydrate() replaces this with the real
 * `startDate` for the postings that survive filtering.
 */
export function workdayPostedAt(label: string, now: number = Date.now()): string | undefined {
  if (/posted\s+today/i.test(label)) return toDateString(now);
  if (/posted\s+yesterday/i.test(label)) return toDateString(now - 86_400_000);
  const match = label.match(/posted\s+(\d+)(\+?)\s*day/i);
  if (!match || match[2] === "+") return undefined;
  return toDateString(now - Number(match[1]) * 86_400_000);
}

const workday: Provider = {
  id: "workday",
  label: "Workday",
  detect: (company) => workdaySite(company.url) !== null,
  refFromUrl(url) {
    const parsed = parseUrl(url);
    const site = workdaySite(url);
    if (!parsed || !site) return null;
    const path = parsed.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    // Everything after the site segment is the externalPath the CXS detail
    // endpoint expects, leading slash included.
    const index = path.indexOf(site.site);
    const external = index === -1 ? [] : path.slice(index + 1);
    return external.length > 0 ? { board: `${site.tenant}/${site.site}`, id: `/${external.join("/")}` } : null;
  },
  async fetch(company, ctx) {
    const site = workdaySite(company.url);
    if (!site) throw new Error(`workday: cannot derive a CXS endpoint from ${company.url}`);
    const api = assertHost(
      `${site.origin}/wday/cxs/${encodeURIComponent(site.tenant)}/${encodeURIComponent(site.site)}/jobs`,
      (host) => WORKDAY_HOST.test(host),
      "workday",
    );

    const page = async (index: number) => rows(
      await ctx.fetchJson(api, {
        body: { limit: WORKDAY_PAGE, offset: index * WORKDAY_PAGE, searchText: "", appliedFacets: {} },
      }),
      "jobPostings",
    );

    const first = await ctx.fetchJson(api, {
      body: { limit: WORKDAY_PAGE, offset: 0, searchText: "", appliedFacets: {} },
    }) as Record<string, unknown>;
    const total = typeof first.total === "number" ? first.total : 0;
    const batches: Record<string, unknown>[][] = [rows(first, "jobPostings")];
    const pages = Math.min(Math.ceil(total / WORKDAY_PAGE), WORKDAY_MAX_PAGES);

    if (company.since) {
      // Workday returns newest first — verified against three large tenants,
      // whose first page is all "Posted Today" / "Posted Yesterday". That
      // ordering is what makes a directory sweep affordable: read pages until
      // one falls entirely outside the freshness window and stop, so a small
      // employer costs one request and only a genuinely busy one costs more.
      const stale = (batch: Record<string, unknown>[]) => batch.every((job) => {
        const posted = workdayPostedAt(str(job.postedOn));
        // No date means the unbounded "30+ Days Ago" form: old by definition.
        return posted === undefined || posted < company.since!;
      });
      for (let index = 1; index < pages && !stale(batches[batches.length - 1]!); index += 1) {
        batches.push(await page(index));
      }
    } else {
      // Whole-board read, for a company the user named. Twenty rows per
      // request and a big employer runs to four figures, so the pages after
      // the first are fetched together.
      const remaining = Array.from({ length: Math.max(0, pages - 1) }, (_unused, index) => index + 1);
      await eachLimited(remaining, WORKDAY_CONCURRENCY, async (index) => {
        batches.push(await page(index));
      });
    }

    const postings: RawPosting[] = [];
    for (const job of batches.flat()) {
      const path = str(job.externalPath);
      if (!path.startsWith("/")) continue;
      const posted = workdayPostedAt(str(job.postedOn));
      postings.push({
        title: str(job.title),
        url: `${site.origin}/${site.site}${path}`,
        company: company.name,
        location: str(job.locationsText),
        ...(posted ? { postedAt: posted } : {}),
        ref: { board: `${site.tenant}/${site.site}`, id: path },
      });
    }
    return usable(postings);
  },

  probe: (urls, ctx) => probeBySingleFetch(urls, ctx, (url) => {
    const ref = workday.refFromUrl?.(url);
    if (!ref) return null;
    const [tenant, site] = ref.board.split("/");
    if (!tenant || !site) return null;
    try {
      return assertHost(
        `${new URL(url).origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}${ref.id}`,
        (host) => WORKDAY_HOST.test(host),
        "workday",
      );
    } catch {
      return null;
    }
  }),

  /**
   * The per-posting endpoint carries both the description and `startDate` —
   * an absolute date, which is the only way out of the relative "Posted 30+
   * Days Ago" label the listing gives.
   */
  async hydrate(postings, ctx) {
    const targets = postings.filter((posting) => posting.ref);
    await eachLimited(targets, HYDRATE_CONCURRENCY, async (posting) => {
      const { board, id } = posting.ref as { board: string; id: string };
      const [tenant, site] = board.split("/");
      const origin = new URL(posting.url).origin;
      if (!tenant || !site) return;
      const api = assertHost(
        `${origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}${id}`,
        (host) => WORKDAY_HOST.test(host),
        "workday",
      );
      const detail = await ctx.fetchJson(api) as Record<string, unknown>;
      const info = (detail?.jobPostingInfo ?? {}) as Record<string, unknown>;
      const description = str(info.jobDescription);
      if (description) posting.description = cleanDescription(description);
      const startDate = toDateString(info.startDate);
      if (startDate) posting.postedAt = startDate;
    });
  },
};

/* ─────────────────── markdown table feeds ─────────────────── */

/**
 * Rows of a GitHub-flavoured markdown table, split right-to-left.
 *
 * Left-to-right splitting is the obvious approach and it is wrong: real cells
 * contain pipes. Workable emits a department called "EU - Sales | Tech Sales &
 * Solution", which shifts every column after it by one and silently turns a
 * location into a job type. Counting from the end fixes the columns that
 * matter, because the overflowing cell is always in the middle.
 *
 * The header row comes back with the rest. Callers drop it for free by
 * requiring a link in the cell that should hold one, which is a check they
 * need against malformed rows anyway.
 */
export function markdownRows(text: string): string[][] {
  return text.split("\n")
    .filter((line) => line.trimStart().startsWith("|") && !/^\s*\|[\s|:-]+\|\s*$/.test(line))
    .map((line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 3);
}

/** The href of the first markdown or HTML link in a cell. */
export function cellLink(cell: string): string {
  return cell.match(/\]\((https?:\/\/[^\s)]+)\)/)?.[1]
    ?? cell.match(/href=["'](https?:\/\/[^"']+)["']/)?.[1]
    ?? "";
}

/** Cell text with links, emphasis and images stripped down to their label. */
export function cellText(cell: string): string {
  return cell
    .replace(/<img[^>]*>/gi, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ─────────────────────────── Workable ─────────────────────────── */

/**
 * Workable's JSON API needs a per-employer auth token, so this reads the
 * public markdown feed instead — the same choice career-ops made, and the
 * reason this provider looks unlike every other one in the file.
 *
 * A board with more than a handful of roles answers a bare `jobs.md` with a
 * page of search instructions rather than the table; passing any recognised
 * filter parameter switches it back to a listing.
 *
 * That listing is capped at thirty rows with no paging parameter of any kind
 * (page, offset, limit and per_page are all ignored), so a large Workable
 * board is read partially and knowingly. It is worth having anyway: Workable
 * is a low single-digit share of postings, and the community lists below
 * already surface its openings — this provider is what gives them a
 * description once they are found.
 */
const WORKABLE_HOST = "apply.workable.com";

function workableSlug(company: TrackedCompany): string | null {
  const parsed = parseUrl(company.url);
  if (!parsed || parsed.hostname !== WORKABLE_HOST) return null;
  return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
}

const workable: Provider = {
  id: "workable",
  label: "Workable",
  detect: (company) => workableSlug(company) !== null,
  async fetch(company, ctx) {
    const slug = workableSlug(company);
    if (!slug) throw new Error(`workable: cannot derive a board slug from ${company.url}`);
    // Any recognised filter parameter flips the page from search instructions
    // to the table, and the server does not actually apply an empty one — so
    // this is the cheapest way to ask for "everything".
    const feed = assertHost(
      `https://${WORKABLE_HOST}/${encodeURIComponent(slug)}/jobs.md?department=`,
      (host) => host === WORKABLE_HOST,
      "workable",
    );
    const markdown = await ctx.fetchText(feed);

    const postings: RawPosting[] = [];
    for (const cells of markdownRows(markdown)) {
      // Columns are Title | Department | Location | Type | Salary | Posted |
      // Details, and only Department is prone to carrying a stray pipe.
      const title = cellText(cells[0] ?? "");
      const details = cells[cells.length - 1] ?? "";
      const posted = cellText(cells[cells.length - 2] ?? "");
      const location = cellText(cells[cells.length - 5] ?? "");
      const link = cellLink(details);
      if (!title || !link) continue;
      const parsed = parseUrl(link);
      if (!parsed || parsed.hostname !== WORKABLE_HOST) continue;
      postings.push({
        title,
        // The feed links the machine-readable `.md`; the page a human opens is
        // the same URL without it.
        url: parsed.href.replace(/\.md$/, ""),
        company: company.name,
        location,
        ...(/^\d{4}-\d{2}-\d{2}$/.test(posted) ? { postedAt: posted } : {}),
        ref: { board: slug, id: parsed.href },
      });
    }
    return usable(postings);
  },

  /** Each row's `.md` detail page is the description, already as plain text. */
  async hydrate(postings, ctx) {
    const targets = postings.filter((posting) => posting.ref);
    await eachLimited(targets, HYDRATE_CONCURRENCY, async (posting) => {
      const { id } = posting.ref as { board: string; id: string };
      const api = assertHost(id, (host) => host === WORKABLE_HOST, "workable");
      const markdown = await ctx.fetchText(api);
      if (markdown.trim()) posting.description = cleanDescription(markdown);
    });
  },
};

/* ───────────────────── Aggregator feeds (no company) ───────────────────── */

const workingnomads: Provider = {
  id: "workingnomads",
  label: "Working Nomads",
  board: true,
  async fetch(_company, ctx) {
    const json = await ctx.fetchJson("https://www.workingnomads.com/api/exposed_jobs/");
    if (!Array.isArray(json)) throw new Error("workingnomads: expected a JSON array");
    return usable(json.map((raw) => {
      const job = raw as Record<string, unknown>;
      const description = str(job.description);
      return {
        title: str(job.title),
        url: str(job.url),
        company: str(job.company_name) || "Working Nomads",
        location: str(job.location) || "Remote",
        postedAt: toDateString(job.pub_date),
        ...(description ? { description: cleanDescription(description) } : {}),
      };
    }));
  },
};

/* ────────────────── community new-grad lists ────────────────── */

/**
 * Two crowd-maintained GitHub repositories of new-grad and early-career
 * openings, read as the JSON their maintainers already publish.
 *
 * These are not an ATS and they are not an aggregator scrape — they are lists
 * people curate by hand and by bot, and for an entry-level search they cover
 * ground nothing else here reaches. Measured against a snapshot of postings
 * matching a Bay-Area new-grad profile, the ATS providers in this file saw
 * about one in a hundred of what these two carry, because most of the rest
 * sits on Workday, on iCIMS, or on an employer's own portal.
 *
 * Two fields are worth the integration on their own:
 *
 *   - `active`, which the maintainers keep current. Every other source here
 *     discovers that a posting is dead only when the user clicks a 404.
 *   - `date_posted`, an absolute epoch, on boards that otherwise report
 *     nothing or report it relatively.
 *
 * The URLs point at whatever ATS the employer actually uses, so descriptions
 * are filled in afterwards by that ATS's own provider — see
 * `hydrateDescriptions`.
 *
 * The repository paths carry a graduating year and get renamed each cycle
 * (New-Grad-2026 became New-Grad-2027). A rename surfaces as this source
 * failing with an HTTP 404 on the next scan, which is the honest place for it:
 * the fix is a one-line constant, and guessing at the current year in code
 * would turn a loud failure into a silent empty board.
 */
interface ListingsFeed { id: string; label: string; url: string; fallbackCompany: string }

const LISTING_FEEDS: readonly ListingsFeed[] = [
  {
    id: "simplify",
    label: "SimplifyJobs New Grad",
    url: "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
    fallbackCompany: "SimplifyJobs",
  },
  {
    id: "newgradlist",
    label: "New-Grad list (vanshb03)",
    url: "https://raw.githubusercontent.com/vanshb03/New-Grad-2027/dev/.github/scripts/listings.json",
    fallbackCompany: "New-Grad list",
  },
];

const GITHUB_RAW_HOST = "raw.githubusercontent.com";

/**
 * One listings.json into postings.
 *
 * Exported for tests: the two feeds share a schema, and the parts worth
 * pinning down — dropping closed rows, reading an epoch in seconds, folding a
 * location array — are the same for both.
 */
export function parseListings(data: unknown, fallbackCompany: string): RawPosting[] {
  if (!Array.isArray(data)) throw new Error("listings: expected a JSON array");
  return usable(data.flatMap((raw) => {
    const job = (raw ?? {}) as Record<string, unknown>;
    // The maintainers keep these current, and a closed row is the one thing
    // every other source in this file cannot tell us.
    if (job.active === false || job.is_visible === false) return [];
    const locations = Array.isArray(job.locations)
      ? [...new Set(job.locations.map((entry) => str(entry)).filter(Boolean))]
      : [];
    // Seconds, not milliseconds — Date.parse would read 1767841111 as 1970.
    const posted = typeof job.date_posted === "number" && job.date_posted > 0
      ? toDateString(job.date_posted * 1000)
      : undefined;
    return [{
      title: str(job.title),
      url: str(job.url),
      company: str(job.company_name) || fallbackCompany,
      location: locations.join(" · "),
      ...(posted ? { postedAt: posted } : {}),
    }];
  }));
}

const listingFeedProviders: Provider[] = LISTING_FEEDS.map((feed) => ({
  id: feed.id,
  label: feed.label,
  board: true,
  async fetch(_company, ctx) {
    const api = assertHost(feed.url, (host) => host === GITHUB_RAW_HOST, feed.id);
    // Twelve megabytes for the larger of the two, once per scan. Generous
    // beside the default, which this would otherwise race on a slow link.
    return parseListings(await ctx.fetchJson(api, { timeoutMs: 60_000 }), feed.fallbackCompany);
  },
}));

/**
 * A third community list, published as markdown tables rather than JSON.
 *
 * Kept separate from the two above because the format is the whole difference:
 * there is no `active` flag and no epoch, only a "3d" age column, so what it
 * adds is breadth and a salary figure rather than the liveness signal.
 */
const SPEEDYAPPLY_URL = "https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/NEW_GRAD_USA.md";

/** "3d" / "2mo" / "14h" → a calendar date, or undefined when it is not an age. */
export function ageToDate(age: string, now: number = Date.now()): string | undefined {
  const match = age.trim().match(/^(\d{1,3})\s*(h|d|w|mo|y)$/i);
  if (!match) return undefined;
  const scale = { h: 3_600_000, d: 86_400_000, w: 604_800_000, mo: 2_592_000_000, y: 31_536_000_000 };
  const unit = scale[match[2]!.toLowerCase() as keyof typeof scale];
  return unit ? toDateString(now - Number(match[1]) * unit) : undefined;
}

const speedyapply: Provider = {
  id: "speedyapply",
  label: "SpeedyApply New Grad (US)",
  board: true,
  async fetch(_company, ctx) {
    const api = assertHost(SPEEDYAPPLY_URL, (host) => host === GITHUB_RAW_HOST, "speedyapply");
    const markdown = await ctx.fetchText(api, { timeoutMs: 60_000 });
    const postings: RawPosting[] = [];
    for (const cells of markdownRows(markdown)) {
      // Two table shapes in the same file: the FAANG and Quant sections carry
      // Company | Position | Location | Salary | Posting | Age, and the much
      // larger "Other" section drops Salary. Reading Company/Position/Location
      // from the left and Posting/Age from the right lands both without having
      // to know which section a row came from.
      if (cells.length < 5) continue;
      const company = cellText(cells[0] ?? "");
      const title = cellText(cells[1] ?? "");
      const location = cellText(cells[2] ?? "");
      const url = cellLink(cells[cells.length - 2] ?? "");
      const posted = ageToDate(cellText(cells[cells.length - 1] ?? ""));
      if (!title || !url) continue;
      postings.push({
        title,
        url,
        company: company || "SpeedyApply",
        location,
        ...(posted ? { postedAt: posted } : {}),
      });
    }
    return usable(postings);
  },
};

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
      const description = str(job.description);
      return {
        title: str(job.position),
        url: str(job.url),
        company: str(job.company) || "RemoteOK",
        location: str(job.location) || "Remote",
        postedAt: toDateString(job.date),
        ...(description ? { description: cleanDescription(description) } : {}),
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
    return usable(rows(json, "jobs").map((job) => {
      const description = str(job.description);
      return {
        title: str(job.title),
        url: str(job.url),
        company: str(job.company_name) || "Remotive",
        location: str(job.candidate_required_location) || "Remote",
        postedAt: toDateString(job.publication_date),
        ...(description ? { description: cleanDescription(description) } : {}),
      };
    }));
  },
};

/* ─────────────────────── SolidJobs (Poland) ─────────────────────── */

/**
 * A regional board, carried for parity with career-ops's provider set.
 *
 * Off unless someone points a company entry at it, and worth nothing to a
 * search filtered to one country — which is exactly why it is a checkbox
 * rather than a default. The public endpoint refuses a request without a
 * `campaign` parameter but does not validate the value, so one is supplied
 * when the configured URL omits it.
 */
const SOLIDJOBS_HOST = "solid.jobs";

function solidJobsUrl(company: TrackedCompany): string | null {
  const parsed = parseUrl(company.url);
  if (!parsed || parsed.hostname !== SOLIDJOBS_HOST) return null;
  if (!parsed.pathname.startsWith("/public-api/offers/")) return null;
  if (!parsed.searchParams.get("campaign")) parsed.searchParams.set("campaign", "robin-jobs");
  return parsed.toString();
}

const solidjobs: Provider = {
  id: "solidjobs",
  label: "SolidJobs",
  detect: (company) => solidJobsUrl(company) !== null,
  async fetch(company, ctx) {
    const url = solidJobsUrl(company);
    if (!url) throw new Error(`solidjobs: expected https://solid.jobs/public-api/offers/<division>, got ${company.url}`);
    const api = assertHost(url, (host) => host === SOLIDJOBS_HOST, "solidjobs");
    const json = await ctx.fetchJson(api, { timeoutMs: 30_000 });
    return usable(rows(json, "jobs").map((job) => {
      const locations = Array.isArray(job.locations)
        ? (job.locations as unknown[]).map((entry) => str(entry)).filter(Boolean)
        : [str(job.locations)].filter(Boolean);
      const description = str(job.description);
      return {
        title: str(job.title),
        url: str(job.url),
        company: str(job.company) || company.name,
        location: locations.join(", "),
        postedAt: toDateString(job.publishedDate ?? job.createdDate),
        ...(description ? { description: cleanDescription(description) } : {}),
      };
    }));
  },
};

/* ──────────────────────────── IBM ──────────────────────────── */

/**
 * IBM runs its careers site on its own search backend rather than an ATS, so
 * it gets a provider of its own — the one single-employer special case here,
 * carried over from career-ops.
 *
 * It is a board rather than a company entry because there is nothing to
 * configure: the endpoint is IBM's and only IBM's. The payload carries a
 * description and a seniority band, so postings arrive already scoreable.
 */
const IBM_API = "https://www-api.ibm.com/search/api/v2";
const IBM_PAGE = 50;
const IBM_MAX_RECORDS = 500;

const ibm: Provider = {
  id: "ibm",
  label: "IBM Careers",
  board: true,
  async fetch(_company, ctx) {
    const api = assertHost(IBM_API, (host) => host === "www-api.ibm.com", "ibm");
    const postings: RawPosting[] = [];
    for (let from = 0; from < IBM_MAX_RECORDS; from += IBM_PAGE) {
      const json = await ctx.fetchJson(api, {
        timeoutMs: 30_000,
        body: {
          appId: "careers",
          scopes: ["careers2"],
          query: { bool: { must: [] } },
          size: IBM_PAGE,
          from,
          sort: [{ _score: "desc" }],
          lang: "zz",
          localeSelector: {},
          sm: { query: "", lang: "zz" },
          _source: [
            "_id", "title", "url", "description",
            // Country, city and the seniority band, in IBM's own field names.
            "field_keyword_05", "field_keyword_18", "field_keyword_19",
          ],
        },
      });
      const hits = ((json as Record<string, unknown>)?.hits as Record<string, unknown> | undefined)?.hits;
      const batch = Array.isArray(hits) ? hits : [];
      if (batch.length === 0) break;
      for (const hit of batch) {
        const row = ((hit as Record<string, unknown>)?._source ?? {}) as Record<string, unknown>;
        const description = str(row.description);
        // The seniority band is not in the title, so it is prepended to the
        // description where the scorer and the years extractor both see it.
        const band = str(row.field_keyword_18);
        postings.push({
          title: str(row.title),
          url: str(row.url),
          company: "IBM",
          location: [str(row.field_keyword_19), str(row.field_keyword_05)].filter(Boolean).join(", "),
          ...(description || band
            ? { description: cleanDescription([band && `Level: ${band}`, description].filter(Boolean).join("\n\n")) }
            : {}),
        });
      }
      if (batch.length < IBM_PAGE) break;
    }
    return usable(postings);
  },
};

/**
 * Probe by asking the endpoint that serves one posting.
 *
 * A 404 is the board saying the posting is gone. Every other failure is the
 * network having an opinion about something else, and is reported as unknown.
 */
async function probeBySingleFetch(
  urls: readonly string[],
  ctx: FetchContext,
  endpoint: (url: string) => string | null,
): Promise<Map<string, "live" | "dead">> {
  const verdicts = new Map<string, "live" | "dead">();
  await eachLimited([...urls], HYDRATE_CONCURRENCY, async (url) => {
    const api = endpoint(url);
    if (!api) return;
    try {
      await ctx.fetchJson(api);
      verdicts.set(url, "live");
    } catch (error) {
      if (/HTTP 40[04]|HTTP 410/.test(error instanceof Error ? error.message : "")) {
        verdicts.set(url, "dead");
      }
    }
  });
  return verdicts;
}

/* ────────────────── reading a board nobody here owns ────────────────── */

/**
 * Read a job description off a careers page that has no API.
 *
 * Every other reader in this file talks to an endpoint whose host was on an
 * allow-list before the request went out. This one cannot: the whole point is
 * the postings that live on an employer's own portal — TikTok, ByteDance,
 * Oracle's hosted CX, a hundred one-off sites — which is where roughly half of
 * the early-career market actually sits.
 *
 * So the allow-list is replaced by a narrower set of promises, and they are
 * the reason this is safe enough to ship:
 *
 *   - it only ever runs on a URL that a provider already parsed out of a
 *     response we validated, and only AFTER the title/location/freshness
 *     filters — never on something a user typed, never during discovery,
 *   - HTTPS only, and private, loopback and link-local addresses are refused,
 *     so a redirect cannot turn this into a probe of the machine it runs on,
 *   - GET only; no provider here has any business sending a POST to a host it
 *     does not know,
 *   - at most one redirect, and the hop is re-checked against the same rules,
 *   - the body is capped, the request is timed out, and nothing in the
 *     response is ever executed — it is parsed as text and handed to the
 *     scorer inside <<untrusted-posting>> markers like every other description.
 *
 * Off unless the profile turns it on. Trading a host allow-list for a set of
 * rules is a real reduction in the guarantee, and that should be a decision
 * somebody made rather than a default they inherited.
 */
const UNKNOWN_BOARD_TIMEOUT_MS = 20_000;
const UNKNOWN_BOARD_MAX_BYTES = 2_000_000;

/** Hosts that must never be reachable from a URL we did not choose. */
const PRIVATE_HOST = /^(?:localhost|.*\.local|.*\.internal|\[?::1\]?|0\.0\.0\.0)$/i;
const PRIVATE_IPV4 = /^(?:10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./;

/**
 * A domain name, as opposed to an address wearing one as a costume.
 *
 * Blocking private ranges by pattern is not enough on its own, because an IPv4
 * address has more spellings than the dotted-decimal one: `0x7f.0.0.1` and
 * `0177.0.0.1` both reach 127.0.0.1 through the hex and octal forms that
 * inet_aton still accepts, and neither looks anything like `127.`. Rather than
 * chase the encodings, require what a careers page actually has and an address
 * never does — a last label that is alphabetic.
 *
 * This also refuses public bare IPs, which is the right answer for this
 * caller: a job posting lives at a hostname.
 */
const DOMAIN_NAME = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

/**
 * Whether a hostname is safe to fetch from a link we did not choose.
 *
 * String inspection only, and that is a real limit worth naming: a perfectly
 * ordinary domain whose A record points at 10.0.0.5 passes every check here,
 * because the address is not known until resolution and fetch does not offer a
 * hook there. What this does guarantee is that nothing in a posting's URL can
 * name a private target directly, in any of the encodings that would resolve
 * to one.
 */
export function isPublicWebHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || PRIVATE_HOST.test(host) || PRIVATE_IPV4.test(host)) return false;
  // Unique-local and link-local IPv6.
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return false;
  return DOMAIN_NAME.test(host);
}

function unentity(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_unused, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_unused, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function detag(html: string): string {
  return unentity(html.replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/**
 * How much of this reads like prose rather than a serialized blob.
 *
 * Career pages routinely inline their whole theme config as HTML-escaped JSON,
 * and a naive text extraction happily returns two hundred kilobytes of CSS
 * variables. Scoring candidates instead of trusting the first one is what
 * keeps that out of the model's context.
 */
export function proseRatio(text: string): number {
  const junk = (text.match(/[{}[\]|\\^~`=]|":/g) ?? []).length;
  const words = (text.match(/[A-Za-z]{3,}/g) ?? []).length;
  if (words === 0) return 0;
  return Math.max(0, 1 - (junk * 6) / (words + junk * 6));
}

/**
 * Does this read like a job posting, or merely like text?
 *
 * The failure that makes this necessary: a client-rendered careers page ships
 * no description at all, the extractor dutifully returns the largest prose
 * block it can find, and the scorer ends up judging a machine-learning role
 * against two press releases about a robotaxi launch. Prose-likeness cannot
 * catch that — those headlines are perfectly good prose.
 *
 * A wrong description is worse than none: none leaves the posting scored on
 * its title, which is honest, while a wrong one is confidently misleading. So
 * the bar is a handful of the words every real posting contains somewhere.
 */
const JOB_VOCABULARY = [
  /\bresponsibilit/i, /\bqualificat/i, /\brequirement/i, /\bexperience\b/i,
  /\byou will\b/i, /\bwe(?:'re| are) looking for\b/i, /\byour role\b/i,
  /\bskills?\b/i, /\bpreferred\b/i, /\bminimum\b/i, /\bbachelor/i, /\bdegree\b/i,
  /\bthe role\b/i, /\bthis role\b/i, /\bcandidate/i, /\bapply\b/i,
  /\bcompensation\b/i, /\bbenefits\b/i, /\bteam\b/i, /\bproficien/i,
];

export function looksLikeJobDescription(text: string): boolean {
  return JOB_VOCABULARY.filter((pattern) => pattern.test(text)).length >= 3;
}

/** JSON-LD is the one standard here, so it wins when a page bothers to emit it. */
function fromJsonLd(html: string): string | null {
  for (const match of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1] ?? "");
    } catch {
      continue;
    }
    const walk = (node: unknown): string | null => {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node)) {
        for (const entry of node) {
          const found = walk(entry);
          if (found) return found;
        }
        return null;
      }
      const record = node as Record<string, unknown>;
      if (record["@type"] === "JobPosting" && typeof record.description === "string") {
        return record.description;
      }
      for (const value of Object.values(record)) {
        const found = walk(value);
        if (found) return found;
      }
      return null;
    };
    const found = walk(parsed);
    if (found) return detag(found);
  }
  return null;
}

/**
 * The visible prose, with the page furniture dropped.
 *
 * Navigation is many short fragments and a job description is a few long ones,
 * so keeping only substantial blocks removes the header, the footer and the
 * cookie banner without needing a DOM. On a real TikTok posting this is the
 * difference between starting at "Diversity & Inclusion Our Philosophy Hear
 * From Our Leader" and starting at the first line of the actual role.
 */
function fromBody(html: string): string {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(nav|header|footer)[\s\S]*?<\/\1>/gi, " ");
  const blocks = body.split(/<\/(?:p|div|li|section|article|h[1-6]|td)>/i).map(detag).filter(Boolean);
  const substantial = blocks.filter((block) => block.length >= 180);
  return (substantial.length > 0 ? substantial : blocks.filter((block) => block.length >= 60)).join("\n");
}

/** Description-shaped string values in whatever JSON the page inlined. */
function fromEmbeddedJson(html: string): string[] {
  const pattern = /"(?:description|jobDescription|job_description|descriptionHtml|jobDescriptionText)"\s*:\s*"((?:[^"\\]|\\.)*)"/gi;
  const found: string[] = [];
  // Once raw and once decoded: some sites inline JSON inside an HTML
  // attribute, where every quote arrives as &#34;.
  for (const source of [html, unentity(html)]) {
    for (const match of source.matchAll(pattern)) {
      const value = detag((match[1] ?? "")
        .replace(/\\n/g, "\n").replace(/\\t/g, " ").replace(/\\"/g, '"')
        .replace(/\\u003c/gi, "<").replace(/\\u003e/gi, ">").replace(/\\\//g, "/"));
      if (value.length > 200) found.push(value);
    }
  }
  return found;
}

/**
 * Best-effort description for one posting on a board this file does not own.
 *
 * Returns null rather than throwing on anything at all — a page that will not
 * give up its text leaves the posting exactly as it was, scored on its title
 * the way it is today.
 */
export async function readUnknownBoard(url: string, ctx: FetchContext): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !isPublicWebHost(parsed.hostname)) return null;

  let html: string;
  try {
    html = await ctx.fetchText(parsed.toString(), {
      timeoutMs: UNKNOWN_BOARD_TIMEOUT_MS,
      maxBytes: UNKNOWN_BOARD_MAX_BYTES,
      redirects: 1,
      allowHost: isPublicWebHost,
    });
  } catch {
    return null;
  }

  const candidates = [fromJsonLd(html), ...fromEmbeddedJson(html), fromBody(html)]
    .filter((entry): entry is string => Boolean(entry) && entry!.length > 200);
  if (candidates.length === 0) return null;
  // Longest wins, but only after being discounted for looking like a blob.
  const best = candidates.reduce((winner, entry) =>
    Math.min(entry.length, 6000) * proseRatio(entry) > Math.min(winner.length, 6000) * proseRatio(winner)
      ? entry
      : winner);
  if (proseRatio(best) <= 0.6 || !looksLikeJobDescription(best)) return null;
  return cleanDescription(best);
}

/**
 * Which of these postings are no longer open.
 *
 * Runs on a digest batch — ten links, twice a day — not on the store, because
 * that is the only moment the answer matters: a stale row costs nothing until
 * it becomes a notification the user taps and lands on a 404. Four of the
 * first sixty-five pushes this feature sent were already dead on arrival.
 *
 * Only definite "dead" verdicts come back. A board that timed out, refused the
 * request or answered with a shrug leaves its posting alone, because the
 * failure mode to avoid is dropping a good job over a bad minute.
 */
export async function findDeadPostings(
  urls: readonly string[],
  ctx: FetchContext,
): Promise<Set<string>> {
  const byProvider = new Map<Provider, string[]>();
  for (const url of urls) {
    const owner = PROVIDERS.find((provider) => provider.probe && provider.refFromUrl?.(url));
    if (!owner) continue;
    const group = byProvider.get(owner);
    if (group) group.push(url);
    else byProvider.set(owner, [url]);
  }

  const dead = new Set<string>();
  await Promise.all([...byProvider].map(async ([provider, group]) => {
    const verdicts = await provider.probe!(group, ctx).catch(() => new Map());
    for (const [url, verdict] of verdicts) if (verdict === "dead") dead.add(url);
  }));
  return dead;
}

/* ───────────────────────────── registry ───────────────────────────── */

/** Alphabetical, so detect() precedence is the same on every machine. */
export const PROVIDERS: readonly Provider[] = [
  ashby,
  greenhouse,
  lever,
  recruitee,
  remoteok,
  remotive,
  ibm,
  smartrecruiters,
  solidjobs,
  speedyapply,
  workable,
  workday,
  workingnomads,
  ...listingFeedProviders,
].sort((a, b) => a.id.localeCompare(b.id));

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
/**
 * Fill in descriptions on postings that survived filtering.
 *
 * Dispatches back to whichever provider produced each posting, because only
 * that provider knows how to ask its own board for the text. Providers whose
 * list endpoint already carried a description have no `hydrate` and are
 * skipped, which is the common case and the cheap one.
 *
 * Best-effort throughout: a board that will not serve descriptions today gives
 * back postings exactly as they arrived, and the scan continues. Losing a
 * description costs accuracy on one posting; throwing here would cost the
 * whole run.
 */
export interface HydrateOptions {
  /**
   * Also read careers pages on hosts no provider owns. Off by default — see
   * `readUnknownBoard` for what that trades away.
   */
  readUnknownBoards?: boolean;
}

export async function hydrateDescriptions(
  postings: readonly (RawPosting & { source: string })[],
  ctx: FetchContext,
  options: HydrateOptions = {},
): Promise<void> {
  const bySource = new Map<string, RawPosting[]>();
  for (const posting of postings) {
    if (posting.description) continue;
    const group = bySource.get(posting.source);
    if (group) group.push(posting);
    else bySource.set(posting.source, [posting]);
  }

  await Promise.all([...bySource].map(async ([source, group]) => {
    const provider = providerById(source);
    if (provider?.hydrate) {
      await provider.hydrate(group, ctx).catch(() => {});
      return;
    }
    // The source has no description of its own — a community list, say, which
    // carries an apply link and nothing else. Route each posting to whichever
    // provider owns the ATS the link points at.
    await hydrateByUrl(group, ctx, options);
  }));
}

/**
 * Last resort: work out the ATS from the posting URL and use its hydrate.
 *
 * This is what makes the community new-grad lists more than a pile of titles.
 * Only providers that can both recover a `ref` from a public URL and fetch a
 * description from it participate, so a link into an ATS nobody here reads is
 * left alone rather than guessed at.
 */
async function hydrateByUrl(
  postings: RawPosting[],
  ctx: FetchContext,
  options: HydrateOptions,
): Promise<void> {
  const byProvider = new Map<Provider, RawPosting[]>();
  const unclaimed: RawPosting[] = [];
  for (const posting of postings) {
    const owner = PROVIDERS.find((provider) => {
      if (!provider.hydrate || !provider.refFromUrl) return false;
      const ref = provider.refFromUrl(posting.url);
      if (!ref) return false;
      posting.ref = ref;
      return true;
    });
    if (!owner) {
      unclaimed.push(posting);
      continue;
    }
    const group = byProvider.get(owner);
    if (group) group.push(posting);
    else byProvider.set(owner, [posting]);
  }

  await Promise.all([
    ...[...byProvider].map(([provider, group]) => provider.hydrate!(group, ctx).catch(() => {})),
    // Whatever is left sits on an employer's own portal. Reading those is the
    // difference between scoring a TikTok new-grad posting on its title and
    // scoring it on what the posting actually asks for.
    options.readUnknownBoards === true
      ? eachLimited(unclaimed, HYDRATE_CONCURRENCY, async (posting) => {
        const description = await readUnknownBoard(posting.url, ctx);
        if (description) posting.description = description;
      })
      : Promise.resolve(),
  ]);
}

export function resolveProvider(company: TrackedCompany): Provider | null {
  if (company.provider) return providerById(company.provider) ?? null;
  return COMPANY_PROVIDERS.find((provider) => provider.detect?.(company)) ?? null;
}
