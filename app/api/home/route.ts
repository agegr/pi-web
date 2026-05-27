import { NextResponse } from "next/server";
import { homedir } from "os";
import { assertTrustedRequest } from "@/app/api/_security/api-auth";

export async function GET(req: Request) {
  const blocked = assertTrustedRequest(req);
  if (blocked) return blocked;

  return NextResponse.json({ home: homedir() });
}
