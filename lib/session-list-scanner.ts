// Cache session-list metadata without building the SDK's unused allMessagesText.
// Normal listings rescan only new/changed files; summary listings reuse whatever
// the index already holds and fall back to header/stat metadata for the files
// that changed, which a later normal listing hydrates. A file that only grew
// since its last scan is parsed from where that scan stopped (#1259).
// ponytail: size/mtime fingerprints miss same-size edits with restored mtime,
// and the resume check compares only the inode, the header line and the bytes
// before the resume offset: an in-place edit that keeps all three (same-length,
// same inode), then an append, reads as an append, and the stale row persists
// across later appends until a change that does not grow the file, or replaces
// it, forces a full read. Use content hashes if detecting those edits becomes
// necessary.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { basename, join } from "node:path";
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
	/** The last assistant reply's stop reason in file order: "error" marks a failed run. */
	lastReplyStopReason?: string;
}

interface Fingerprint {
	size: number;
	mtimeMs: number;
}

const SUMMARY_HEADER_MAX_BYTES = 64 * 1024;

/**
 * Where the next scan of a file that only grew picks up. `offset` is just past
 * the last newline-terminated line parsed; the row's own name, count and first
 * message are the running totals (a scan that counted an unterminated last line
 * keeps no resume point). `check` hashes the header line, [0, headerEnd), with
 * the RESUME_SAMPLE_BYTES before `offset`: a rewrite in place fails it. `ino`
 * catches a file replaced by a rename (sed -i, editors, git checkout, a backup
 * restored), whatever its bytes.
 */
interface ResumePoint {
	ino: number;
	offset: number;
	headerEnd: number;
	check: string;
	/** False while no user message had text: the row shows "(no messages)". */
	hasFirstMessage: boolean;
	lastActivityTime?: number;
	lastReplyStopReason?: string;
}

interface IndexEntry {
	fp: Fingerprint;
	info: ScannedSessionInfo;
	resume?: ResumePoint;
}

type RawEntry = Record<string, unknown>;

