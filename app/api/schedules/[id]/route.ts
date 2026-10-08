import { NextResponse } from "next/server";
import { deleteSchedule, getSchedule, updateSchedule } from "@/lib/schedule-store";
import { isValidCron } from "@/lib/schedule-cron";
import { runScheduledTask } from "@/lib/schedule-runner";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/schedules/[id]
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const task = getSchedule(id);
  if (!task) return NextResponse.json({ error: "No such schedule" }, { status: 404 });
  return NextResponse.json({ task }, { headers: { "Cache-Control": "no-store" } });
}

// PATCH /api/schedules/[id] - enable/disable, retime, or edit the prompt.
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.cron === "string" && !isValidCron(body.cron)) {
      return NextResponse.json({
        error: `无效的 cron 表达式：${body.cron}`,
        code: "invalid_cron",
      }, { status: 400 });
    }
    const task = updateSchedule(id, {
      ...(typeof body.prompt === "string" ? { prompt: body.prompt } : {}),
      ...(typeof body.cwd === "string" ? { cwd: body.cwd } : {}),
      ...(typeof body.cron === "string" ? { cron: body.cron } : {}),
      ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(body.model === null || typeof body.model === "string" ? { model: body.model } : {}),
    });
    return NextResponse.json({ success: true, task });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("No such schedule") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

// DELETE /api/schedules/[id]
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const removed = deleteSchedule(id);
  if (!removed) return NextResponse.json({ error: "No such schedule" }, { status: 404 });
  return NextResponse.json({ success: true });
}

// POST /api/schedules/[id] - run once now, without waiting for the timer.
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const task = getSchedule(id);
  if (!task) return NextResponse.json({ error: "No such schedule" }, { status: 404 });
  const result = await runScheduledTask(task);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ success: true, sessionId: result.sessionId });
}
