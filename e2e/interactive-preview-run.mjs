import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { checkInteractivePreview, interactivePreviewFixture } from "./interactive-preview.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const existingServer = process.env.PI_WEB_TEST_BASE_URL;
const baseUrl = existingServer || 'http://127.0.0.1:30141';
if (!existingServer) assert.ok(!existsSync(join(root, '.next/dev/lock')), 'Set PI_WEB_TEST_BASE_URL to reuse the healthy dev server');
const agentDir = mkdtempSync(join(tmpdir(), 'pi-web-interactive-e2e-'));
const project = join(agentDir, 'project');
const sessionDir = join(agentDir, 'sessions', 'fixture');
const artifacts = join(root, 'test-results', 'interactive-preview');
mkdirSync(project);
mkdirSync(sessionDir, { recursive: true });
mkdirSync(artifacts, { recursive: true });
const id = 'e2e-interactive-preview';
const timestamp = new Date().toISOString();
const fenced = `\`\`\`pi-html\n${interactivePreviewFixture}\n\`\`\``;
const entries = [
  { type: 'session', version: 3, id, timestamp, cwd: project },
  { type: 'message', id: 'user', parentId: null, timestamp, message: { role: 'user', content: `Make a bill splitter.\n\n${fenced}` } },
  { type: 'message', id: 'answer', parentId: 'user', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: `${fenced}\n\n\`\`\`html\n<button>Source only</button>\n\`\`\`` }], provider: 'test', model: 'test', stopReason: 'stop', timestamp: Date.now() } },
];
writeFileSync(join(sessionDir, `${id}.jsonl`), entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
const log = createWriteStream(join(artifacts, 'server.log'));
const server = existingServer ? null : spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'dev', '-H', '127.0.0.1', '-p', '30141'], {
  cwd: root,
  env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: '', NEXT_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverExited = server ? once(server, 'exit') : null;
server?.stdout.pipe(log, { end: false });
server?.stderr.pipe(log, { end: false });
let browser;
let page;
try {
  const deadline = Date.now() + 120_000;
  while (!existingServer) {
    assert.equal(server.exitCode, null, 'Dev server exited; see server.log');
    const response = await fetch(`${baseUrl}/api/sessions`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) {
      assert.ok((await response.json()).sessions.some((session) => session.id === id), 'The test must use its isolated session directory');
      break;
    }
    assert.ok(Date.now() < deadline, 'Server readiness timed out');
    await delay(250);
  }
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 3840, height: 2160 }]) {
    const context = await browser.newContext({ viewport, locale: 'en-US', isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
    page = await context.newPage();
    if (existingServer) await mockPreviewSession(page);
    page.setDefaultTimeout(30_000);
    const errors = [];
    page.on('pageerror', (error) => { if (error.message !== 'fixture error') errors.push(error.message); });
    await page.goto(`${baseUrl}/?session=${id}`, { waitUntil: 'domcontentloaded' });
    await checkInteractivePreview(page, artifacts, viewport.width);
    if (existingServer) await checkStreamingSource(page, viewport.width);
    assert.deepEqual(errors, []);
    await context.close();
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  await page?.screenshot({ path: join(artifacts, 'failure.png') }).catch(() => {});
} finally {
  await browser?.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill('SIGTERM');
    const killTimer = setTimeout(() => server.kill('SIGKILL'), 10_000);
    await serverExited;
    clearTimeout(killTimer);
  }
  log.end();
  rmSync(agentDir, { recursive: true, force: true });
}

async function mockPreviewSession(page) {
  const info = { id, path: join(sessionDir, `${id}.jsonl`), cwd: project, name: 'Preview fixture', created: timestamp, modified: timestamp, messageCount: 2, firstMessage: 'Make a bill splitter.' };
  const state = { isStreaming: false, isPromptRunning: false, queuedMessages: [], toolNames: [] };
  const uiState = { version: 1, revision: 0, sessions: {}, projects: {} };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    let body;
    if (url.pathname === '/api/sessions') body = { sessions: [info] };
    else if (url.pathname === '/api/models') body = { models: {}, modelList: [], defaultModel: null, defaultThinkingLevel: null, thinkingLevels: {}, thinkingLevelMaps: {}, thinkingLevelPins: {} };
    else if (url.pathname === '/api/project-trust') body = { requiresTrust: false, trusted: true, decision: null, inherited: false, servers: [] };
    else if (url.pathname === '/api/worktrees') body = { projectRoot: project, projectKey: project, isGit: false, isTopLevel: true, currentWorktreePath: null, worktrees: [] };
    else if (url.pathname === '/api/git/status') body = { isGit: false, files: [] };
    else if (url.pathname.startsWith('/api/files/')) body = { entries: [] };
    else if (url.pathname === '/api/sessions/ui-state') body = { state: uiState };
    else if (url.pathname === `/api/sessions/${id}`) body = {
      sessionId: id, filePath: info.path, info, leafId: 'answer', tree: [], treeFormat: 'summary',
      context: { messages: entries.slice(1).map((entry) => entry.message), entryIds: ['user', 'answer'], oldestEntryId: 'user', hasMore: false, thinkingLevel: 'off', model: null },
      totalActiveMs: 0, toolNames: [],
    };
    else if (url.pathname === `/api/sessions/${id}/state`) body = { running: true, state };
    else if (url.pathname === '/api/agent/running') body = { ids: [id], uiStateRevision: 0 };
    else if (url.pathname === `/api/agent/${id}`) {
      if (route.request().method() === 'POST') {
        const command = route.request().postDataJSON();
        body = { success: true, data: command.type === 'get_tools' ? [] : command.type === 'get_commands' ? { commands: [] } : state };
      } else body = { state };
    } else if (route.request().method() !== 'GET') {
      // No test interaction is allowed to write to the running user's agent.
      return route.fulfill({ status: 403, json: { error: 'Blocked by fixture' } });
    } else return route.continue();
    return route.fulfill({ json: body });
  });
  await page.addInitScript(() => {
    const OriginalEventSource = window.EventSource;
    window.EventSource = class extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      readyState = 1;
      onmessage = null;
      onerror = null;
      constructor(url, options) {
        super();
        if (!String(url).includes('/api/agent/e2e-interactive-preview/events')) return new OriginalEventSource(url, options);
        window.__previewEventSource = this;
        setTimeout(() => this.emit({ type: 'connected', isStreaming: false }), 0);
      }
      emit(event) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) })); }
      close() { this.readyState = 2; }
    };
  });
}

