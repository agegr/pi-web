// Incremental session-list scanner replacing SessionManager.listAll() for
// /api/sessions. The SDK's listAll parses every byte of every session file on
// every cache miss (~9.5 GiB / ~70s at 2k sessions) to build allMessagesText,
// which pi-web never reads. This scanner produces bit-identical values for the
// fields pi-web DOES use, memoized per file:
//
//   Invariant: a session file is append-only (pi only appends lines, or
//   rewrites wholesale via migration/fork — either way size+mtimeMs changes).
//   Therefore fingerprint (size, mtimeMs) unchanged => bytes unchanged =>
//   memoized info === fresh scan result. A changed/deleted/new file is always
//   rescanned/dropped/added, so the incremental result equals a full rescan
//   by construction. The equivalence is asserted by session-reader.test.mjs.
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

export interface ScannedSessionInfo {
	path: string;
	id: string;
	cwd: string;
	name?: string;
	created: Date;
	modified: Date;
	messageCount: number;
	firstMessage: string;
	parentSessionPath?: string;
}

interface Fingerprint {
	size: number;
	mtimeMs: number;
}

interface IndexEntry {
	fp: Fingerprint;
	info: ScannedSessionInfo;
}

type RawEntry = Record<string, unknown>;

const INDEX_FORMAT_VERSION = 1;

declare global {
	var __piWebScanIndex: Map<string, IndexEntry> | undefined;
	var __piWebScanIndexLoaded: boolean | undefined;
	var __piWebScanIndexSaveQueued: boolean | undefined;
}

function parseLine(line: string): RawEntry | null {
	if (!line.trim()) return null;
	try {
		const entry = JSON.parse(line) as RawEntry;
		return entry && typeof entry === "object" ? entry : null;
	} catch {
		return null;
	}
}

function extractTextContent(message: RawEntry): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(block): block is { type: string; text: string } =>
				!!block &&
				typeof block === "object" &&
				(block as RawEntry).type === "text" &&
				typeof (block as RawEntry).text === "string",
		)
		.map((block) => block.text)
		.join(" ");
}

function activityTimeOf(entry: RawEntry): number | undefined {
	const message = entry.message as RawEntry | undefined;
	if (
		!message ||
		typeof message.role !== "string" ||
		!("content" in message) ||
		(message.role !== "user" && message.role !== "assistant")
	) {
		return undefined;
	}
	if (typeof message.timestamp === "number") return message.timestamp;
	const t = new Date(entry.timestamp as string).getTime();
	return Number.isNaN(t) ? undefined : t;
}

// Mirrors the SDK's buildSessionInfo() line semantics exactly (same fallbacks,
// same rejection rules), minus allMessagesText which pi-web never consumes.
export async function scanSessionFileInfo(
	filePath: string,
): Promise<ScannedSessionInfo | null> {
	try {
		const stats = await stat(filePath);
		let header: RawEntry | null = null;
		let name: string | undefined;
		let messageCount = 0;
		let firstMessage = "";
		let lastActivityTime: number | undefined;

		const rl = createInterface({
			input: createReadStream(filePath, { encoding: "utf8" }),
			crlfDelay: Infinity,
		});

		for await (const line of rl) {
			const entry = parseLine(line);
			if (!entry) continue;

			if (!header) {
				if (entry.type !== "session") return null;
				header = entry;
				continue;
			}

			if (entry.type === "session_info") {
				name =
					typeof entry.name === "string" && entry.name.trim()
						? entry.name.trim()
						: undefined;
			}
			if (entry.type !== "message") continue;
			messageCount++;

			const activityTime = activityTimeOf(entry);
			if (typeof activityTime === "number") {
				lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime);
			}

			const message = entry.message as RawEntry | undefined;
			if (
				!message ||
				typeof message.role !== "string" ||
				!("content" in message)
			)
				continue;
			if (message.role !== "user" && message.role !== "assistant") continue;

			const textContent = extractTextContent(message);
			if (!textContent) continue;
			if (!firstMessage && message.role === "user") firstMessage = textContent;
		}

		if (!header) return null;

		const cwd = typeof header.cwd === "string" ? header.cwd : "";
		const parentSessionPath =
			typeof header.parentSession === "string"
				? header.parentSession
				: undefined;
		const headerTime =
			typeof header.timestamp === "string"
				? new Date(header.timestamp).getTime()
				: NaN;
		const modified =
			typeof lastActivityTime === "number" && lastActivityTime > 0
				? new Date(lastActivityTime)
				: !Number.isNaN(headerTime)
					? new Date(headerTime)
					: stats.mtime;

		return {
			path: filePath,
			id: header.id as string,
			cwd,
			name,
			parentSessionPath,
			created: new Date(header.timestamp as string),
			modified,
			messageCount,
			firstMessage: firstMessage || "(no messages)",
		};
	} catch {
		return null;
	}
}

