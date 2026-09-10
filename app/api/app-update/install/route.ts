import { NextResponse } from "next/server";
import {
  defaultUpdateSourceDir,
  launchAppUpdate,
  readAppInstallState,
} from "@/lib/app-update-install";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    supported: process.platform === "darwin",
    defaultSourceDir: defaultUpdateSourceDir(),
    ...readAppInstallState(),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sourceDir?: unknown };
    if (typeof body.sourceDir !== "string") throw new Error("Choose a Pi Web source directory.");
    return NextResponse.json({
      accepted: true,
      ...launchAppUpdate(body.sourceDir),
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