async function checkStreamingSource(page, width) {
  await page.waitForFunction(() => window.__previewEventSource?.onmessage);
  const emit = (text, start = false) => page.evaluate(({ text, start }) => {
    const source = window.__previewEventSource;
    if (start) source.emit({ type: 'agent_start' });
    source.emit({ type: 'message_start', message: { role: 'assistant', content: [{ type: 'text', text }], provider: 'test', model: 'test' } });
  }, { text, start });
  await emit('```pi-html\n<button>partial', true);
  const streaming = page.locator('.interactive-preview').last();
  await streaming.getByRole('img', { name: 'Generating preview' }).waitFor();
  assert.equal(await streaming.locator('pre, iframe').count(), 0);
  assert.ok((await streaming.boundingBox()).height < 80, 'Streaming starts folded');
  await streaming.screenshot({ path: join(artifacts, `interactive-preview-streaming-${width}.png`) });
  await streaming.getByRole('button', { name: 'Source', exact: true }).click();
  await streaming.locator('pre').waitFor();
  await emit('```pi-html\n<button>partial update</button>');
  await streaming.locator('pre').getByText('partial update', { exact: false }).waitFor();
  await streaming.getByRole('button', { name: 'Collapse source', exact: true }).click();
  assert.equal(await streaming.locator('pre').count(), 0);
  await emit('```pi-html\n<button>finished</button>\n```');
  assert.equal(await streaming.locator('iframe').count(), 0, 'Closed fence does not execute while streaming');
  await page.evaluate(() => window.__previewEventSource.emit({ type: 'message_end', message: {
    role: 'assistant', content: [{ type: 'text', text: '```pi-html\n<button>finished</button>\n```' }],
    provider: 'test', model: 'test', stopReason: 'stop', timestamp: Date.now(),
  } }));
  await page.locator('.interactive-preview').last().frameLocator('iframe').getByRole('button', { name: 'finished' }).waitFor();
  console.log('PASS: streaming starts folded, source choice survives deltas, completion opens preview');
}
