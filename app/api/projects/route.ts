import { NextResponse } from "next/server";
import { readProjectPreferences, writeProjectPreferences } from "@/lib/project-registry";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { projects: readProjectPreferences() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { projects?: unknown };
    const projects = writeProjectPreferences(body.projects);
    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 });
  }
}
