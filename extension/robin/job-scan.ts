/**
 * One scan run over the companies and feeds the profile names.
 *
 * This module answers "what is open where I told you to look". It resolves the
 * profile's sources, asks each one what it has, and reports what happened per
 * source — then hands the result to ./job-intake.ts, which owns everything
 * from admission to persistence and is shared with the directory sweep.
 *
 * Costs no model tokens — HTTP and string comparison, which is why it is safe
 * to run twice a day unattended. The only expensive step in this feature is
 * scoring, and that happens elsewhere, on the handful of postings that get
 * through intake.
 *
 * Server-only: reaches node:fs through ./job-intake.ts and ./store.ts.
 */
import { type JobProfile, type TrackedCompany } from "./jobs.ts";
import { absorb, admitPostings, type ScannedPosting } from "./job-intake.ts";
import {
  makeFetchContext,
  resolveProvider,
  providerById,
  type FetchContext,
} from "./job-providers.ts";
import { readJobProfile, writeJobScanState, type JobScanState } from "./store.ts";

/**
 * Six at a time. Several of these providers serve their whole customer base
 * from one hostname, so a higher number is not more parallelism — it is more
 * requests to the same server, and a throttled scan loses live boards quietly
 * rather than failing loudly.
 */
const CONCURRENCY = 6;

export interface ScanSourceResult {
  id: string;
  name: string;
  count: number;
  error?: string;
}

export interface ScanResult extends JobScanState {
  sources: ScanSourceResult[];
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
 * Ask every enabled source what it has, then take in whatever the profile
 * admits.
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
  // "keep": a board that omits publish dates omits them for every row, so
  // dropping undated postings here would switch that employer off entirely.
  const rules = { profile, undated: "keep" as const };
  const matched = admitPostings(postings, rules);
  const { added } = await absorb(matched, rules, ctx);

  const state: ScanResult = {
    startedAt,
    finishedAt: new Date().toISOString(),
    scanned: postings.length,
    matched: matched.length,
    added,
    sources: results.map((entry) => entry.result),
  };
  writeJobScanState(state);
  return state;
}
