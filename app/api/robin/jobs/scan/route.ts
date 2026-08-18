import { NextResponse } from "next/server";
import { runJobScan } from "@/extension/robin/job-scan";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";
// A scan fans out to every enabled board. Twenty companies at six in flight,
// with Ashby's ten-second latency floor among them, does not fit the default.
export const maxDuration = 120;

/**
 * Run one scan and report what it found.
 *
 * POST rather than GET because it writes: the store gains rows and the scan
 * state is replaced. There is no body — everything the scan needs is in the
 * saved profile, so the browser and the Telegram bridge call it identically.
 *
 * Costs no tokens, so it is safe to leave on a button.
 */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  try {
    return NextResponse.json({ scan: await runJobScan() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
