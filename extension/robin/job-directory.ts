/**
 * Reverse discovery: walk a whole ATS directory instead of a company list.
 *
 * The forward scan (./job-scan.ts) answers "what is open at the companies I
 * named". This answers the opposite question — "who anywhere is hiring for
 * what I do" — and it is the only one of the two that can surface an employer
 * you had never heard of.
 *
 * Only the discovery half lives here: walking the directories, resuming from a
 * cursor, budgeting a night's work and reporting progress. What happens to a
 * posting once a board hands it over — admission, descriptions, dedupe,
 * retention, persistence — is ./job-intake.ts, shared with the forward scan so
 * the two cannot drift.
 *
 * Ported from career-ops's `scan-ats-full.mjs` (MIT, github.com/santifer/
 * career-ops), including the part that makes it possible at all: neither
 * Greenhouse nor Lever nor Ashby publishes a list of its customers, so the
 * board slugs come from a public crowd-sourced dataset and each board is then
 * read through its own public API. About a third of the slugs are dead at any
 * time; that is expected and counted separately from real errors.
 *
 * Two guards travel with the dataset because it is third-party input that ends
 * up interpolated into a URL: every slug must match a conservative charset,
 * and every constructed URL is re-parsed and rejected unless it lands on that
 * ATS's own hostname. A tampered dataset can therefore name boards that do not
 * exist — it cannot point this scanner at another host.
 *
 * Server-only: reaches node:fs through ./job-intake.ts, ./store.ts and
 * ./paths.ts.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir } from "./paths.ts";
import { type JobProfile, type TrackedCompany } from "./jobs.ts";
import {
  absorb,
  compileAdmission,
  freshnessCutoff,
  type ScannedPosting,
} from "./job-intake.ts";
import { makeFetchContext, providerById, type FetchContext } from "./job-providers.ts";
import { readJobSweepState, writeJobSweepState, type JobSweepState } from "./store.ts";

const DATASET_BASE = "https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data";

/**
 * Tracks `main` deliberately: the dataset's whole value is freshness — new
 * boards appear weekly — so pinning a commit would defeat the purpose. Safety
 * rests on the slug charset and the host re-check below, not on the dataset
 * being trustworthy.
 */
const CACHE_TTL_HOURS = 24;

/** Dataset entries reach a URL — reject anything outside a conservative charset. */
const SLUG_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Six in flight, not twenty. Each of these directories is served entirely from
 * one hostname, so a higher number is not more parallelism — it is more load on
 * one server, and a throttled sweep loses live boards silently rather than
 * failing loudly.
 */
const CONCURRENCY = 6;

/** Flush matches to disk this often, so a killed sweep keeps what it found. */
const FLUSH_EVERY = 250;

export interface Directory {
  id: string;
  label: string;
  providerId: string;
  dataset: string;
  /** Turn a dataset entry into a company, or null if it is not usable. */
  toCompany: (entry: string) => TrackedCompany | null;
  /**
   * In-flight requests for this directory. Defaults to the shared, cautious
   * number, which exists because Greenhouse, Lever and Ashby each serve their
   * whole customer base from one hostname.
   */
  concurrency?: number;
  /**
   * Boards to read per unattended run, when the caller names no limit.
   *
   * A budget, not a cap on coverage: the run resumes from a cursor, so
   * successive nights walk successive slices and the whole directory is still
   * read — just over several nights instead of one. That is only sound
   * because the freshness window is wider than the rotation: a posting stays
   * eligible for days, so a board visited every third night cannot hide one.
   *
   * Absent means "the whole directory every night", which is right for the
   * three that finish in minutes.
   */
  nightlyLimit?: number;
}

/**
 * Make a board slug presentable.
 *
 * A directory sweep never learns the employer's real name — the board APIs
 * return postings, not company records, and asking each of fifteen thousand
 * boards for its name would double the sweep. So "acme-corp" becomes "Acme
 * Corp" and "8thlightrebuild" stays as it is: this tidies the common case and
 * is honest about not being able to fix the rest.
 */
