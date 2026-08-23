/**
 * One scan run: ask every enabled source what it has, keep what matches the
 * profile, and merge the survivors into the job store.
 *
 * Costs no model tokens — it is HTTP and string comparison, which is why it is
 * safe to run twice a day unattended. The only expensive step in this feature
 * is scoring, and that happens elsewhere, on the handful of postings that get
 * through here.
 *
 * Server-only: reaches node:fs through ./store.ts.
 */
import {
  assertJobUrl,
  buildLocationFilter,
  buildTitleFilter,
  extractYearsRequired,
  isBlacklisted,
  jobKey,
  type Job,
  type JobProfile,
  type TrackedCompany,
} from "./jobs.ts";
import {
  hydrateDescriptions,
  makeFetchContext,
  resolveProvider,
  providerById,
  type FetchContext,
  type RawPosting,
} from "./job-providers.ts";
import { newId } from "./paths.ts";
import {
  readJobProfile,
  readJobs,
  writeJobScanState,
  writeJobs,
  type JobScanState,
} from "./store.ts";

/**
 * Six at a time. Several of these providers serve their whole customer base
 * from one hostname, so a higher number is not more parallelism — it is more
 * requests to the same server, and a throttled scan loses live boards quietly
 * rather than failing loudly.
 */
const CONCURRENCY = 6;

/**
 * Jobs are kept this long after discovery unless you shortlisted or applied.
 * Without a bound the store grows forever and the dedup set with it; with one,
 * a posting you ignored twice stops costing anything.
 */
const RETENTION_DAYS = 60;

/** A posting plus the provider that produced it — providers do not label themselves. */
export type ScannedPosting = RawPosting & { source: string };

export interface ScanSourceResult {
  id: string;
  name: string;
  count: number;
  error?: string;
}

export interface ScanResult extends JobScanState {
  sources: ScanSourceResult[];
}

