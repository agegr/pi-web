import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getOmpWebUpdateStatus, installOmpWebUpdate } from "@/lib/omp-updates";
import { redactNpxOutput } from "@/lib/npx";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    const status = await getOmpWebUpdateStatus();
    return NextResponse.json(status, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unable to check for updates" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const status = await getOmpWebUpdateStatus();
    if (!status.install.canInstall) {
      return NextResponse.json(
        {
          error: "No installable omp-web update is available",
          status,
        },
        { status: 409 },
      );
    }

    const result = await installOmpWebUpdate({ manager: status.install.manager });
    return NextResponse.json({
      success: true,
      output: result.output,
      restartRequired: status.install.restartRequired,
      installedVersion: status.install.packageVersion,
      command: status.install.command,
    });
  } catch (error: unknown) {
    const detail = error as { stdout?: string; stderr?: string; message?: string };
    const output = redactNpxOutput(`${detail.stdout ?? ""}${detail.stderr ?? ""}`).trim();
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: output || message || "Unable to install the update",
      },
      { status: 500 },
    );
  }
}

