import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  cancelScheduledJob,
  listActiveScheduledJobs,
  stopAllScheduledPrompts,
} from "@/lib/scheduled-prompts";
import { isScheduledPromptsEnabled, writeScheduledPromptsEnabled } from "@/lib/scheduled-prompts-settings";

export const dynamic = "force-dynamic";

function snapshot() {
  const enabled = isScheduledPromptsEnabled();
  return { enabled, jobs: enabled ? listActiveScheduledJobs() : [] };
}

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json(snapshot());
  } catch (error) {
    return failure(error);
  }
}

async function readBody(req: Request): Promise<Record<string, unknown> | NextResponse> {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  const body: unknown = await req.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }
  return body as Record<string, unknown>;
}

export async function PUT(req: Request) {
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  try {
    writeScheduledPromptsEnabled(body.enabled);
    // Switching off ends every live timer now. Switching on needs a session reload to register the tool.
    if (!body.enabled) stopAllScheduledPrompts();
    return NextResponse.json(snapshot());
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(req: Request) {
  const body = await readBody(req);
  if (body instanceof NextResponse) return body;
  if (typeof body.cwd !== "string" || !body.cwd || typeof body.jobId !== "string" || !body.jobId) {
    return NextResponse.json({ error: "cwd and jobId are required" }, { status: 400 });
  }
  // Only a job a live session is firing can be cancelled here, never an arbitrary path.
  if (!listActiveScheduledJobs().some((job) => job.cwd === body.cwd && job.id === body.jobId)) {
    return NextResponse.json({ error: "Scheduled prompt not found" }, { status: 404 });
  }
  try {
    cancelScheduledJob(body.cwd, body.jobId);
    return NextResponse.json(snapshot());
  } catch (error) {
    return failure(error);
  }
}
