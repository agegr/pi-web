import { NextResponse } from "next/server";
import {
  JOB_STATUSES,
  readJobProfile,
  readJobScanState,
  readJobs,
  sortJobs,
  writeJobs,
  type Job,
  type JobStatus,
} from "@/extension/robin/store";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function guard(req: Request, requireJson: boolean): NextResponse | null {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (requireJson && !hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}

function fail(error: unknown, status = 400): NextResponse {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}

/**
 * The list, best-first, plus the two things the page needs to explain it: how
 * the last scan went, and where the push threshold sits. Sending them together
 * keeps the page from firing three requests to render one screen.
 *
 * The CV is deliberately not included — it can be long and only the profile
 * editor needs it, so it lives behind /api/robin/jobs/profile.
 */
export async function GET(req: Request) {
  const blocked = guard(req, false);
  if (blocked) return blocked;
  try {
    const profile = readJobProfile();
    return NextResponse.json({
      jobs: sortJobs(readJobs()),
      scan: readJobScanState(),
      minScore: profile.minScore,
      digestSize: profile.digestSize,
      configured: profile.companies.length > 0 || profile.boards.length > 0,
    });
  } catch (error) {
    return fail(error, 500);
  }
}

/**
 * Change one job's status, or edit your note on it.
 *
 * Status and note are the only fields the browser may write. Scores come from
 * the scorer through the agent tools and `notifiedAt` from the digest — letting
 * the page set either would make "why was I shown this" unanswerable.
 */
export async function PATCH(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { id?: unknown; status?: unknown; note?: unknown };
    if (typeof body.id !== "string" || !body.id) return fail(new Error("id is required"));
    if (body.status !== undefined
      && (typeof body.status !== "string" || !JOB_STATUSES.includes(body.status as JobStatus))) {
      return fail(new Error(`status must be one of: ${JOB_STATUSES.join(", ")}`));
    }
    if (body.note !== undefined && typeof body.note !== "string") {
      return fail(new Error("note must be text"));
    }

    const jobs = readJobs();
    const job = jobs.find((entry: Job) => entry.id === body.id);
    if (!job) return fail(new Error(`No job with id "${body.id}"`), 404);

    if (typeof body.status === "string") {
      // Stamped on the transition into `applied`, and only the first time:
      // re-opening and re-applying should not rewrite the date you sent it.
      if (body.status === "applied" && job.status !== "applied" && !job.appliedAt) {
        job.appliedAt = new Date().toISOString();
      }
      job.status = body.status as JobStatus;
    }
    if (typeof body.note === "string") {
      const note = body.note.trim().slice(0, 2000);
      if (note) job.note = note;
      else delete job.note;
    }

    writeJobs(jobs);
    return NextResponse.json({ job });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function DELETE(req: Request) {
  const blocked = guard(req, true);
  if (blocked) return blocked;
  try {
    const body = await req.json() as { id?: unknown };
    if (typeof body.id !== "string" || !body.id) return fail(new Error("id is required"));
    const jobs = readJobs();
    const remaining = jobs.filter((entry: Job) => entry.id !== body.id);
    if (remaining.length === jobs.length) return fail(new Error(`No job with id "${body.id}"`), 404);
    writeJobs(remaining);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error, 500);
  }
}