function isRecord(value: unknown): value is RawEntry {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Bump on any change to what foldEntry() counts: a resumed scan adds to totals
// counted under the rules its prefix was scanned with.
const INDEX_FORMAT_VERSION = 2;
/** A trailing throttle: a run's rescans rewrite the index once per window. */
const INDEX_PERSIST_DELAY_MS = 5_000;
const RESUME_SAMPLE_BYTES = 512;
const NEWLINE = Buffer.from("\n");

declare global {
	var __piWebScanIndex: Map<string, IndexEntry> | undefined;
	var __piWebScanIndexLoaded: boolean | undefined;
	var __piWebScanIndexSave: PendingIndexSave | undefined;
}

/** A queued index write: where it goes and what, both fixed by the last scan that changed it. */
interface PendingIndexSave {
	path: string;
	entries: Array<[string, IndexEntry]>;
	timer: NodeJS.Timeout;
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
async function readSessionHeaderSummary(filePath: string): Promise<RawEntry | null> {
	let handle: FileHandle | undefined;
	try {
		handle = await open(filePath, "r");
		const buffer = Buffer.allocUnsafe(SUMMARY_HEADER_MAX_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
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
		await handle?.close().catch(() => undefined);
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

/** Only a file larger than at its last scan may resume where that scan stopped. */
function hasGrown(cached: IndexEntry | undefined, fingerprint: Fingerprint): cached is IndexEntry {
	return Boolean(
		cached?.resume
		&& fingerprint.size > cached.fp.size
		&& fingerprint.size >= cached.resume.offset,
	);
}

/** Build a session row from the header alone, without parsing the transcript. */
async function deferredSessionInfo(
	filePath: string,
	fingerprint: Fingerprint,
): Promise<ScannedSessionInfo | null> {
	const header = await readSessionHeaderSummary(filePath);
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

interface SessionHeader {
	id: string;
	cwd: string;
	created: Date;
	parentSessionPath?: string;
	/** NaN unless the header's timestamp is a string. */
	time: number;
	/** The header line and its newline, kept when a later scan may resume. */
	head?: Buffer;
}

interface ScanTotals {
	name?: string;
	messageCount: number;
	firstMessage: string;
	lastActivityTime?: number;
	lastReplyStopReason?: string;
}

function readHeader(entry: RawEntry, head: Buffer | undefined): SessionHeader {
	return {
		id: entry.id as string,
		cwd: typeof entry.cwd === "string" ? entry.cwd : "",
		created: new Date(entry.timestamp as string),
		parentSessionPath: typeof entry.parentSession === "string" ? entry.parentSession : undefined,
		time: typeof entry.timestamp === "string" ? new Date(entry.timestamp).getTime() : NaN,
		// A resumed scan rebuilds the header from the row, which holds it
		// faithfully only for a string id and timestamp.
		head: typeof entry.id === "string" && typeof entry.timestamp === "string" ? head : undefined,
	};
}

// Uses the SDK's buildSessionInfo() semantics for displayed metadata. A change
// to these rules must bump INDEX_FORMAT_VERSION (resumed totals keep the old ones).
function foldEntry(totals: ScanTotals, entry: RawEntry): void {
	if (entry.type === "session_info") {
		totals.name =
			typeof entry.name === "string" && entry.name.trim()
				? entry.name.trim()
				: undefined;
	}
	if (entry.type !== "message") return;
	totals.messageCount++;

	const activityTime = activityTimeOf(entry);
	if (typeof activityTime === "number") {
		totals.lastActivityTime = Math.max(totals.lastActivityTime ?? 0, activityTime);
	}

	const message = entry.message as RawEntry | undefined;
	if (message && message.role === "assistant") {
		// Last wins, so a retry's answer clears the failed attempt before it.
		totals.lastReplyStopReason = typeof message.stopReason === "string" ? message.stopReason : "";
	}

	if (totals.firstMessage) return;
	if (
		!message ||
		typeof message.role !== "string" ||
		!("content" in message)
	)
		return;
	if (message.role !== "user") return;
	totals.firstMessage = extractTextContent(message);
}

function sampleCheck(head: Buffer, tail: Buffer): string {
	return createHash("sha1").update(head).update(tail).digest("base64");
}

/** Drop leading parts not needed for the last RESUME_SAMPLE_BYTES of `parts`. */
function keepLastBytes(parts: Buffer[]): Buffer[] {
	let total = 0;
	for (const part of parts) total += part.length;
	let first = 0;
	while (first < parts.length - 1 && total - parts[first].length >= RESUME_SAMPLE_BYTES) {
		total -= parts[first].length;
		first++;
	}
	return first > 0 ? parts.slice(first) : parts;
}

/**
 * One newline-free run of bytes split into lines as the scan's readline read
 * did on Node 22: \r\n and a lone \r end a line. U+2028 and U+2029, which
 * JSON.stringify leaves raw and Node 24's readline splits on, stay inside the
 * line, as pi's own loader keeps them.
 */
function linesOf(bytes: Buffer): string[] {
	const text = bytes.toString("utf8");
	return text.includes("\r") ? text.split("\r") : [text];
}

interface LineScan {
	/** Just past the last newline read. */
	offset: number;
	/** The RESUME_SAMPLE_BYTES before `offset` (fewer near the start). */
	sample: Buffer;
	/** The bytes after the last newline: a line its writer may still be appending. */
	rest: Buffer;
}

/**
 * Hand each newline-terminated line from `start` on to `onLine`, with the
 * offset just past its newline. Returns null when `onLine` returns false.
 */
async function readLines(
	filePath: string,
	start: number,
	sample: Buffer,
	onLine: (bytes: Buffer, end: number) => boolean,
): Promise<LineScan | null> {
	let offset = start;
	let pending: Buffer[] = [];
	// The bytes read up to `offset`, as views, trimmed to what the sample needs
	// once per chunk (not per line: a full scan of short lines stays as fast).
	let read = [sample];
	for await (const chunk of createReadStream(filePath, { start }) as AsyncIterable<Buffer>) {
		let newline = chunk.indexOf(0x0a);
		if (newline === -1) {
			pending.push(chunk);
			continue;
		}
		const carried = pending;
		let lineStart = 0;
		while (newline !== -1) {
			const piece = chunk.subarray(lineStart, newline);
			const bytes = pending.length > 0 ? Buffer.concat([...pending, piece]) : piece;
			pending = [];
			offset += bytes.length + 1;
			if (!onLine(bytes, offset)) return null;
			lineStart = newline + 1;
			newline = chunk.indexOf(0x0a, lineStart);
		}
		read = keepLastBytes([...read, ...carried, chunk.subarray(0, lineStart)]);
		if (lineStart < chunk.length) pending.push(chunk.subarray(lineStart));
	}
	const joined = Buffer.concat(read);
	return {
		offset,
		sample: joined.subarray(Math.max(0, joined.length - RESUME_SAMPLE_BYTES)),
		rest: Buffer.concat(pending),
	};
}

/**
 * The header line and the bytes before the resume offset, when they still hash
 * to the resume point's check; null sends the caller to a full scan.
 */
async function readResumeSample(
	filePath: string,
	resume: ResumePoint,
): Promise<{ head: Buffer; tail: Buffer } | null> {
	const handle = await open(filePath, "r");
	try {
		const tailStart = Math.max(0, resume.offset - RESUME_SAMPLE_BYTES);
		const head = Buffer.alloc(resume.headerEnd);
		const tail = Buffer.alloc(resume.offset - tailStart);
		const headRead = await handle.read(head, 0, head.length, 0);
		const tailRead = await handle.read(tail, 0, tail.length, tailStart);
		if (headRead.bytesRead !== head.length || tailRead.bytesRead !== tail.length) return null;
		return sampleCheck(head, tail) === resume.check ? { head, tail } : null;
	} finally {
		await handle.close();
	}
}

/**
 * Scan a session file for its row, from where `previous` stopped when the
 * file only grew since and its sampled prefix is unchanged, else from byte 0.
 * Either way the row is the one a full read of the file gives.
 */
async function scanSessionFile(
	filePath: string,
	previous?: IndexEntry,
): Promise<Omit<IndexEntry, "fp"> | null> {
	try {
		const stats = await stat(filePath);
		const resumed = previous?.resume && previous.resume.ino === stats.ino
			? await readResumeSample(filePath, previous.resume)
			: null;
		let header: SessionHeader | null = null;
		let headerEnd = 0;
		let start = 0;
		let sample: Buffer = Buffer.alloc(0);
		const totals: ScanTotals = { messageCount: 0, firstMessage: "" };
		if (previous?.resume && resumed) {
			const { info, resume } = previous;
			start = resume.offset;
			sample = resumed.tail;
			header = {
				id: info.id,
				cwd: info.cwd,
				created: new Date(info.created.getTime()),
				parentSessionPath: info.parentSessionPath,
				time: info.created.getTime(),
				head: resumed.head,
			};
			headerEnd = resume.headerEnd;
			totals.name = info.name;
			totals.messageCount = info.messageCount;
			totals.firstMessage = resume.hasFirstMessage ? info.firstMessage : "";
			totals.lastActivityTime = resume.lastActivityTime;
			totals.lastReplyStopReason = resume.lastReplyStopReason;
		}

		let restCounted = false;
		const parseLines = (bytes: Buffer, end: number | null): boolean => {
			for (const line of linesOf(bytes)) {
				const entry = parseLine(line);
				if (!entry) continue;
				if (end === null) restCounted = true;
				if (!header) {
					if (entry.type !== "session") return false;
					// Only a header on the file's first line is sampled for resuming.
					const firstLine = end !== null && end === bytes.length + 1;
					header = readHeader(entry, firstLine ? Buffer.concat([bytes, NEWLINE]) : undefined);
					headerEnd = firstLine ? end : 0;
					continue;
				}
				foldEntry(totals, entry);
			}
			return true;
		};

		const scan = await readLines(filePath, start, sample, parseLines);
		// The unterminated rest counts for this listing, as it did when the scan
		// read lines with readline; a resume point is kept only when it changed nothing.
		if (!scan || (scan.rest.length > 0 && !parseLines(scan.rest, null))) return null;
		if (!header) return null;
		const { id, cwd, created, parentSessionPath, time, head } = header;

		const modified =
			typeof totals.lastActivityTime === "number" && totals.lastActivityTime > 0
				? new Date(totals.lastActivityTime)
				: !Number.isNaN(time)
					? new Date(time)
					: stats.mtime;

		return {
			info: {
				path: filePath,
				id,
				cwd,
				name: totals.name,
				parentSessionPath,
				created,
				modified,
				messageCount: totals.messageCount,
				firstMessage: totals.firstMessage || "(no messages)",
				...(totals.lastReplyStopReason !== undefined ? { lastReplyStopReason: totals.lastReplyStopReason } : {}),
			},
			// An inode of 0 (no stable one on this filesystem) never resumes.
			resume: head && headerEnd > 0 && !restCounted && stats.ino > 0
				? {
					ino: stats.ino,
					offset: scan.offset,
					headerEnd,
					check: sampleCheck(head, scan.sample),
					hasFirstMessage: totals.firstMessage !== "",
					...(totals.lastActivityTime !== undefined ? { lastActivityTime: totals.lastActivityTime } : {}),
					...(totals.lastReplyStopReason !== undefined ? { lastReplyStopReason: totals.lastReplyStopReason } : {}),
				}
				: undefined,
		};
	} catch {
		return null;
	}
}

export async function scanSessionFileInfo(
	filePath: string,
): Promise<ScannedSessionInfo | null> {
	return (await scanSessionFile(filePath))?.info ?? null;
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

function indexFilePath(agentDir = getAgentDir()): string {
	return join(agentDir, "pi-web-session-index.json");
}

/** A persisted resume point, or undefined when it is missing or malformed (the entry stays). */
function readResumePoint(value: unknown): ResumePoint | undefined {
	if (!isRecord(value)) return undefined;
	const { ino, offset, headerEnd, check, hasFirstMessage, lastActivityTime, lastReplyStopReason } = value;
	if (
		typeof ino !== "number" || !Number.isFinite(ino) || ino <= 0 ||
		typeof headerEnd !== "number" || !Number.isSafeInteger(headerEnd) || headerEnd <= 0 ||
		typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < headerEnd ||
		typeof check !== "string" ||
		typeof hasFirstMessage !== "boolean" ||
		(lastActivityTime !== undefined && (typeof lastActivityTime !== "number" || !Number.isFinite(lastActivityTime))) ||
		(lastReplyStopReason !== undefined && typeof lastReplyStopReason !== "string")
	) return undefined;
	return {
		ino,
		offset,
		headerEnd,
		check,
		hasFirstMessage,
		...(lastActivityTime !== undefined ? { lastActivityTime } : {}),
		...(lastReplyStopReason !== undefined ? { lastReplyStopReason } : {}),
	};
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
				(info.lastReplyStopReason !== undefined && typeof info.lastReplyStopReason !== "string") ||
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
					...(typeof info.lastReplyStopReason === "string" ? { lastReplyStopReason: info.lastReplyStopReason } : {}),
				},
				// Entries from before resume points get one full scan when they change.
				resume: readResumePoint(entry.resume),
			});
		}
	} catch {
		// corrupt index => cold rebuild, never an error surfaced to callers
	}
}

function persistIndex(): void {
	const pending = globalThis.__piWebScanIndexSave;
	if (!pending) return;
	clearTimeout(pending.timer);
	globalThis.__piWebScanIndexSave = undefined;
	try {
		writePrivateFileAtomicSync(
			pending.path,
			JSON.stringify({ version: INDEX_FORMAT_VERSION, entries: Object.fromEntries(pending.entries) }),
		);
	} catch {
		// persistence is best-effort; the in-memory index remains authoritative
	}
}

/**
 * Write the index to `path` once INDEX_PERSIST_DELAY_MS has passed, with what
 * it holds now. Later scans of the same agent dir only replace what is written;
 * a scan of another one sends the pending write to its own dir first.
 */
function queueIndexPersist(path: string): void {
	const entries = [...getIndex()];
	const pending = globalThis.__piWebScanIndexSave;
	if (pending?.path === path) {
		pending.entries = entries;
		return;
	}
	persistIndex();
	const timer = setTimeout(persistIndex, INDEX_PERSIST_DELAY_MS);
	// A pending write never holds a process open: a lost one means a rescan.
	timer.unref?.();
	globalThis.__piWebScanIndexSave = { path, entries, timer };
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

	const agentDir = getAgentDir();
	const sessionsDir = join(agentDir, "sessions");
	const files = await enumerateSessionFiles(sessionsDir);
	globalThis.__piSessionMembership = { files: new Set(files) };

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

	const deferred: Array<{ filePath: string; fp: Fingerprint; resultIndex: number }> = [];
	const changed: Array<{ filePath: string; fp: Fingerprint; resultIndex: number; previous?: IndexEntry }> = [];
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
			deferred.push({ filePath, fp, resultIndex });
			continue;
		}
		// A running session's file grows on every append: parse only the tail.
		changed.push({ filePath, fp, resultIndex, previous: hasGrown(cached, fp) ? cached : undefined });
	}

	await runPool(deferred, async ({ filePath, fp, resultIndex }) => {
		const summary = await deferredSessionInfo(filePath, fp);
		if (summary) results[resultIndex] = summary;
		else index.delete(filePath);
	});

	await runPool(changed, async ({ filePath, fp, resultIndex, previous }) => {
		const scanned = await scanSessionFile(filePath, previous);
		if (scanned) {
			index.set(filePath, { fp, ...scanned });
			results[resultIndex] = scanned.info;
		} else {
			index.delete(filePath);
		}
	});

	if (changed.length > 0 || stale.length > 0) queueIndexPersist(indexFilePath(agentDir));

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

/** Test seam: write a pending index save now instead of after its delay. */
export function flushSessionScanIndexForTests(): void {
	persistIndex();
}

/** Test seam: drop all in-memory index state and any pending index save. */
export function resetSessionScanIndexForTests(): void {
	clearTimeout(globalThis.__piWebScanIndexSave?.timer);
	globalThis.__piWebScanIndex = undefined;
	globalThis.__piWebScanIndexLoaded = undefined;
	globalThis.__piWebScanIndexSave = undefined;
	globalThis.__piSessionMembership = undefined;
	globalThis.__piSessionMembershipCheck = undefined;
}

// ============================================================================
// Filename membership: sessions another process creates or deletes.
// ============================================================================

declare global {
	/** The session files the last scan listed (or the last change a check reported). */
	var __piSessionMembership: { files: Set<string> } | undefined;
	var __piSessionMembershipCheck: { at: number; busy: boolean } | undefined;
}

export const SESSION_MEMBERSHIP_CHECK_MS = 1_000;

/**
 * Compare the session files on disk with the last scan's and call `onChange`
 * once when they differ. Directory reads only: appends to a transcript never
 * change its name, so a running session costs nothing here. At most one check
 * per SESSION_MEMBERSHIP_CHECK_MS, never two at once, and none before the
 * first scan. Returns the check's promise, or undefined when none started.
 */
export function checkSessionMembership(
	sessionsDir: string,
	onChange: () => void,
	now = Date.now(),
): Promise<void> | undefined {
	const known = globalThis.__piSessionMembership;
	const state = (globalThis.__piSessionMembershipCheck ??= { at: Number.NEGATIVE_INFINITY, busy: false });
	if (!known || state.busy || now - state.at < SESSION_MEMBERSHIP_CHECK_MS) return undefined;
	state.busy = true;
	state.at = now;
	return enumerateSessionFiles(sessionsDir)
		.then((files) => {
			// A scan recorded while this read ran replaces the baseline: drop this
			// result, the next check compares against the scan's own listing.
			if (globalThis.__piSessionMembership !== known) return;
			if (known.files.size === files.length && files.every((file) => known.files.has(file))) return;
			// Record the change so it bumps once, not on every check until a rescan.
			globalThis.__piSessionMembership = { files: new Set(files) };
			onChange();
		})
		.catch(() => undefined)
		.finally(() => {
			state.busy = false;
		});
}
