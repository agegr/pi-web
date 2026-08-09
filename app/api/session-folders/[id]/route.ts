import { NextResponse } from "next/server";
import { deleteFolder, renameFolder, SessionFolderError } from "@/lib/session-folders";

// PATCH /api/session-folders/[id]  body: { name: string }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { name } = await req.json() as { name?: string };
    if (typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const folder = renameFolder(id, name);
    return NextResponse.json({ folder });
  } catch (error) {
    if (error instanceof SessionFolderError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/session-folders/[id]
// Removing a folder never deletes a session — direct child sessions become
// unfiled and direct child folders are promoted to this folder's parent.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    deleteFolder(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SessionFolderError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
