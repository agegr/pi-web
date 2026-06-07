import { NextResponse } from "next/server";
import { getGitHubToken, getGitHubUser, isGitHubConfigured } from "@/lib/github-auth";

// GET /api/github/status — check if user is logged in to GitHub
export async function GET() {
  const configured = isGitHubConfigured();
  const token = getGitHubToken();
  const user = getGitHubUser();

  return NextResponse.json({
    configured,
    loggedIn: !!(token && user),
    user: token && user ? user : null,
  });
}
