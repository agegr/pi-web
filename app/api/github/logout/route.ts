import { NextResponse } from "next/server";
import { setGitHubToken, setGitHubUser } from "@/lib/github-auth";

// POST /api/github/logout — remove stored token
export async function POST() {
  setGitHubToken(null);
  setGitHubUser(null);
  return NextResponse.json({ success: true });
}
