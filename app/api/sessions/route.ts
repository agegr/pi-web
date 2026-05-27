import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { assertTrustedRequest } from "@/app/api/_security/api-auth";

export async function GET(req: Request) {
  const blocked = assertTrustedRequest(req);
  if (blocked) return blocked;

  try {
    const sessions = await listAllSessions();
    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
