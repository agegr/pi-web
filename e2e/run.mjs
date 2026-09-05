// Adapted from @Nuctori's script-style CI/E2E fixtures in PR #617 (issue #599).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { checkExtensionDialogs, extensionSource } from "./extension-dialog.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.env.E2E_SERVER_MODE || "dev";
assert.ok(mode === "dev" || mode === "start", "E2E_SERVER_MODE must be dev or start");
assert.ok(mode !== "dev" || !existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-e2e-"));
const project = join(agentDir, "project");
const sessionDir = join(agentDir, "sessions", "e2e");
mkdirSync(project);
mkdirSync(sessionDir, { recursive: true });
const timestamp = "2026-08-23T00:00:00.000Z";
const LONG = "e2e-long-session";
const BRANCH = "e2e-branch-session";
const RICH = "e2e-rich-session";
const COMPACTED = "e2e-compacted-session";
const text = (i) => `E2E message ${String(i).padStart(4, "0")}`;
const ids = (start, end) => Array.from({ length: end - start }, (_, i) => `e${start + i}`);

function message(id, parentId, role, content) {
  return { type: "message", id, parentId, timestamp, message: { role, content } };
}

function writeSession(id, entries) {
  const header = { type: "session", version: 3, id, timestamp, cwd: project };
  writeFileSync(join(sessionDir, `2026-08-23T00-00-00-000Z_${id}.jsonl`),
    [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}

let server;
let serverExited;
let browser;
let page;
let context;
let serverError;
const serverLog = createWriteStream(join(artifacts, "server.log"));
const interrupt = () => {
  process.exitCode = 1;
  server?.kill("SIGTERM");
  void browser?.close().catch(() => {});
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

try {
  // Seed before startup so the first catalogue scan sees every fixture.
  mkdirSync(join(agentDir, "extensions"));
  writeFileSync(join(agentDir, "extensions", "e2e-dialog.js"), extensionSource);
  writeSession(LONG, Array.from({ length: 5000 }, (_, i) =>
    message(`e${i}`, i ? `e${i - 1}` : null, i % 2 ? "assistant" : "user", text(i))));
  writeSession(BRANCH, [
    message("root", null, "user", "Branch root"),
    message("old", "root", "assistant", "Inactive branch answer"),
    message("new", "root", "assistant", "Active branch answer"),
  ]);
  const toolResult = message("result", "call", "toolResult", [{ type: "text", text: "E2E tool output" }]);
  Object.assign(toolResult.message, { toolCallId: "t1", toolName: "bash", isError: false });
  const richEntries = [
    message("user", null, "user", "Render **E2E markdown**"),
    message("call", "user", "assistant", [
      { type: "thinking", thinking: "" },
      { type: "thinking", thinking: "E2E intermediate reasoning\nIntermediate thinking details." },
      { type: "toolCall", id: "t1", name: "bash", arguments: { command: "echo E2E tool output" } },
    ]),
    toolResult,
    message("answer", "result", "assistant", [
      { type: "thinking", thinking: "" },
      { type: "thinking", thinking: "E2E follow-up reasoning\nFollow-up thinking details." },
      { type: "text", text: "E2E process note" },
      { type: "thinking", thinking: "E2E final reasoning\nFinal thinking details." },
      { type: "text", text: "E2E final answer\n```js\nconsole.log('E2E code');\n```" },
    ]),
  ];
  Object.assign(richEntries.at(-1).message, { provider: "test", model: "E2E Model" });
  writeSession(RICH, richEntries);
  // The default 50-entry page starts at compaction, with its user prompt outside it.
  const compactedEntries = [
    message("user", null, "user", "E2E prompt outside the compacted page"),
    { type: "compaction", id: "compact", parentId: "user", timestamp, summary: "E2E compaction anchor", firstKeptEntryId: "user", tokensBefore: 100 },
  ];
  for (let i = 0; i < 24; i++) {
    compactedEntries.push(message(`call${i}`, compactedEntries.at(-1).id, "assistant", [
      { type: "toolCall", id: `t${i}`, name: "bash", arguments: { command: `echo step${i}` } },
    ]));
    const result = message(`result${i}`, `call${i}`, "toolResult", [{ type: "text", text: `step${i}` }]);
    Object.assign(result.message, { toolCallId: `t${i}`, toolName: "bash", isError: false });
    compactedEntries.push(result);
  }
  compactedEntries.push(message("answer", "result23", "assistant", [{ type: "text", text:
    "E2E compacted answer paragraph.\n\n".repeat(20)
    + "## E2E compacted heading\n\n"
    + "E2E compacted answer paragraph.\n\n".repeat(20),
  }]));
  writeSession(COMPACTED, compactedEntries);

  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), mode, "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.once("error", (error) => { serverError = error; });
  serverExited = once(server, "exit");
  server.stdout.pipe(serverLog, { end: false });
  server.stderr.pipe(serverLog, { end: false });

  async function api(path, status = 200) {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, status, path);
    return response.json();
  }

  const deadline = Date.now() + 120_000;
  while (true) {
    if (serverError) throw serverError;
    assert.equal(server.exitCode, null, "Server exited before readiness; see server.log");
    const response = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) {
      const { sessions } = await response.json();
      assert.deepEqual(sessions.map((session) => session.id).sort(), [LONG, BRANCH, RICH, COMPACTED].sort());
      break;
    }
    assert.ok(Date.now() < deadline, "Server readiness timed out; see server.log");
    await delay(250);
  }

  const detail = await api(`/api/sessions/${LONG}?deferThinking=1&deferMedia=1`);
  assert.deepEqual(detail.context.entryIds, ids(4950, 5000));
  assert.equal(detail.context.messages.length, 50);
  assert.equal(detail.context.hasMore, true);
  assert.ok(JSON.stringify(detail).length < 100_000, "Detail transferred unbounded history");
  const tail = await api(`/api/sessions/${LONG}/context?tail=50`);
  assert.deepEqual(tail.context.entryIds, ids(4950, 5000));
  assert.equal(tail.context.messages.length, 50);
  const selectedBranch = await api(`/api/sessions/${BRANCH}/context?leafId=old`);
  assert.deepEqual(selectedBranch.context.entryIds, ["root", "old"]);
  const rootPage = await api(`/api/sessions/${BRANCH}/context?before=old&tail=1`);
  assert.deepEqual(rootPage.context.entryIds, ["root"]);
  assert.equal(rootPage.context.hasMore, false);
  const beforeRoot = await api(`/api/sessions/${BRANCH}/context?before=root`);
  assert.deepEqual(beforeRoot.context.entryIds, []);
  assert.equal(beforeRoot.context.hasMore, false);
  await api("/api/sessions/e2e-does-not-exist", 404);
  await api("/api/files/..%2F..%2Fetc%2Fpasswd?type=read", 403);
  const compacted = await api(`/api/sessions/${COMPACTED}`);
  assert.equal(compacted.context.entryIds[0], "compact");
  assert.equal(compacted.context.messages.some((entry) => entry.role === "user"), false);
  console.log("PASS: bounded history, branch context, pagination root, and API errors");

  browser = await chromium.launch();
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    context = await browser.newContext({ viewport, locale: "en-US" });
    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    const olderResponses = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (event) => { if (event.type() === "error") errors.push(event.text()); });
    page.on("response", (response) => {
      if (response.url().startsWith(base) && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
      const url = new URL(response.url());
      if (url.pathname === `/api/sessions/${LONG}/context` && url.searchParams.has("before")) olderResponses.push(response);
    });
    const stateReady = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/sessions/${LONG}/state`);
    await page.goto(`${base}/?session=${LONG}`, { waitUntil: "domcontentloaded" });
    assert.equal((await stateReady).status(), 200);
    await page.getByText(text(4999), { exact: true }).waitFor();
    const latestUser = await page.getByText(text(4998), { exact: true }).elementHandle();
    assert.ok(latestUser, "Latest user message must be mounted before pagination");
    const sentinel = page.getByText("Scroll up to load earlier messages", { exact: true });
    await sentinel.waitFor({ state: "attached" });
    assert.equal(await page.getByText(text(4949), { exact: true }).count(), 0);

    // Exercise the real IntersectionObserver and prepend path, twice.
    for (let turn = 0; turn < 2; turn++) {
      const responsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/sessions/${LONG}/context`);
      await sentinel.evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
      const response = await responsePromise;
      const older = (await response.json()).context;
      const firstMessage = older.messages[0]?.content;
      assert.equal(typeof firstMessage, "string", "Older page must contain user messages");
      await page.getByText(firstMessage, { exact: true }).waitFor({ state: "attached" });
      await page.getByText(text(4999), { exact: true }).evaluate((element) => element.scrollIntoView({ block: "end", behavior: "instant" }));
    }
    assert.deepEqual(await latestUser.evaluate((element) => ({
      connected: element.isConnected,
      text: element.textContent,
    })), { connected: true, text: text(4998) }, "Prepending history must preserve existing message nodes");
    await latestUser.dispose();
    assert.ok(olderResponses.length >= 2, "Scrolling must fetch consecutive older pages");
    let oldest = 4950;
    for (const response of olderResponses) {
      assert.equal(response.status(), 200);
      assert.equal(new URL(response.url()).searchParams.get("before"), `e${oldest}`);
      const older = (await response.json()).context;
      assert.deepEqual(older.entryIds, ids(oldest - 50, oldest));
      assert.equal(older.messages.length, 50);
      oldest -= 50;
      assert.equal(older.oldestEntryId, `e${oldest}`);
      assert.equal(older.hasMore, true);
    }
    const rendered = await page.getByText(/^E2E message \d{4}$/).allTextContents();
    // The sidebar also displays the first message as the session title.
    assert.deepEqual(rendered.filter((value) => value !== text(0)),
      Array.from({ length: 5000 - oldest }, (_, i) => text(oldest + i)), "Missing, reordered, or duplicate chat messages");
    await page.screenshot({ path: join(artifacts, `history-${viewport.width}.png`) });

    await page.goto(`${base}/?session=${BRANCH}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Active branch answer", { exact: true }).waitFor();
    assert.equal(await page.getByText("Inactive branch answer", { exact: true }).count(), 0);
    const thinkingRequests = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/thinking")) thinkingRequests.push(request.url());
    });
    await page.goto(`${base}/?session=${RICH}`, { waitUntil: "domcontentloaded" });
    await page.locator("strong").filter({ hasText: "E2E markdown" }).waitFor();
    await page.locator("pre").filter({ hasText: "console.log('E2E code');" }).waitFor();
    await page.getByText("E2E final answer", { exact: true }).waitFor();
    const processDetails = page.getByRole("button", { name: /^Process details/ });
    const thinking = page.getByRole("button", { name: /^Thinking/ });
    assert.equal(await processDetails.count(), 1);
    assert.equal(await thinking.count(), 0, "All thinking stays inside process details");
    const finalMessage = page.locator("[data-entry-id='answer']");
    assert.equal(await finalMessage.getByRole("button", { name: /^Thinking/ }).count(), 0);
    assert.equal(await finalMessage.getByText("E2E Model", { exact: true }).count(), 1);
    assert.equal(thinkingRequests.length, 0);
    await processDetails.click();
    assert.equal(await thinking.count(), 3);
    assert.equal(await thinking.last().innerText(), "E2E final reasoning");
    assert.equal(thinkingRequests.length, 0);
    for (const [index, text] of ["Intermediate thinking details.", "Follow-up thinking details.", "Final thinking details."].entries()) {
      await thinking.nth(index).click();
      await page.getByText(text, { exact: false }).waitFor();
    }
    assert.equal(thinkingRequests.length, 3);
    const processText = await processDetails.locator("..").innerText();
    assert.ok(processText.indexOf("E2E intermediate reasoning") < processText.indexOf("echo E2E tool output"));
    assert.ok(processText.indexOf("echo E2E tool output") < processText.indexOf("E2E follow-up reasoning"));
    assert.ok(processText.indexOf("E2E follow-up reasoning") < processText.indexOf("E2E process note"));
    assert.ok(processText.indexOf("E2E process note") < processText.indexOf("E2E final reasoning"));
    assert.equal(processText.split("E2E final reasoning").length - 1, 1);
    assert.ok(!(await finalMessage.last().innerText()).includes("E2E final reasoning"));
    await page.getByText("echo E2E tool output", { exact: true }).waitFor();
    await page.getByRole("button", { name: /bash.*echo E2E tool output/ }).click();
    await page.getByText("E2E tool output", { exact: true }).waitFor();
    await page.goto(`${base}/?session=${COMPACTED}`, { waitUntil: "domcontentloaded" });
    const heading = page.getByRole("heading", { name: "E2E compacted heading", exact: true });
    await heading.waitFor({ state: "attached" });
    if (viewport.width > 600) {
      const node = page.locator("[data-minimap-node-index='0']");
      await node.waitFor();
      const rect = await node.boundingBox();
      assert.ok(rect);
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const preview = page.locator("[data-minimap-preview-box]");
      await preview.getByRole("button", { name: "E2E compaction anchor", exact: true }).waitFor();
      await preview.getByRole("button", { name: "E2E compacted heading", exact: true }).click();
      await page.waitForFunction(() => {
        const heading = document.querySelector("[data-entry-id='answer'] h2");
        const scroll = heading?.closest(".overflow-y-auto");
        return heading && scroll && Math.abs(heading.getBoundingClientRect().top
          - scroll.getBoundingClientRect().top - scroll.clientHeight * 0.3) < 5;
      });
      await page.screenshot({ path: join(artifacts, "compaction-minimap.png") });
    }
    await checkExtensionDialogs(page, artifacts, viewport.width);
    assert.deepEqual(errors, [], `Browser errors at width ${viewport.width}`);
    console.log(`PASS: ${viewport.width}px browser pagination, branch, markdown, code, tool call, and compaction navigation`);
    await context.tracing.stop();
    await context.close();
    context = undefined;
    page = undefined;
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  if (page) await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  if (context) await context.tracing.stop({ path: join(artifacts, "trace.zip") }).catch(() => {});
} finally {
  await browser?.close().catch(() => {});
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    const forceKill = setTimeout(() => server.kill("SIGKILL"), 10_000);
    await serverExited;
    clearTimeout(forceKill);
  }
  serverLog.end();
  rmSync(agentDir, { recursive: true, force: true });
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