/** YYYY-MM-DD, `days` before today, in UTC to match provider-reported dates. */
function cutoffDate(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Run `worker` over `items`, at most `limit` in flight. */
async function pooled<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * The postings a profile admits, with the reason each survivor got in.
 *
 * Exported so the filters can be tested against fixtures without a network:
 * every rule that decides whether a job ever reaches you is in here.
 */
export function filterPostings(
  postings: ScannedPosting[],
  profile: JobProfile,
): ScannedPosting[] {
  const matchesTitle = buildTitleFilter(profile.titles, profile.excludeTitles);
  const matchesLocation = buildLocationFilter({
    always: profile.locationAlways,
    allow: profile.locationAllow,
    block: profile.locationBlock,
  });
  const cutoff = profile.sinceDays > 0 ? cutoffDate(profile.sinceDays) : null;

  return postings.filter((posting) => {
    if (matchesTitle(posting.title) === null) return false;
    if (!matchesLocation(posting.location)) return false;
    if (isBlacklisted(posting.company, profile.blacklist)) return false;
    // A posting with no date is kept: most boards that omit it omit it for
    // every row, and dropping them would silently disable those sources.
    if (cutoff && posting.postedAt && posting.postedAt < cutoff) return false;
    return true;
  });
}

/**
 * Merge fresh postings into the existing store.
 *
 * A posting already known keeps its row untouched — its score, its status and
 * its `notifiedAt` are the whole point of having a store, and re-discovering a
 * job you dropped must not resurrect it.
 */
export function mergePostings(
  existing: Job[],
  postings: ScannedPosting[],
  now: string = new Date().toISOString(),
): { jobs: Job[]; added: number } {
  const seen = new Set(existing.map((job) => jobKey(job.url)));
  const sameRole = new Set(existing.map(roleKey));
  const added: Job[] = [];

  for (const posting of postings) {
    let url: string;
    try {
      url = assertJobUrl(posting.url);
    } catch {
      continue;
    }
    const key = jobKey(url);
    if (seen.has(key)) continue;
    // Employers re-post one opening under several posting ids — one seen here
    // filled four slots in a ten-job digest, and the scorer's own reason line
    // read "duplicate of its twin". The URL key cannot catch that because the
    // ids genuinely differ; company, title and location together can.
    const role = roleKey(posting);
    if (sameRole.has(role)) continue;
    seen.add(key);
    sameRole.add(role);
    const years = posting.description ? extractYearsRequired(posting.description) : null;
    added.push({
      id: newId(),
      url,
      company: posting.company,
      title: posting.title,
      location: posting.location,
      ...(posting.postedAt ? { postedAt: posting.postedAt } : {}),
      source: posting.source,
      ...(posting.description ? { description: posting.description } : {}),
      // Read once, here, rather than every time something wants to know. The
      // description is capped, so this is the only place the full text and the
      // number are guaranteed to agree.
      ...(years === null ? {} : { yearsRequired: years }),
      discoveredAt: now,
      status: "new",
    });
  }

  return { jobs: [...existing, ...added], added: added.length };
}

/**
 * Identity of the ROLE rather than the posting.
 *
 * Location is part of it deliberately: the same title at the same employer in
 * two cities is two jobs a candidate would choose between, and collapsing
 * those would hide one of them for good. Only an exact triple repeat is
 * treated as the same opening posted twice.
 */
function roleKey(posting: { company: string; title: string; location: string }): string {
  const flat = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  return `${flat(posting.company)}\u0000${flat(posting.title)}\u0000${flat(posting.location)}`;
}

/** Drop stale rows you never acted on; keep everything you did. */
export function pruneJobs(jobs: Job[], now: number = Date.now()): Job[] {
  const cutoff = new Date(now - RETENTION_DAYS * 86_400_000).toISOString();
  return jobs.filter((job) =>
    job.status === "shortlist" || job.status === "applied" || (job.discoveredAt ?? "") >= cutoff);
}

interface ScanSource {
  key: string;
  name: string;
  run: (ctx: FetchContext) => Promise<ScannedPosting[]>;
}

/** The sources a profile turns on, as (label, fetcher) pairs. */
function enabledSources(profile: JobProfile): ScanSource[] {
  const sources: ScanSource[] = [];

  for (const company of profile.companies) {
    if (!company.enabled) continue;
    const provider = resolveProvider(company);
    if (!provider) {
      sources.push({
        key: company.id,
        name: company.name,
        run: async () => {
          throw new Error(
            `No provider recognises ${company.url}. Supported boards: Greenhouse, Lever, Ashby, `
            + "SmartRecruiters, Recruitee, Workday, Workable.",
          );
        },
      });
      continue;
    }
    sources.push({
      key: company.id,
      name: company.name,
      run: async (ctx) => (await provider.fetch(company, ctx)).map((posting) => ({ ...posting, source: provider.id })),
    });
  }

  for (const id of profile.boards) {
    const provider = providerById(id);
    if (!provider?.board) continue;
    // Board feeds carry their own employer names, so the placeholder company
    // here is only a label the provider is free to ignore.
    const placeholder: TrackedCompany = { id, name: provider.label, url: "", enabled: true };
    sources.push({
      key: id,
      name: provider.label,
      run: async (ctx) => (await provider.fetch(placeholder, ctx)).map((posting) => ({ ...posting, source: provider.id })),
    });
  }

  return sources;
}

/**
 * Scan, filter, merge, persist.
 *
 * A source that fails is recorded and skipped: one board being down or having
 * changed its URL must not cost you the other twenty.
 */
export async function runJobScan(options: { fetchImpl?: typeof fetch; profile?: JobProfile } = {}): Promise<ScanResult> {
  const startedAt = new Date().toISOString();
  const profile = options.profile ?? readJobProfile();
  const ctx = makeFetchContext(options.fetchImpl ?? fetch);
  const sources = enabledSources(profile);

  const results = await pooled(sources, CONCURRENCY, async (source): Promise<{ result: ScanSourceResult; postings: ScannedPosting[] }> => {
    try {
      const postings = await source.run(ctx);
      return {
        result: { id: source.key, name: source.name, count: postings.length },
        postings,
      };
    } catch (error) {
      return {
        result: {
          id: source.key,
          name: source.name,
          count: 0,
          error: error instanceof Error ? error.message : String(error),
        },
        postings: [],
      };
    }
  });

  const postings = results.flatMap((entry) => entry.postings);
  const matched = filterPostings(postings, profile);
  // After the filters, never before. A description is what lets the scorer see
  // the years of experience a posting asks for, and boards that only serve one
  // per-posting are affordable exactly once the list is down to the handful
  // that will actually be scored.
  await hydrateDescriptions(matched, ctx);
  const merged = mergePostings(pruneJobs(readJobs()), matched);
  writeJobs(merged.jobs);

  const state: ScanResult = {
    startedAt,
    finishedAt: new Date().toISOString(),
    scanned: postings.length,
    matched: matched.length,
    added: merged.added,
    sources: results.map((entry) => entry.result),
  };
  writeJobScanState(state);
  return state;
}
