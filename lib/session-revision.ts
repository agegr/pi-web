// Opaque freshness revision for a session read, used by the client-side
// session view cache to decide whether a cached window is still current.
//
// The revision mixes:
// - a disk fingerprint of the session file (size + mtime + ctime),
// - the identity of the read source (a live runtime wrapper vs a disk open),
// - the entry count, newest entry id, and active leaf of the read snapshot.
//
// It is a validity token, NOT a permission check and NOT a content hash:
// the JSONL body is never read here, and a `null`/mismatched revision simply
// tells the client to fall back to a fresh server window.

import { createHash } from "crypto";
import { statSync } from "fs";

export interface SessionRevisionParts {
	filePath: string;
	/** Identity of the read source, e.g. "runtime:<sessionId>" or "disk". */
	sourceId: string;
	entryCount: number;
	latestEntryId: string | null;
	leafId: string | null;
}

function fileFingerprint(filePath: string): string {
	try {
		const stats = statSync(filePath);
		return `${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
	} catch {
		return "missing";
	}
}

/** Stable, opaque revision string for one session snapshot, or null when the
 * snapshot cannot be reliably fingerprinted (callers treat null as unstable). */
export function computeSessionRevision(parts: SessionRevisionParts): string | null {
	try {
		return createHash("sha1")
			.update(JSON.stringify({
				fp: fileFingerprint(parts.filePath),
				source: parts.sourceId,
				entries: parts.entryCount,
				latest: parts.latestEntryId,
				leaf: parts.leafId,
			}))
			.digest("base64url")
			.slice(0, 22);
	} catch {
		return null;
	}
}
