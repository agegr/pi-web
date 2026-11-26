import { NextResponse } from "next/server";
import type { PluginScope } from "@/lib/api-types";
import { cwdAccessRefusal } from "@/lib/file-access";
import { checkPluginUpdates } from "@/lib/plugin-updates";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      cwd?: unknown;
      source?: unknown;
      scope?: unknown;
    };
    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    const refused = await cwdAccessRefusal(cwd);
    if (refused) return refused;

    const source = typeof body.source === "string" ? body.source : undefined;
    const scope = body.scope === "global" || body.scope === "project"
      ? body.scope as PluginScope
      : undefined;
    if ((source && !scope) || (!source && scope)) {
      return NextResponse.json({ error: "source and scope must be provided together" }, { status: 400 });
    }

    const updates = await checkPluginUpdates(cwd, source && scope ? { source, scope } : undefined);
    if (source && scope && updates.length === 0) {
      return NextResponse.json({ error: "Configured package not found" }, { status: 404 });
    }

    return NextResponse.json({ updates });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500 },
    );
  }
}
