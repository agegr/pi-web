import { NextResponse } from "next/server";
import { readKeybindingsFile } from "@/lib/pi-keybindings";

export const dynamic = "force-dynamic";

// Pi Web's shortcuts are pi's own (`~/.pi/agent/keybindings.json`), read-only:
// the file belongs to the user and to pi, so Pi Web never writes it. A missing
// or malformed file answers with an empty object, which leaves the defaults.
export async function GET() {
  try {
    return NextResponse.json({ bindings: readKeybindingsFile() });
  } catch {
    return NextResponse.json({ bindings: {} });
  }
}
