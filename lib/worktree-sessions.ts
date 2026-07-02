import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { WorktreeMeta } from "@/lib/types";

export type { WorktreeMeta };

// pi-web-side metadata describing worktrees created via the UI. Keyed by the
// worktree's absolute path (which is the session cwd), NOT by session id:
// new sessions get their real id lazily on first message, but the cwd is known
// at creation time and is what the sidebar groups by. Kept out of pi's own
// session files so it never interferes with the SDK.
const STORE_PATH = join(homedir(), ".pi", "agent", "worktree-sessions.json");

type Store = Record<string, WorktreeMeta>; // key: worktreePath

function readStore(): Store {
  try {
    if (!existsSync(STORE_PATH)) return {};
    const raw = readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Store;
    return {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  } catch {
    // best-effort; a failure just means the sidebar won't show the badge
  }
}

export function recordWorktree(meta: WorktreeMeta): void {
  const store = readStore();
  store[meta.worktreePath] = meta;
  writeStore(store);
}

/** All worktree metadata, keyed by worktree path (== session cwd). */
export function getWorktreeMeta(): Store {
  return readStore();
}

export function removeWorktree(worktreePath: string): void {
  const store = readStore();
  if (store[worktreePath]) {
    delete store[worktreePath];
    writeStore(store);
  }
}
