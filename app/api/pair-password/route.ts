import { NextResponse } from "next/server";
import { getActivePassword, isPasswordFromEnv } from "@/lib/runtime-password";

export const dynamic = "force-dynamic";

/**
 * Returns the current device password so the desktop's "Pair device" modal
 * can display it next to the QR code. The password is held in process
 * memory only; cold restart regenerates it (intentional — invalidates all
 * existing session cookies, which is the "switch device and re-auth" path).
 */
export async function GET() {
  const password = getActivePassword();
  return NextResponse.json({
    password,
    source: isPasswordFromEnv() ? "env" : "runtime",
    regeneratable: !isPasswordFromEnv(),
  });
}