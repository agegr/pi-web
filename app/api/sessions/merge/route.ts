import { NextResponse } from "next/server";
import { mergeSessions, previewSessionMerge, SessionMergeError } from "@/lib/session-merge";
import { getRpcSession } from "@/lib/rpc-manager";
import { readSessionInfo } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

/**
 * POST /api/sessions/merge
 *
 * Body: { ids: string[], preview?: boolean, force?: boolean, sameCwdOnly?: boolean }
 *
 * - preview: true  — only evaluate similarity, return the pair scores.
 * - preview omitted — merge `ids[0]` as the main line with the rest appended,
 *   deleting the source sessions. When the pair similarity is below the
 *   suggestion threshold, requires `force: true` as the user's confirmation.
 * - sameCwdOnly — default true: refuse sessions from different directories
 *   unless the caller explicitly turns it off (cross-project merge).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as {
      ids?: unknown;
      preview?: boolean;
      force?: boolean;
      sameCwdOnly?: boolean;
    };
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id): id is string => typeof id === "string")
      : [];
    const preview = body.preview === true;
    const force = body.force === true;
    const sameCwdOnly = body.sameCwdOnly !== false;
    if (ids.length < 2) {
      return NextResponse.json(
        { error: "merge.tooFew", message: "Select at least two sessions to merge." },
        { status: 400 },
      );
    }
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json(
        { error: "merge.duplicateIds", message: "A session cannot be merged with itself." },
        { status: 400 },
      );
    }

    if (preview) {
      const result = await previewSessionMerge(ids);
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    // A live wrapper may be writing to a source file: stop it before the file
    // is rewritten out from under it. Same as DELETE does for its target.
    await Promise.allSettled(ids.map((id) => getRpcSession(id)?.shutdown()));
    const result = await mergeSessions(ids, force, sameCwdOnly);
    const session = await readSessionInfo(result.path);
    return NextResponse.json({ ...result, session }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SessionMergeError) {
      const status =
        error.code === "not_similar" || error.code === "subagent" ? 409
        : error.code === "cross_cwd" ? 400
        : 404;
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
