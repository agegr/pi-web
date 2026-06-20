import { NextResponse } from "next/server";
import { unarchiveSession } from "@/lib/session/session-utils";

export async function POST(req: Request) {
  try {
    const { ids } = await req.json() as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids array is required" }, { status: 400 });
    }

    const results = await Promise.allSettled(ids.map((id) => unarchiveSession(id)));
    const failed = results
      .map((r, i) => ({ id: ids[i], result: r }))
      .filter((item) => item.result.status === "rejected")
      .map((item) => ({
        id: item.id,
        error: (item.result as PromiseRejectedResult).reason instanceof Error
          ? (item.result as PromiseRejectedResult).reason.message
          : String((item.result as PromiseRejectedResult).reason),
      }));

    return NextResponse.json({ ok: true, unarchived: ids.length - failed.length, failed });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
