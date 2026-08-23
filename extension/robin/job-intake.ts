/**
 * Everything that happens to a posting between "a board handed it to us" and
 * "it is a row in the store".
 *
 * Two very different things discover jobs — ./job-scan.ts walks the companies
 * the user named, ./job-directory.ts walks whole ATS directories — and for a
 * while they each carried their own copy of what came next: the same title and
 * location filters, the same freshness cutoff spelled two different ways, the
 * same hydrate-prune-merge-write tail. Both copies were correct. Neither would
 * have made a sound when only one of them was updated.
 *
 * So discovery stays split, because it genuinely differs — one has twenty-six
 * sources and finishes in seconds, the other has twenty thousand boards, a
 * cursor and a nightly budget — and admission through persistence lives here,
 * once, behind one interface both sides call.
 *
 * The one behaviour that legitimately differs between them is a parameter
 * rather than a fork: see `undated` on IntakeRules.
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
} from "./jobs.ts";
import { hydrateDescriptions, type FetchContext, type RawPosting } from "./job-providers.ts";
import { newId } from "./paths.ts";
import { readJobs, writeJobs } from "./store.ts";

/** A posting plus the provider that produced it — providers do not label themselves. */
export type ScannedPosting = RawPosting & { source: string };

/**
 * How a posting with no publish date is treated.
 *
 * The only place the two discovery paths are allowed to disagree, and they do,
 * for reasons that are both right:
 *
 *   - "keep", for a named company. A board that omits dates omits them for
 *     every row — Ashby and SmartRecruiters both do — so dropping undated
 *     postings silently switches that employer off entirely.
 *   - "drop", for a directory walk. The question there is "what appeared
 *     recently", and twenty thousand boards' worth of undated backlog buries
 *     the answer on the first run.
 *
 * A parameter rather than two implementations, because collapsing it to either
 * value breaks the other caller and neither failure raises an error: one
 * quietly stops surfacing a company, the other quietly drowns.
 */
export type UndatedPolicy = "keep" | "drop";

export interface IntakeRules {
  profile: JobProfile;
  undated: UndatedPolicy;
}

/**
 * Jobs are kept this long after discovery unless you shortlisted or applied.
 * Without a bound the store grows forever and the dedup set with it; with one,
 * a posting you ignored twice stops costing anything.
 */
const RETENTION_DAYS = 60;

/** YYYY-MM-DD, `days` before today, in UTC to match provider-reported dates. */
export function freshnessCutoff(sinceDays: number, now: number = Date.now()): string | null {
  return sinceDays > 0 ? new Date(now - sinceDays * 86_400_000).toISOString().slice(0, 10) : null;
}

/**
 * Compile the profile into "does this posting get in".
 *
 * A predicate rather than a list-in-list-out function because the directory
 * sweep decides one posting at a time, inside the loop that keeps its
 * per-source match counters — handing it an array to filter would mean
 * counting the survivors a second time somewhere else.
 */
export function compileAdmission(rules: IntakeRules): (posting: RawPosting) => boolean {
  const { profile } = rules;
  const matchesTitle = buildTitleFilter(profile.titles, profile.excludeTitles);
  const matchesLocation = buildLocationFilter({
    always: profile.locationAlways,
    allow: profile.locationAllow,
    block: profile.locationBlock,
  });
  const cutoff = freshnessCutoff(profile.sinceDays);

  return (posting) => {
    // Cheapest and most selective first, so a directory walk spends as little
    // as possible per posting.
    if (cutoff) {
      if (!posting.postedAt) {
        if (rules.undated === "drop") return false;
      } else if (posting.postedAt < cutoff) return false;
    }
    if (matchesTitle(posting.title) === null) return false;
    if (!matchesLocation(posting.location)) return false;
    if (isBlacklisted(posting.company, profile.blacklist)) return false;
    return true;
  };
}

/** The postings a profile admits. */
export function admitPostings(postings: ScannedPosting[], rules: IntakeRules): ScannedPosting[] {
  return postings.filter(compileAdmission(rules));
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
  // Newline separates the fields because the flattening above collapses every
  // run of whitespace, so no field can contain one and forge a different key.
  return [flat(posting.company), flat(posting.title), flat(posting.location)].join("\n");
}

/**
 * Merge fresh postings into the existing store.
 *
 * Implementation, not interface: `absorb` is the only caller and the only way
 * in. Exporting it so a test could reach it directly is what let a mutant that
 * deleted retention from `absorb` pass all 973 tests — the tests proved the
 * function worked and said nothing about whether anything ran it.
 *
 * A posting already known keeps its row untouched — its score, its status and
 * its `notifiedAt` are the whole point of having a store, and re-discovering a
 * job you dropped must not resurrect it.
 */
function mergePostings(
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

/** Drop stale rows you never acted on; keep everything you did. Internal. */
function pruneJobs(jobs: Job[], now: number = Date.now()): Job[] {
  const cutoff = new Date(now - RETENTION_DAYS * 86_400_000).toISOString();
  return jobs.filter((job) =>
    job.status === "shortlist" || job.status === "applied" || (job.discoveredAt ?? "") >= cutoff);
}

/**
 * Fill in descriptions, then fold the batch into the store.
 *
 * Hydration happens here and nowhere earlier, because it is the one expensive
 * step and admission is what makes it cheap: a description costs a request on
 * several boards, and paying that per surviving posting instead of per
 * discovered one is the difference between a few hundred requests and a
 * quarter of a million.
 */
export async function absorb(
  postings: ScannedPosting[],
  rules: IntakeRules,
  ctx: FetchContext,
): Promise<{ added: number }> {
  if (postings.length === 0) return { added: 0 };
  await hydrateDescriptions(postings, ctx, {
    readUnknownBoards: rules.profile.readUnknownBoards,
  });
  const merged = mergePostings(pruneJobs(readJobs()), postings);
  writeJobs(merged.jobs);
  return { added: merged.added };
}
