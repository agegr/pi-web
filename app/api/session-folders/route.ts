import { NextResponse } from "next/server";
import { createFolder, listFolders, SessionFolderError } from "@/lib/session-folders";

export async function GET() {
  try {
    return NextResponse.json(listFolders());
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/session-folders  body: { name: string, parentId?: string | null }
export async function POST(req: Request) {
  try {
    const { name, parentId } = await req.json() as { name?: string; parentId?: string | null };
    if (typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const folder = createFolder(name, parentId ?? null);
    return NextResponse.json({ folder });
  } catch (error) {
    if (error instanceof SessionFolderError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
