import { NextResponse } from "next/server";
import { createSchedule, listSchedules } from "@/lib/schedule-store";
import { describeToCron, isValidCron, summarizeCron } from "@/lib/schedule-cron";
import { upcomingRuns } from "@/lib/schedule-runner";

export const dynamic = "force-dynamic";

// GET /api/schedules - all tasks plus the upcoming fire times.
export async function GET() {
  try {
    const tasks = listSchedules();
    return NextResponse.json(
      { tasks, upcoming: upcomingRuns(10) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

// POST /api/schedules
// body: { prompt, cwd, cron?, summary?, runOnceAt?, enabled?, model?, describe? }
// `describe` accepts a natural-language phrase and is resolved to cron here, so
// the browser never guesses at the translation.
export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    let cron = typeof body.cron === "string" ? body.cron : undefined;
    let summary = typeof body.summary === "string" ? body.summary : undefined;

    if (!body.runOnceAt && typeof body.describe === "string") {
      const described = describeToCron(body.describe);
      if (!described) {
        return NextResponse.json({
          error: `无法理解这个时间描述：${body.describe}。请改用 cron 表达式，例如 30 9 * * *（每天 09:30）。`,
          code: "describe_unparsed",
        }, { status: 400 });
      }
      cron = cron ?? described.cron;
      summary = summary ?? described.summary;
    }

    if (!body.runOnceAt && cron !== undefined && !isValidCron(cron)) {
      return NextResponse.json({
        error: `无效的 cron 表达式：${cron}`,
        code: "invalid_cron",
      }, { status: 400 });
    }

    const task = createSchedule({
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      cwd: typeof body.cwd === "string" ? body.cwd : "",
      cron,
      summary: summary ?? (cron ? summarizeCron(cron) : undefined),
      runOnceAt: typeof body.runOnceAt === "string" ? body.runOnceAt : null,
      enabled: body.enabled !== false,
      model: typeof body.model === "string" ? body.model : null,
    });
    return NextResponse.json({ success: true, task });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