export function prettifySlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .split(" ")
    .map((word) => (word.length > 1 && /^[a-z]/.test(word) ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** Re-parse a constructed URL and refuse anything off the expected host. */
function onHost(name: string, url: string, isCanonical: (hostname: string) => boolean): TrackedCompany | null {
  let hostname: string;
  try {
    ({ hostname } = new URL(url));
  } catch {
    return null;
  }
  if (!isCanonical(hostname)) return null;
  return { id: `dir-${name}`, name: prettifySlug(name), url, enabled: true };
}

export const DIRECTORIES: readonly Directory[] = [
  {
    id: "greenhouse",
    label: "Greenhouse",
    providerId: "greenhouse",
    dataset: `${DATASET_BASE}/greenhouse_companies.json`,
    toCompany: (slug) => (SLUG_RE.test(slug)
      ? onHost(slug, `https://job-boards.greenhouse.io/${slug}`, (host) => host === "job-boards.greenhouse.io")
      : null),
  },
  {
    id: "lever",
    label: "Lever",
    providerId: "lever",
    dataset: `${DATASET_BASE}/lever_companies.json`,
    toCompany: (slug) => (SLUG_RE.test(slug)
      ? onHost(slug, `https://jobs.lever.co/${slug}`, (host) => host === "jobs.lever.co")
      : null),
  },
  {
    id: "ashby",
    label: "Ashby",
    providerId: "ashby",
    dataset: `${DATASET_BASE}/ashby_companies.json`,
    toCompany: (slug) => (SLUG_RE.test(slug)
      ? onHost(slug, `https://jobs.ashbyhq.com/${slug}`, (host) => host === "jobs.ashbyhq.com")
      : null),
  },
  {
    // The largest of the four by a distance: on a sample of three thousand
    // active early-career postings, Workday carried more than Greenhouse,
    // Ashby and Lever combined. Its entries are "tenant|instance|site"
    // triples rather than bare slugs, and each tenant is its own hostname —
    // which is also why it is the one directory that may run wider than the
    // shared limit. About half the triples are stale and answer 422; that is
    // the dataset's age showing, and it is counted as unreachable like any
    // other dead board.
    id: "workday",
    label: "Workday",
    providerId: "workday",
    dataset: `${DATASET_BASE}/workday_companies.json`,
    concurrency: 12,
    // Twelve thousand tenants at roughly two hundred milliseconds each is
    // three quarters of an hour, against ten minutes for the other three
    // directories combined — and Workday's yield per board is lower, because
    // most of its tenants are not software employers. A third a night keeps
    // the nightly run near a quarter of an hour and still sees every board
    // inside a seven-day freshness window.
    nightlyLimit: 4500,
    toCompany: (entry) => {
      const parts = entry.split("|");
      // Exactly three, not at least three. A malformed entry is a reason to
      // skip a board, never to quietly use the first three fields of it.
      if (parts.length !== 3) return null;
      const [tenant, instance, site] = parts;
      if (!tenant || !instance || !site) return null;
      // Tighter than SLUG_RE, which permits dots: a tenant or instance
      // carrying one produces "acme.evil.com.wd5.myworkdayjobs.com", still
      // locked to Workday but not a board that exists. The provider's own host
      // check rejects it on arrival — this just declines to spend the request.
      if (![tenant, instance].every((part) => /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(part))) return null;
      if (!SLUG_RE.test(site)) return null;
      const host = `${tenant}.${instance}.myworkdayjobs.com`;
      return onHost(tenant, `https://${host}/${site}`, (hostname) => hostname === host);
    },
  },
];

export function directoryById(id: string): Directory | undefined {
  return DIRECTORIES.find((directory) => directory.id === id);
}

function cachePath(id: string): string {
  return join(dataDir(), "cache", `${id}-companies.json`);
}

/**
 * The board list, cached for a day.
 *
 * `stale` is a real outcome, not an error: a sweep against yesterday's list is
 * worth far more than no sweep, and the caller needs to be able to say which
 * one happened rather than reporting a degraded run as a clean one.
 */
export async function loadDirectory(
  directory: Directory,
  fetchImpl: typeof fetch = fetch,
): Promise<{ slugs: string[]; status: "ok" | "stale" | "empty" }> {
  const file = cachePath(directory.id);
  if (existsSync(file)) {
    const ageHours = (Date.now() - statSync(file).mtimeMs) / 3_600_000;
    if (ageHours < CACHE_TTL_HOURS) {
      try {
        return { slugs: JSON.parse(readFileSync(file, "utf8")) as string[], status: "ok" };
      } catch {
        // Corrupt cache — fall through and refetch.
      }
    }
  }

  try {
    const response = await fetchImpl(directory.dataset, {
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as unknown;
    if (Array.isArray(data)) {
      const slugs = data.filter((entry): entry is string => typeof entry === "string");
      mkdirSync(dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(slugs), "utf8");
      renameSync(temporary, file);
      return { slugs, status: "ok" };
    }
  } catch {
    // Fall through to the stale cache.
  }

  if (existsSync(file)) {
    try {
      return { slugs: JSON.parse(readFileSync(file, "utf8")) as string[], status: "stale" };
    } catch {
      // Nothing usable.
    }
  }
  return { slugs: [], status: "empty" };
}

export interface SweepOptions {
  profile: JobProfile;
  /** Directory ids to walk. Defaults to all of them. */
  directories?: string[];
  /** Max boards per directory. Infinity for the whole thing. */
  limit?: number;
  /** Continue from the cursor left by a previous run. */
  resume?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (state: JobSweepState) => void;
}

/**
 * Walk the directories, keep what matches, write as you go.
 *
 * Incremental flushing is what makes a twenty-minute sweep safe to interrupt:
 * a restart loses the boards since the last flush, not the run.
 */
export async function runDirectorySweep(options: SweepOptions): Promise<JobSweepState> {
  const {
    profile,
    directories = DIRECTORIES.map((directory) => directory.id),
    limit = Infinity,
    resume = false,
    fetchImpl = fetch,
    signal,
    onProgress,
  } = options;

  const ctx: FetchContext = makeFetchContext(fetchImpl);
  // "drop": here the question is "what appeared recently", and twenty thousand
  // boards' worth of undated backlog would bury the answer. The forward scan
  // passes "keep" for the opposite and equally good reason.
  const rules = { profile, undated: "drop" as const };
  const admits = compileAdmission(rules);
  const cutoff = freshnessCutoff(profile.sinceDays);

  const state: JobSweepState = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    running: true,
    boardsTotal: 0,
    boardsDone: 0,
    unreachable: 0,
    scanned: 0,
    matched: 0,
    added: 0,
    directories: [],
    cursors: {},
    error: null,
  };

  // Resuming means "carry on where the last run stopped". A sweep the server
  // restart killed at board 9,000 should not re-read those nine thousand.
  const previous = resume ? readJobSweepState()?.cursors ?? {} : {};

  const plans: { directory: Directory; slugs: string[] }[] = [];
  for (const id of directories) {
    const directory = directoryById(id);
    if (!directory) continue;
    const { slugs, status } = await loadDirectory(directory, fetchImpl);
    // A cursor past the end means that directory finished; start it over
    // rather than silently scanning nothing.
    const cursor = previous[directory.id] ?? 0;
    const start = cursor >= slugs.length ? 0 : cursor;
    // An explicit limit is the caller's business; otherwise the directory's
    // own nightly budget applies, and the cursor carries the rest to tomorrow.
    const budget = limit === Infinity ? directory.nightlyLimit ?? slugs.length : limit;
    const window = slugs.slice(start, start + budget);
    plans.push({ directory, slugs: window });
    state.cursors[directory.id] = start;
    state.directories.push({ id: directory.id, label: directory.label, status, boards: window.length, matched: 0 });
    state.boardsTotal += window.length;
  }

  const publish = () => {
    writeJobSweepState(state);
    onProgress?.(state);
  };
  publish();

  let pending: ScannedPosting[] = [];
  // `boardsDone % FLUSH_EVERY` fires once per concurrent worker at the same
  // milestone, so the same state was written six times. Track the last flush
  // instead: six identical writes are six times the disk churn for one update.
  let flushedAt = 0;
  /**
   * Flushes run one at a time.
   *
   * A flush now awaits a network round trip (the description pass), so two of
   * them can interleave where the old synchronous version could not — and two
   * interleaved flushes both read the store, both write it, and the second
   * silently drops the first one's rows. Chaining them costs nothing here: a
   * flush covers 250 boards and those yield a handful of matches, not a batch
   * worth parallelising.
   */
  let flushing: Promise<void> = Promise.resolve();
  const flush = (): Promise<void> => {
    if (pending.length === 0) return flushing;
    // Claim the batch before yielding — five other workers are still pushing.
    const batch = pending;
    pending = [];
    flushing = flushing.then(async () => {
      state.added += (await absorb(batch, rules, ctx)).added;
    }).catch((error) => {
      // A failed flush loses its batch, not the sweep. The next one still runs.
      state.error = error instanceof Error ? error.message : String(error);
    });
    return flushing;
  };

  try {
    for (const plan of plans) {
      const provider = providerById(plan.directory.providerId);
      const record = state.directories.find((entry) => entry.id === plan.directory.id);
      if (!provider || !record) continue;

      let next = 0;
      const inFlight = Math.min(plan.directory.concurrency ?? CONCURRENCY, plan.slugs.length);
      await Promise.all(Array.from({ length: inFlight }, async () => {
        for (;;) {
          if (signal?.aborted) return;
          const index = next;
          next += 1;
          const slug = plan.slugs[index];
          if (slug === undefined) return;

          const base = plan.directory.toCompany(slug);
          // Providers that page in date order can stop early with this; the
          // rest ignore it and are filtered downstream exactly as before.
          const company = base && cutoff ? { ...base, since: cutoff } : base;
          state.boardsDone += 1;
          if (!company) {
            state.unreachable += 1;
          } else {
            try {
              const postings = await provider.fetch(company, ctx);
              state.scanned += postings.length;
              for (const posting of postings) {
                if (!admits(posting)) continue;
                pending.push({ ...posting, source: provider.id });
                state.matched += 1;
                record.matched += 1;
              }
            } catch {
              // A dead slug is the common case here, not an anomaly: roughly a
              // third of the dataset points at boards that no longer exist.
              // Counting them separately keeps a real outage visible.
              state.unreachable += 1;
            }
          }

          if (state.boardsDone - flushedAt >= FLUSH_EVERY) {
            const advanced = state.boardsDone - flushedAt;
            flushedAt = state.boardsDone;
            await flush();
            state.cursors[plan.directory.id] = (state.cursors[plan.directory.id] ?? 0) + advanced;
            publish();
          }
        }
      }));
      state.cursors[plan.directory.id] = (state.cursors[plan.directory.id] ?? 0) + plan.slugs.length;
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  }

  await flush();
  state.running = false;
  state.finishedAt = new Date().toISOString();
  publish();
  return state;
}
