// Cache session-list metadata without building the SDK's unused allMessagesText.
// Normal listings rescan only new/changed files; summary listings reuse whatever
// the index already holds and fall back to header/stat metadata for the files
// that changed, which a later normal listing hydrates.
// ponytail: size/mtime fingerprints miss same-size edits with restored mtime;
// use content hashes if detecting those edits becomes necessary.
import { closeSync, createReadStream, existsSync, openSync, readFileSync, readSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { basename, join } from "node:path";
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
	/** True when only header/stat metadata was available for this listing. */
	detailsPending?: boolean;
}

interface Fingerprint {
	size: number;
	mtimeMs: number;
}

const SUMMARY_HEADER_MAX_BYTES = 64 * 1024;

interface IndexEntry {
	fp: Fingerprint;
	info: ScannedSessionInfo;
}

type RawEntry = Record<string, unknown>;

function isRecord(value: unknown): value is RawEntry {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

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

/** Read only the first physical line needed to identify a session file. */
function readSessionHeaderSummary(filePath: string): RawEntry | null {
	const fd = openSync(filePath, "r");
	try {
		const buffer = Buffer.allocUnsafe(SUMMARY_HEADER_MAX_BYTES);
		const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
		if (bytesRead <= 0) return null;
		const source = buffer.subarray(0, bytesRead).toString("utf8");
		for (const line of source.split("\n")) {
			const entry = parseLine(line.replace(/\r$/, ""));
			if (!entry) continue;
			return entry.type === "session" ? entry : null;
		}
		return null;
	} catch {
		return null;
	} finally {
		closeSync(fd);
	}
}

function hasMatchingFingerprint(
	cached: IndexEntry | undefined,
	fingerprint: Fingerprint,
): cached is IndexEntry {
	return Boolean(
		cached
		&& cached.fp.size === fingerprint.size
		&& cached.fp.mtimeMs === fingerprint.mtimeMs,
	);
}

/** Build a session row from the header alone, without parsing the transcript. */
function deferredSessionInfo(
	filePath: string,
	fingerprint: Fingerprint,
): ScannedSessionInfo | null {
	const header = readSessionHeaderSummary(filePath);
	if (
		!header
		|| typeof header.id !== "string"
		|| typeof header.cwd !== "string"
		|| typeof header.timestamp !== "string"
	) return null;

	const created = new Date(header.timestamp);
	if (!Number.isFinite(created.getTime())) return null;

	return {
		path: filePath,
		id: header.id,
		cwd: header.cwd,
		created,
		modified: new Date(fingerprint.mtimeMs),
		messageCount: 0,
		firstMessage: "",
		...(typeof header.parentSession === "string" ? { parentSessionPath: header.parentSession } : {}),
		detailsPending: true,
	};
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

// Uses the SDK's buildSessionInfo() semantics for displayed metadata.
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
	return files;
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
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed) || parsed.version !== INDEX_FORMAT_VERSION || !isRecord(parsed.entries)) return;
		const index = getIndex();
		for (const [pathKey, entry] of Object.entries(parsed.entries)) {
			if (!isRecord(entry) || !isRecord(entry.fp) || !isRecord(entry.info)) continue;
			const { fp, info } = entry;
			if (
				typeof fp.size !== "number" || !Number.isSafeInteger(fp.size) || fp.size < 0 ||
				typeof fp.mtimeMs !== "number" || !Number.isFinite(fp.mtimeMs) ||
				info.path !== pathKey ||
				typeof info.id !== "string" ||
				typeof info.cwd !== "string" ||
				typeof info.firstMessage !== "string" ||
				(info.name !== undefined && typeof info.name !== "string") ||
				(info.parentSessionPath !== undefined && typeof info.parentSessionPath !== "string") ||
				typeof info.messageCount !== "number" || !Number.isSafeInteger(info.messageCount) || info.messageCount < 0 ||
				typeof info.created !== "string" || typeof info.modified !== "string"
			) continue;
			const created = new Date(info.created);
			const modified = new Date(info.modified);
			if (!Number.isFinite(created.getTime()) || !Number.isFinite(modified.getTime())) continue;
			index.set(pathKey, {
				fp: { size: fp.size, mtimeMs: fp.mtimeMs },
				info: {
					path: pathKey,
					id: info.id,
					cwd: info.cwd,
					name: info.name,
					parentSessionPath: info.parentSessionPath,
					firstMessage: info.firstMessage,
					messageCount: info.messageCount,
					created,
					modified,
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
export async function listSessionsIncremental(
	options: { deferDetails?: boolean } = {},
): Promise<ScannedSessionInfo[]> {
	loadPersistedIndex();
	const deferDetails = options.deferDetails ?? false;

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

	const changed: Array<{ filePath: string; fp: Fingerprint; resultIndex: number }> = [];
	const results: (ScannedSessionInfo | null)[] = new Array(files.length).fill(null);
	const mtimes: number[] = new Array(files.length).fill(Number.NEGATIVE_INFINITY);
	for (const [resultIndex, { filePath, fp }] of fingerprints.entries()) {
		if (!fp) {
			index.delete(filePath);
			continue;
		}
		mtimes[resultIndex] = fp.mtimeMs;
		const cached = index.get(filePath);
		if (hasMatchingFingerprint(cached, fp)) {
			// Complete details are already in memory and the index is persisted
			// across restarts, so on the common warm path every unchanged file
			// can paint its real count and first message immediately. Blanking
			// them would cost a request to get back what we are already holding.
			results[resultIndex] = cached.info;
			continue;
		}
		if (deferDetails) {
			// Header and stat only: a later normal listing fills in the transcript
			// details, so a first paint does not wait on parsing every file.
			const summary = deferredSessionInfo(filePath, fp);
			if (summary) results[resultIndex] = summary;
			else index.delete(filePath);
			continue;
		}
		changed.push({ filePath, fp, resultIndex });
	}

	await runPool(changed, async ({ filePath, fp, resultIndex }) => {
		const info = await scanSessionFileInfo(filePath);
		if (info) {
			index.set(filePath, { fp, info });
			results[resultIndex] = info;
		} else {
			index.delete(filePath);
		}
	});

	if (changed.length > 0 || stale.length > 0) queueIndexPersist();

	// Preserve catalogue order for timestamp ties, independently of cache hits
	// and the order in which concurrent file reads complete. Since pi 0.86 the
	// SDK reads files newest-mtime first (then reverse filename) so resume can
	// show results progressively, and its stable sort keeps that order for
	// sessions with equal activity time.
	return results
		.flatMap((info, resultIndex) => (info ? [{ info, mtimeMs: mtimes[resultIndex] }] : []))
		.sort((a, b) =>
			b.info.modified.getTime() - a.info.modified.getTime()
			|| b.mtimeMs - a.mtimeMs
			|| basename(b.info.path).localeCompare(basename(a.info.path)),
		)
		.map(({ info }) => info);
}

/** Test seam: drop all in-memory index state. */
export function resetSessionScanIndexForTests(): void {
	globalThis.__piWebScanIndex = undefined;
	globalThis.__piWebScanIndexLoaded = undefined;
	globalThis.__piWebScanIndexSaveQueued = undefined;
}
