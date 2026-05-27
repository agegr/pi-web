import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { NextResponse } from "next/server";

const TRUST_FILE = path.join(homedir(), ".pi", "trusted-workspaces.json");

interface TrustedWorkspaceStore {
  version: 1;
  workspaces: string[];
}

function canonicalizeWorkspace(cwd: string): string {
  const trimmed = cwd.trim();
  if (!trimmed) return "";
  const expanded = trimmed === "~" || trimmed.startsWith("~/")
    ? path.join(homedir(), trimmed.slice(2))
    : trimmed;
  const resolved = path.resolve(expanded);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function readTrustedWorkspaces(): Set<string> {
  if (!existsSync(TRUST_FILE)) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(TRUST_FILE, "utf8")) as Partial<TrustedWorkspaceStore>;
    if (!Array.isArray(parsed.workspaces)) return new Set();
    return new Set(parsed.workspaces.filter((item): item is string => typeof item === "string").map(canonicalizeWorkspace));
  } catch {
    return new Set();
  }
}

function writeTrustedWorkspaces(workspaces: Set<string>): void {
  mkdirSync(path.dirname(TRUST_FILE), { recursive: true });
  const store: TrustedWorkspaceStore = {
    version: 1,
    workspaces: [...workspaces].sort(),
  };
  writeFileSync(TRUST_FILE, JSON.stringify(store, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
}

function isExistingDirectory(cwd: string): boolean {
  try {
    return statSync(cwd).isDirectory();
  } catch {
    return false;
  }
}

export function normalizeWorkspacePath(cwd: string): string {
  return canonicalizeWorkspace(cwd);
}

export function isWorkspaceTrusted(cwd: string): boolean {
  const workspace = canonicalizeWorkspace(cwd);
  if (!workspace) return false;
  if (!isExistingDirectory(workspace)) return false;
  return readTrustedWorkspaces().has(workspace);
}

export function trustWorkspace(cwd: string): string {
  const workspace = canonicalizeWorkspace(cwd);
  if (!workspace) throw new Error("cwd is required");
  if (!isExistingDirectory(workspace)) throw new Error(`Directory does not exist: ${workspace}`);
  const workspaces = readTrustedWorkspaces();
  workspaces.add(workspace);
  writeTrustedWorkspaces(workspaces);
  return workspace;
}

export function assertTrustedWorkspace(cwd: string): NextResponse | null {
  if (!isWorkspaceTrusted(cwd)) {
    return NextResponse.json(
      { error: "Workspace is not trusted", workspaceTrustRequired: true, cwd: normalizeWorkspacePath(cwd) },
      { status: 403 },
    );
  }
  return null;
}
