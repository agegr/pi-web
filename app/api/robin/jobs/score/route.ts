import { NextResponse } from "next/server";
import { scoringPrompt } from "@/extension/robin/job-rubric";
import {
  pendingJobs,
  readJobProfile,
  readJobScoringState,
  readJobs,
  writeJobScoringState,
  type JobScoringState,
} from "@/extension/robin/store";
import { runAssistantTurn } from "@/lib/robin-assistant";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * A cap, not a target. Without it a scorer that keeps failing to write scores
 * would loop against a paid model until someone noticed.
 */
const MAX_ROUNDS = 8;

/** One run at a time per process — two would bill twice for the same queue. */
let running: Promise<unknown> | null = null;

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const profile = readJobProfile();
  return NextResponse.json({
    scoring: readJobScoringState(),
    // Live from the store, so the page can show a backlog even when no run is
    // in flight — the number that decides whether pressing Score does anything.
    pending: pendingJobs(readJobs()).length,
    model: profile.scoreModel ? `${profile.scoreModel.provider}/${profile.scoreModel.modelId}` : null,
  });
}

/**
 * Score the backlog, in the background.
 *
 * Runs rounds sized to the real queue rather than to the push size, and
 * publishes progress to a file the page polls — the same shape as the sweep,
 * for the same reason: the work outlives any sane request timeout and its only
 * other outward sign is rows quietly gaining a number.
 */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (running) {
    return NextResponse.json({ started: false, reason: "already-running", scoring: readJobScoringState() });
  }

  const profile = readJobProfile();
  const startedWith = pendingJobs(readJobs()).length;
  if (startedWith === 0) {
    return NextResponse.json({ started: false, reason: "nothing-pending", scoring: readJobScoringState() });
  }

  const batch = Math.max(1, profile.scoreBatch);
  const state: JobScoringState = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    running: true,
    round: 0,
    totalRounds: Math.min(Math.ceil(startedWith / batch), MAX_ROUNDS),
    startedWith,
    remaining: startedWith,
    model: profile.scoreModel ? `${profile.scoreModel.provider}/${profile.scoreModel.modelId}` : null,
    error: null,
  };
  writeJobScoringState(state);

  const task = (async () => {
    for (let round = 1; round <= state.totalRounds; round += 1) {
      state.round = round;
      writeJobScoringState(state);
      try {
        await runAssistantTurn("scoring", scoringPrompt(batch, profile.rubricLocale));
      } catch (error) {
        // Keep whatever earlier rounds scored; a failed round is not a failed run.
        state.error = error instanceof Error ? error.message : String(error);
        break;
      }
      // Counted from the store, not decremented, so a round the model half
      // finished is reflected honestly.
      state.remaining = pendingJobs(readJobs()).length;
      writeJobScoringState(state);
      if (state.remaining === 0) break;
    }
    state.remaining = pendingJobs(readJobs()).length;
    state.running = false;
    state.finishedAt = new Date().toISOString();
    writeJobScoringState(state);
  })().finally(() => {
    running = null;
  });
  running = task;
  // Nothing awaits this, so an unhandled rejection would take the process down.
  task.catch(() => {});

  return NextResponse.json({ started: true, scoring: state });
}
