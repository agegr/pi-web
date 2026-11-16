import { NextResponse } from "next/server";
import type { InstalledFontsResponse } from "@/lib/api-types";
import { listInstalledFonts } from "@/lib/installed-fonts";

export const dynamic = "force-dynamic";

// GET /api/fonts — the families installed on the machine running pi-web, so
// the typography fields can offer a picker instead of a name the user has to
// look up. An unreadable font directory yields a shorter list, never an error.
export async function GET() {
  try {
    const fonts = await listInstalledFonts();
    return NextResponse.json({ fonts } satisfies InstalledFontsResponse);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
