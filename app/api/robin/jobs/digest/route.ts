import { NextResponse } from "next/server";
import {
  digestCandidates,
  formatJobDigest,
  pendingJobs,
  readJobProfile,
  readJobScanState,
  readJobs,
  writeJobs,
  type Job,
} from "@/extension/robin/store";
import { findDeadPostings, makeFetchContext } from "@/extension/robin/job-providers";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * Build the next push.
 *
 * The text is assembled here, from stored fields, by `formatJobDigest` — the
 * model never writes it. A digest whose entire value is a link the user will
 * click cannot afford a hallucinated URL, and a scorer that is only ever asked
 * for a number and one sentence has no way to produce one.
 *
 * Claiming is the other half: every job in the returned batch gets
 * `notifiedAt` stamped, so the evening push shows different jobs than the
 * morning one and a bridge restart cannot re-send the same ten.
 *
 * Two request shapes exist so a delivery can be claimed only once it landed:
 *
 *   { preview: true }        → read the next batch, write nothing
 *   { claim: [id, …] }       → stamp exactly those jobs as delivered
 *   { }                      → read and stamp in one step
 *
 * The bridge uses the first two. A send that fails then costs nothing: the
 * batch was never claimed, so the next slot offers the same jobs again rather
 * than silently skipping ten of them.
 */
/**
 * How many rounds of "drop the dead ones and pull in replacements".
 *
 * Two. If a third of a batch is dead the boards are having a bad day, and
 * grinding through the whole backlog looking for ten live links is a worse
 * outcome than sending eight.
 */
const REFILL_ROUNDS = 2;

/**
 * The next `limit` candidates, minus the ones whose postings have closed.
 *
 * Checked here rather than during the scan because this is the only moment it
 * matters: a stale row in the store costs nothing until it becomes a
 * notification someone taps and lands on a 404, and four of the first
 * sixty-five pushes this feature sent were already dead when they went out.
 *
 * A posting confirmed gone is marked `dropped`, so the next push does not
 * spend a slot rediscovering it. Only confirmed verdicts count — a board that
 * timed out leaves its posting exactly where it was.
 */
async function liveBatch(jobs: Job[], candidates: Job[], limit: number): Promise<Job[]> {
  const ctx = makeFetchContext();
  const live: Job[] = [];
  const closed = new Set<string>();
  let cursor = 0;

  for (let round = 0; round < REFILL_ROUNDS && live.length < limit && cursor < candidates.length; round += 1) {
    const attempt = candidates.slice(cursor, cursor + (limit - live.length));
    cursor += attempt.length;
    const dead = await findDeadPostings(attempt.map((job) => job.url), ctx).catch(() => new Set<string>());
    for (const job of attempt) {
      if (dead.has(job.url)) closed.add(job.id);
      else live.push(job);
    }
  }

  if (closed.size > 0) {
    for (const job of jobs) if (closed.has(job.id)) job.status = "dropped";
    writeJobs(jobs);
  }
  return live;
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = await req.json().catch(() => ({})) as {
      limit?: unknown;
      locale?: unknown;
      preview?: unknown;
      claim?: unknown;
    };

    if (Array.isArray(body.claim)) {
      const claimed = new Set(body.claim.filter((id): id is string => typeof id === "string"));
      const jobs = readJobs();
      const now = new Date().toISOString();
      let count = 0;
      for (const job of jobs) {
        if (claimed.has(job.id) && !job.notifiedAt) {
          job.notifiedAt = now;
          count += 1;
        }
      }
      if (count > 0) writeJobs(jobs);
      return NextResponse.json({ claimed: count });
    }

    const profile = readJobProfile();
    const limit = Number.isInteger(body.limit) && (body.limit as number) > 0
      ? Math.min(body.limit as number, 50)
      : profile.digestSize;
    const locale = body.locale === "zh" ? "zh" as const : "en" as const;

    const jobs = readJobs();
    const batch = await liveBatch(jobs, digestCandidates(jobs, profile), limit);

    if (body.preview !== true && batch.length > 0) {
      const now = new Date().toISOString();
      const claimed = new Set(batch.map((job: Job) => job.id));
      for (const job of jobs) {
        if (claimed.has(job.id)) job.notifiedAt = now;
      }
      writeJobs(jobs);
    }

    return NextResponse.json({
      text: formatJobDigest(batch, { locale, scanned: readJobScanState()?.scanned ?? 0 }),
      jobIds: batch.map((job: Job) => job.id),
      count: batch.length,
      // How much is still unscored, and how big a bite the scorer takes. The
      // bridge sizes its scoring loop from these rather than guessing.
      pending: pendingJobs(jobs).length,
      scoreBatch: profile.scoreBatch,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
