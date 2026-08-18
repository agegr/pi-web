import { NextResponse } from "next/server";
import { isConnected } from "@/extension/robin/google-calendar";
import { localDate, readMailReview } from "@/extension/robin/store";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * Today's email review, plus the connection state.
 *
 * Read-only: the review is produced by the mail-review turn (see
 * `/api/robin/gmail/check`) and stored on disk; this route just reports it. No
 * Gmail call happens here — the review items carry their own metadata — so the
 * page renders instantly and works even when Gmail is unreachable.
 */
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const today = localDate();
  const review = readMailReview();
  // A review from a previous day is not "today's mail" — show the empty state.
  return NextResponse.json({
    connected: isConnected(),
    today,
    review: review && review.day === today ? review : null,
  });
}
