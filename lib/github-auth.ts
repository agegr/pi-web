/**
 * GitHub OAuth helper — manages token storage and config.
 *
 * OAuth credentials come from environment variables:
 *   GITHUB_CLIENT_ID
 *   GITHUB_CLIENT_SECRET
 *
 * The access token is stored in ~/.pi/agent/settings.json under "githubToken".
 */

import { getAgentDir } from "./session-reader";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface GitHubConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getGitHubConfig(): GitHubConfig {
  return {
    clientId: process.env.GITHUB_CLIENT_ID || "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    redirectUri: process.env.GITHUB_REDIRECT_URI || "",
  };
}

export function isGitHubConfigured(): boolean {
  const cfg = getGitHubConfig();
  return !!(cfg.clientId && cfg.clientSecret);
}

function getSettingsPath(): string {
  return join(getAgentDir(), "settings.json");
}

function readSettings(): Record<string, unknown> {
  const path = getSettingsPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeSettings(settings: Record<string, unknown>): void {
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), "utf-8");
}

export function getGitHubToken(): string | null {
  const settings = readSettings();
  const token = settings.githubToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

export function setGitHubToken(token: string | null): void {
  const settings = readSettings();
  if (token) {
    settings.githubToken = token;
  } else {
    delete settings.githubToken;
  }
  writeSettings(settings);
}

export function getGitHubUser(): { login: string; avatar: string } | null {
  const settings = readSettings();
  const user = settings.githubUser;
  if (user && typeof user === "object") {
    const u = user as Record<string, unknown>;
    if (typeof u.login === "string") {
      return { login: u.login, avatar: typeof u.avatar === "string" ? u.avatar : "" };
    }
  }
  return null;
}

export function setGitHubUser(user: { login: string; avatar: string } | null): void {
  const settings = readSettings();
  if (user) {
    settings.githubUser = user;
  } else {
    delete settings.githubUser;
  }
  writeSettings(settings);
}

export function getAuthorizeUrl(config: GitHubConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "repo,read:user",
    response_type: "code",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}
