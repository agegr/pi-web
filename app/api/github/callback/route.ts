import { NextRequest, NextResponse } from "next/server";
import { getGitHubConfig, isGitHubConfigured, setGitHubToken, setGitHubUser } from "@/lib/github-auth";

// GET /api/github/callback — handle OAuth callback from GitHub
export async function GET(req: NextRequest) {
  if (!isGitHubConfigured()) {
    return new Response("GitHub OAuth not configured", { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const returnedState = searchParams.get("state");

  if (error) {
    return new Response(`GitHub OAuth error: ${error}`, { status: 400 });
  }

  if (!code) {
    return new Response("Missing authorization code", { status: 400 });
  }

  // Validate state to prevent CSRF — use Next.js cookie API
  const expectedState = req.cookies.get("github_oauth_state")?.value;

  if (!returnedState || !expectedState || returnedState !== expectedState) {
    return new Response("Invalid OAuth state (possible CSRF)", { status: 400 });
  }

  const config = getGitHubConfig();
  const { origin } = new URL(req.url);
  const redirectUri = config.redirectUri || `${origin}/api/github/callback`;

  // Exchange code for access token
  const tokenResponse = await fetch(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    }
  );

  const tokenData = (await tokenResponse.json()) as {
    access_token?: string;
    error_description?: string;
  };

  if (!tokenData.access_token) {
    return new Response(
      `Failed to get access token: ${tokenData.error_description || "unknown error"}`,
      { status: 400 }
    );
  }

  const token = tokenData.access_token;

  // Fetch user info
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (userResponse.ok) {
    const userData = (await userResponse.json()) as { login: string; avatar_url: string };
    setGitHubUser({ login: userData.login, avatar: userData.avatar_url });
  }

  // Store token
  setGitHubToken(token);

  // Redirect back to the app
  const response = NextResponse.redirect(origin);

  // Clear the state cookie
  response.cookies.set("github_oauth_state", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
