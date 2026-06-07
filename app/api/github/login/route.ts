import { NextResponse } from "next/server";
import { getGitHubConfig, isGitHubConfigured } from "@/lib/github-auth";
import crypto from "node:crypto";

// GET /api/github/login — redirect to GitHub OAuth page
export async function GET(req: Request) {
  if (!isGitHubConfigured()) {
    return NextResponse.json(
      { error: "GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET." },
      { status: 400 }
    );
  }

  const config = getGitHubConfig();
  const { origin } = new URL(req.url);
  const redirectUri = config.redirectUri || `${origin}/api/github/callback`;

  // Generate random state for CSRF protection
  const state = crypto.randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: "repo,read:user",
    response_type: "code",
    state,
  });

  const url = `https://github.com/login/oauth/authorize?${params.toString()}`;

  const response = NextResponse.redirect(url);

  // Store state in cookie for validation on callback
  response.cookies.set("github_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10, // 10 minutes
  });

  return response;
}
