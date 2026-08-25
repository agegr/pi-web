// Shared helpers for pi-web E2E (script-style, no runner, no config).
// Keep it tiny: only what J0-J5 specs reuse. Isolation = write under
// ~/.pi/agent/sessions/e2e-* and rmSync on cleanup.
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

export const BASE = process.env.E2E_BASE || "http://127.0.0.1:3100";
export const E2E_ROOT = join(homedir(), ".pi", "agent", "sessions");

export function e2eDir(name) {
	return join(E2E_ROOT, name);
}
export function e2eFile(dir, sessionId) {
	return join(dir, `2026-08-23T00-00-00-000Z_${sessionId}.jsonl`);
}

export function ensureDir(dir) {
	mkdirSync(dir, { recursive: true });
}

export function writeLinearSession({
	dir,
	sessionId,
	n = 100,
	cwd = process.cwd(),
	startContent = "E2E message",
}) {
	ensureDir(dir);
	const lines = [
		JSON.stringify({
			type: "session",
			version: 3,
			id: sessionId,
			timestamp: new Date().toISOString(),
			cwd,
		}),
	];
	for (let i = 0; i < n; i++) {
		lines.push(
			JSON.stringify({
				id: `e${i}`,
				parentId: i === 0 ? null : `e${i - 1}`,
				type: "message",
				timestamp: new Date(1000 + i * 1000).toISOString(),
				message: {
					role: i % 2 === 0 ? "user" : "assistant",
					content: `${startContent} ${i}`,
				},
			}),
		);
	}
	const file = e2eFile(dir, sessionId);
	writeFileSync(file, lines.join("\n") + "\n", "utf8");
	return file;
}

export function writeBranchedSession({ dir, sessionId, cwd = process.cwd() }) {
	// Main chain 0..9, then fork at e5 -> branch a0,a1
	ensureDir(dir);
	const lines = [
		JSON.stringify({
			type: "session",
			version: 3,
			id: sessionId,
			timestamp: new Date().toISOString(),
			cwd,
		}),
	];
	for (let i = 0; i < 10; i++) {
		lines.push(
			JSON.stringify({
				id: `e${i}`,
				parentId: i === 0 ? null : `e${i - 1}`,
				type: "message",
				timestamp: new Date(1000 + i * 1000).toISOString(),
				message: { role: "user", content: `branch-base ${i}` },
			}),
		);
	}
	// fork branch
	lines.push(
		JSON.stringify({
			id: "a0",
			parentId: "e5",
			type: "message",
			timestamp: new Date(20000).toISOString(),
			message: { role: "user", content: "branch-a 0" },
		}),
	);
	lines.push(
		JSON.stringify({
			id: "a1",
			parentId: "a0",
			type: "message",
			timestamp: new Date(21000).toISOString(),
			message: { role: "assistant", content: "branch-a 1" },
		}),
	);
	const file = e2eFile(dir, sessionId);
	writeFileSync(file, lines.join("\n") + "\n", "utf8");
	return file;
}

export function writeRichSession({ dir, sessionId, cwd = process.cwd() }) {
	ensureDir(dir);
	const lines = [
		JSON.stringify({
			type: "session",
			version: 3,
			id: sessionId,
			timestamp: new Date().toISOString(),
			cwd,
		}),
	];
	const msgs = [
		{ role: "user", content: "hello **markdown** with `code`" },
		{
			role: "assistant",
			content: [
				{ type: "text", text: "reply with code:\n```js\nconsole.log(1)\n```" },
			],
		},
		{ role: "user", content: "tool test" },
		{
			role: "assistant",
			content: [{ type: "text", text: "tool call below" }],
			toolCalls: [{ toolCallId: "t1", toolName: "test_tool", input: { a: 1 } }],
		},
	];
	msgs.forEach((m, i) => {
		lines.push(
			JSON.stringify({
				id: `r${i}`,
				parentId: i === 0 ? null : `r${i - 1}`,
				type: "message",
				timestamp: new Date(3000 + i * 1000).toISOString(),
				message: m,
			}),
		);
	});
	const file = e2eFile(dir, sessionId);
	writeFileSync(file, lines.join("\n") + "\n", "utf8");
	return file;
}

export function cleanupDir(dir) {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {}
}

export async function launchPage() {
	const browser = await chromium.launch();
	const page = await browser.newPage();
	page.setDefaultTimeout(30_000);
	const consoleErrors = [];
	const pageErrors = [];
	page.on("console", (m) => {
		if (m.type() === "error") consoleErrors.push(m.text());
	});
	page.on("pageerror", (e) => pageErrors.push(String(e)));
	return { browser, page, consoleErrors, pageErrors };
}

export async function assertNoBrowserErrors(consoleErrors, pageErrors) {
	const filteredConsole = consoleErrors.filter((e) => !/favicon|404/i.test(e));
	if (pageErrors.length || filteredConsole.length) {
		throw new Error(
			`browser errors: page=${JSON.stringify(pageErrors)} console=${JSON.stringify(filteredConsole)}`,
		);
	}
}

export async function waitForText(page, text, timeout = 30_000) {
	await page.waitForFunction(
		(t) => (document.body.innerText || "").includes(t),
		text,
		{ timeout },
	);
}

export function resultLog(result) {
	console.log(JSON.stringify(result, null, 2));
}

// Assert an API endpoint returns 2xx and parseable JSON; any 5xx fails hard.
export async function assertApiOk(url) {
	const res = await fetch(url);
	if (res.status >= 500) {
		throw new Error(`API 500 at ${url}: ${(await res.text()).slice(0, 300)}`);
	}
	if (!res.ok) {
		throw new Error(`API ${res.status} at ${url}`);
	}
	try {
		return await res.json();
	} catch {
		throw new Error(`API non-JSON response at ${url}`);
	}
}

// Assert an endpoint does NOT 500 (4xx/2xx both acceptable for negative cases).
export async function assertApiNot500(url) {
	const res = await fetch(url);
	if (res.status >= 500) {
		throw new Error(
			`API 500 (expected 4xx/2xx) at ${url}: ${(await res.text()).slice(0, 300)}`,
		);
	}
	return { status: res.status };
}