async function enumerateSessionFiles(sessionsDir: string): Promise<string[]> {
	let dirs: Dirent[];
	try {
		const entries = await readdir(sessionsDir, { withFileTypes: true });
		dirs = entries.filter(
			(entry) => entry.isDirectory() || entry.isSymbolicLink(),
		);
	} catch {
		return [];
	}

	const files: string[] = [];
	for (const dir of dirs) {
		const dirPath = join(sessionsDir, dir.name);
		try {
			for (const f of await readdir(dirPath)) {
				if (f.endsWith(".jsonl")) files.push(join(dirPath, f));
			}
		} catch {
			// unreadable project dir: same skip-as-absent semantics as the SDK
		}
	}
	return files.sort();
}

const MAX_CONCURRENT_SCANS = 10;

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>) {
	let next = 0;
	const inFlight = new Set<Promise<void>>();
	while (next < items.length || inFlight.size > 0) {
		while (next < items.length && inFlight.size < MAX_CONCURRENT_SCANS) {
			const item = items[next++];
			const task = worker(item).finally(() => inFlight.delete(task));
			inFlight.add(task);
		}
		if (inFlight.size > 0) await Promise.race(inFlight);
	}
}

function getIndex(): Map<string, IndexEntry> {
	if (!globalThis.__piWebScanIndex) globalThis.__piWebScanIndex = new Map();
	return globalThis.__piWebScanIndex;
}

function indexFilePath(): string {
	return join(getAgentDir(), "pi-web-session-index.json");
}

function loadPersistedIndex(): void {
	if (globalThis.__piWebScanIndexLoaded) return;
	globalThis.__piWebScanIndexLoaded = true;
	const path = indexFilePath();
	if (!existsSync(path)) return;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as {
			version?: number;
			entries?: Record<string, { fp: Fingerprint; info: ScannedSessionInfo }>;
		};
		if (parsed.version !== INDEX_FORMAT_VERSION || !parsed.entries) return;
		const index = getIndex();
		for (const [pathKey, entry] of Object.entries(parsed.entries)) {
			index.set(pathKey, {
				fp: entry.fp,
				info: {
					...entry.info,
					created: new Date(entry.info.created),
					modified: new Date(entry.info.modified),
				},
			});
		}
	} catch {
		// corrupt index => cold rebuild, never an error surfaced to callers
	}
}

function queueIndexPersist(): void {
	if (globalThis.__piWebScanIndexSaveQueued) return;
	globalThis.__piWebScanIndexSaveQueued = true;
	queueMicrotask(() => {
		globalThis.__piWebScanIndexSaveQueued = undefined;
		try {
			const entries: Record<string, IndexEntry> = {};
			for (const [pathKey, entry] of getIndex()) entries[pathKey] = entry;
			writePrivateFileAtomicSync(
				indexFilePath(),
				JSON.stringify({ version: INDEX_FORMAT_VERSION, entries }),
			);
		} catch {
			// persistence is best-effort; the in-memory index remains authoritative
		}
	});
}

/**
 * Incremental equivalent of SessionManager.listAll(): rescans only files whose
 * (size, mtimeMs) changed since the last pass. Output ordering matches the SDK
 * catalogue (modified descending).
 */
export async function listSessionsIncremental(): Promise<ScannedSessionInfo[]> {
	loadPersistedIndex();

	const sessionsDir = join(getAgentDir(), "sessions");
	const files = await enumerateSessionFiles(sessionsDir);

	const index = getIndex();
	const present = new Set(files);
	const stale: string[] = [];
	for (const known of index.keys()) {
		if (!present.has(known)) stale.push(known);
	}
	for (const pathKey of stale) index.delete(pathKey);

	const fingerprints = await Promise.all(
		files.map(async (filePath) => {
			try {
				const s = await stat(filePath);
				return {
					filePath,
					fp: { size: s.size, mtimeMs: s.mtimeMs } as Fingerprint,
				};
			} catch {
				return { filePath, fp: null as Fingerprint | null };
			}
		}),
	);

	const changed: Array<{ filePath: string; fp: Fingerprint }> = [];
	const results: ScannedSessionInfo[] = [];
	for (const { filePath, fp } of fingerprints) {
		if (!fp) {
			index.delete(filePath);
			continue;
		}
		const cached = index.get(filePath);
		if (
			cached &&
			cached.fp.size === fp.size &&
			cached.fp.mtimeMs === fp.mtimeMs
		) {
			results.push(cached.info);
			continue;
		}
		changed.push({ filePath, fp });
	}

	await runPool(changed, async ({ filePath, fp }) => {
		const info = await scanSessionFileInfo(filePath);
		if (info) {
			index.set(filePath, { fp, info });
			results.push(info);
		} else {
			index.delete(filePath);
		}
	});

	if (changed.length > 0 || stale.length > 0) queueIndexPersist();

	results.sort((a, b) => b.modified.getTime() - a.modified.getTime());
	return results;
}

/** Test seam: drop all in-memory index state. */
export function resetSessionScanIndexForTests(): void {
	globalThis.__piWebScanIndex = undefined;
	globalThis.__piWebScanIndexLoaded = undefined;
	globalThis.__piWebScanIndexSaveQueued = undefined;
}
