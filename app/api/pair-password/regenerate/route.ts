import { NextResponse } from "next/server";
import { isPasswordFromEnv, regeneratePassword } from "@/lib/runtime-password";

export const dynamic = "force-dynamic";

/**
 * Generate a fresh password and return it. Takes effect immediately for
 * new auth checks. Session cookies signed under the previous password's
 * HMAC key become invalid on the next request — users must re-enter the
 * new password once.
 */
export async function POST() {
  if (isPasswordFromEnv()) {
    return NextResponse.json(
      {
        error: "PI_WEB_PASSWORD is set in the environment; regenerate is disabled.",
        password: null,
      },
      { status: 409 },
    );
  }
  const next = regeneratePassword();
  return NextResponse.json({ password: next });
}