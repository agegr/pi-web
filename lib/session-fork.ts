import { randomBytes } from "crypto";
import { existsSync, writeFileSync } from "fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { forkSessionName, sessionDisplayTitle } from "./session-fork-name";
import { scanSessionFileInfo } from "./session-list-scanner";
import { readSubagentRun } from "./subagents";
import type { SessionEntry } from "./types";

/**
 * The sidebar's Fork: pi's `/clone` (a copy of the current branch, positioned
 * at its leaf) done on disk, so it never needs, starts or touches an
 * AgentSession and works while the source runs. Unlike `/clone`, the copy is
 * named: the source's title plus a short random suffix (session-fork-name.ts).
 */

export type SessionForkRefusal = "not_found" | "unsaved" | "empty" | "subagent";

export class SessionForkError extends Error {
  constructor(readonly code: SessionForkRefusal, message: string) {
    super(message);
    this.name = "SessionForkError";
  }
}

/** The session list's first message for a session with no user text (scanSessionFileInfo()). */
const NO_USER_TEXT = "(no messages)";

/**
 * The title the sidebar shows for the source, read as the session list reads
 * its row: the newest `session_info` name in the file, else its first user
 * message. Null when the source has neither (shell-only, or only images from
 * its user): the list's "(no messages)" placeholder is no title to keep, and
 * the copy is left unnamed, to take its first real message as pi's `/clone`
 * would. Undefined when the file cannot be read (not written yet) or the
 * title is blank.
 */
export async function readForkSourceTitle(sourcePath: string): Promise<string | null | undefined> {
  const scanned = await scanSessionFileInfo(sourcePath);
  if (!scanned) return undefined;
  if (!scanned.name && scanned.firstMessage === NO_USER_TEXT) return null;
  return sessionDisplayTitle(scanned).trim() || undefined;
}

/**
 * Copies the branch that ends at the leaf into a new session file beside the
 * source (same directory and cwd, header `parentSession` = the source) and
 * names the copy after `sourceTitle` (readForkSourceTitle(); without one, or
 * with a blank one, after the source's id, as a row with no title shows it)
 * plus 4 random hex digits; `sourceTitle` null leaves the copy unnamed.
 * `liveLeafId` is an open wrapper's leaf (null: its leaf was reset before the
 * first entry); undefined means the file's own leaf, its last entry.
 *
 * Only entries already on disk are copied: pi appends each finished entry
 * synchronously in this process, so a run in progress contributes what it has
 * finished. Opens its own SessionManager, because createBranchedSession()
 * repoints the instance it runs on: never the cached reader of
 * openSessionManager() nor a wrapper's. The name is a `session_info` entry
 * appended on that instance, as a rename appends one, so only the copy gets
 * it. pi's open-time migration may rewrite an old-version source, as viewing
 * it does; the source is otherwise unchanged.
 */
export function forkSessionBranch(
  sourcePath: string,
  liveLeafId?: string | null,
  sourceTitle?: string | null,
): { sessionId: string; path: string; name: string | undefined } {
  const live = liveLeafId !== undefined;
  // SessionManager.open() of a missing path silently starts an empty session.
  if (!existsSync(sourcePath)) {
    throw live
      ? new SessionForkError("unsaved", "This session has not been saved yet. Send a message before forking it.")
      : new SessionForkError("not_found", "Session not found");
  }
  const manager = SessionManager.open(sourcePath);
  const leafId = live ? liveLeafId : manager.getLeafId();
  if (!leafId) throw new SessionForkError("empty", "Nothing to fork: the session has no messages");
  // The wrapper's leaf is an entry not written yet.
  if (!manager.getEntry(leafId)) {
    throw new SessionForkError("unsaved", "This session has not been saved yet. Send a message before forking it.");
  }

  const branch = manager.getBranch(leafId);
  // A copy carrying a subagent's metadata would be read as that subagent and
  // folded, out of sight, into its parent's family.
  if (readSubagentRun(branch as unknown as SessionEntry[], "", sourcePath)) {
    throw new SessionForkError("subagent", "A subagent session cannot be forked");
  }
  if (!branch.some((entry) => entry.type === "message")) {
    throw new SessionForkError("empty", "Nothing to fork: the session has no messages");
  }

  // Read before createBranchedSession() repoints the instance to the copy.
  const name = sourceTitle === null ? undefined : forkSessionName(
    sourceTitle?.trim() || manager.getSessionId().slice(0, 12),
    randomBytes(2).toString("hex"),
    typeof manager.getHeader()?.parentSession === "string",
  );
  const path = manager.createBranchedSession(leafId);
  // Appended to the copy's file; a shell-only copy keeps it in memory until
  // it is written below.
  if (name) manager.appendSessionInfo(name);
  if (path && !existsSync(path)) {
    // pi writes the copy only once it has a user or assistant message; a
    // shell-only branch (pi-web keeps those sessions) is written here.
    const header = manager.getHeader();
    if (header) {
      const content = [header, ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
      writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
    }
  }
  if (!path || !existsSync(path)) throw new Error("Failed to fork the session");
  return { sessionId: manager.getSessionId(), path, name };
}
