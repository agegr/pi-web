import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { setSubagentOverrideDisabled } from "@/lib/subagent-overrides";

export const dynamic = "force-dynamic";

/** Same name shape the profiles route accepts; an override only ever targets an agent name. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

async function validateCwd(cwd: unknown): Promise<string> {
  if (typeof cwd !== "string" || !cwd || !existsSync(cwd)) throw new Error("Valid cwd required");
  if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) throw new Error("Access denied");
  return cwd;
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = await req.json() as { cwd?: unknown; name?: unknown; disabled?: unknown };
    const cwd = await validateCwd(body.cwd);
    if (typeof body.name !== "string" || !NAME_PATTERN.test(body.name.trim())) {
      return NextResponse.json({ error: "Valid agent name required" }, { status: 400 });
    }
    if (typeof body.disabled !== "boolean") {
      return NextResponse.json({ error: "disabled must be a boolean" }, { status: 400 });
    }
    setSubagentOverrideDisabled(cwd, body.name.trim(), body.disabled);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 400 });
  }
}
