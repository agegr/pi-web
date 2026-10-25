// Standalone Chromium regression: node e2e/usage-notice.mjs
// Like run.mjs, owns one loopback next dev and an entirely synthetic agent dir.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const lockPath = join(root, ".next/dev/lock");
assert.ok(!existsSync(lockPath), "Use this worktree without another next dev instance");
const agentRules = readFileSync(join(root, "AGENTS.md"), "utf8");
for (const file of [".env", ".env.local", ".env.development", ".env.development.local"]) {
  assert.ok(!existsSync(join(root, file)), `Refusing to load potentially real credentials from ${file}`);
}
const artifacts = join(root, "test-results/usage-notice");
mkdirSync(artifacts, { recursive: true });
const runLog = createWriteStream(join(artifacts, "run.log"));
const serverLog = createWriteStream(join(artifacts, "server.log"));
const report = (text) => { console.log(text); runLog.write(`${text}\n`); };
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-usage-notice-"));
const project = join(agentDir, "project");
const sessionDir = join(agentDir, "sessions", "usage-notice");
mkdirSync(project);
mkdirSync(sessionDir, { recursive: true });
const epoch = Date.parse("2026-10-25T00:00:00.000Z");
const usage = (input, output, cacheRead = 0, cacheWrite = 0, total = 0) => ({
  input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
});
const text = (value) => ({ type: "text", text: value });
function message(id, parentId, role, content, ms, extra = {}) {
  return { type: "message", id, parentId, timestamp: new Date(epoch + ms).toISOString(),
    message: { role, content: typeof content === "string" ? [text(content)] : content, timestamp: epoch + ms, ...extra } };
}
function assistant(id, parent, content, ms, counts, durationMs, stopReason = "stop") {
  return message(id, parent, "assistant", content, ms, {
    api: "openai-completions", provider: "test", model: "usage-fixture", stopReason,
    ...(counts ? { usage: counts } : {}), ...(durationMs !== undefined ? { durationMs } : {}),
  });
}
function result(id, parent, callId, ms) {
  return message(id, parent, "toolResult", `Synthetic ${callId} result`, ms,
    { toolCallId: callId, toolName: "bash", isError: false });
}
const call = (id) => ({ type: "toolCall", id, name: "bash", arguments: { command: "echo synthetic-only-not-executed" } });
const fixtures = new Map();
function session(id, entries) {
  const path = join(sessionDir, `2026-10-25T00-00-00-000Z_${id}.jsonl`);
  const source = [{ type: "session", version: 3, id, timestamp: new Date(epoch).toISOString(), cwd: project }, ...entries]
    .map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  writeFileSync(path, source);
  fixtures.set(id, { path, source });
}
const TURN = "usage-notice-turn";
session(TURN, [
  message("user", null, "user", "Usage whole-turn fixture", 0),
  assistant("first", "user", [text("First process response"), call("t1")], 1_000, usage(1_234, 100, 2_000, 10, 0.0011), 2_000, "toolUse"),
  result("tool1", "first", "t1", 3_500),
  assistant("second", "tool1", [text("Second process response"), call("t2")], 4_000, usage(2_766, 200, 300, 20, 0.0022), 1_000, "toolUse"),
  result("tool2", "second", "t2", 5_500),
  // The last response is split into process + answer display copies. Its usage
  // must be counted once, and the process copy must not duplicate its footer.
  assistant("answer", "tool2", [
    { type: "thinking", thinking: "Synthetic reasoning before the answer" },
    text("Final-response process preface"),
    { type: "thinking", thinking: "Synthetic final reasoning" },
    text("Usage whole-turn final answer"),
  ], 6_000, usage(1_000_000, 300, 0, 30, 0.0033), 3_000),
]);
for (const [id, counts, durationMs] of [
  ["usage-notice-old", usage(1_500, 1_000_000, 2_000_000), undefined],
  ["usage-notice-zero", usage(0, 0), 0],
  ["usage-notice-zero-output", usage(999, 0), 2_000],
  ["usage-notice-rounding", usage(999_950, 1_050, 1_999_950, 0, 0.000012345), 1_000],
  ["usage-notice-no-usage", undefined, undefined],
]) {
  session(id, [message("user", null, "user", id, 0), assistant("answer", "user", `${id} answer`, 0, counts, durationMs)]);
}

let server, serverExited, browser, context, page, serverError;
const interrupt = () => { process.exitCode = 1; server?.kill("SIGTERM"); void browser?.close().catch(() => {}); };
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
const errors = [];
const forbidden = [];
const requests = [];
const commands = new Set(["prompt", "steer", "follow_up", "fork", "fork_branch", "clone", "new_session"]);
const footer = (id = "answer") => page.locator(`[data-entry-id="${id}"] .message-usage`);
function expectedDetails(original, startMs, durationMs, stopReason = "stop") {
  const lines = original.split("\n");
  const costIndex = lines.findIndex((line) => line.startsWith("Cost: "));
  lines.splice(costIndex + 1, 0, "Input cost: $0", "Output cost: $0", "Cache Read cost: $0", "Cache Write cost: $0");
  if (original.startsWith("Turn usage")) return lines.join("\n");
  lines.push("Model: usage-fixture", "Provider: test");
  const time = (ms) => new Date(epoch + ms).toLocaleString("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "short", timeZone: "UTC",
  });
  lines.push(`Request started: ${time(startMs)}`);
  if (durationMs !== undefined) {
    lines.push(`Response completed: ${time(startMs + durationMs)}`);
  }
  lines.push(`Stop reason: ${stopReason}`);
  return lines.join("\n");
}
const turnDetails = expectedDetails("Turn usage\nInput: 1,004,000\nOutput: 600\nCache Read: 2,300\nCache Write: 60\nTotal: 1,006,960\nCost: $0.0066\nElapsed time: 9s\nAverage output speed: 66.7 t/s", 6_000, 3_000);
const firstDetails = expectedDetails("Response usage\nInput: 1,234\nOutput: 100\nCache Read: 2,000\nCache Write: 10\nTotal: 3,344\nCost: $0.0011\nElapsed time: 2s\nAverage output speed: 50.0 t/s", 1_000, 2_000, "toolUse");
const secondDetails = expectedDetails("Response usage\nInput: 2,766\nOutput: 200\nCache Read: 300\nCache Write: 20\nTotal: 3,286\nCost: $0.0022\nElapsed time: 1s\nAverage output speed: 200.0 t/s", 4_000, 1_000, "toolUse");
async function open(id) {
  await page.goto(`${base}/?session=${id}`, { waitUntil: "domcontentloaded" });
  await page.getByText(id === TURN ? "Usage whole-turn final answer" : `${id} answer`, { exact: true }).waitFor();
}
async function exactToast(button, expected, keyboard = false) {
  await button.scrollIntoViewIfNeeded();
  assert.equal(await button.getAttribute("title"), expected, "full exact accessible tooltip");
  assert.equal(await button.getAttribute("aria-label"), `Show exact usage\n${expected}`);
  const previous = await page.locator('.notice-shelf-item > span[tabindex="0"]').count();
  if (keyboard) { await button.focus(); await page.keyboard.press("Enter"); } else await button.click();
  await page.waitForFunction(({ expectedText, previousCount }) => {
    const nodes = [...document.querySelectorAll('.notice-shelf-item > span[tabindex="0"]')];
    return nodes.length > previousCount && nodes.some((node) => node.textContent === expectedText);
  }, { expectedText: expected, previousCount: previous });
  const toast = page.locator('.notice-shelf-item > span[tabindex="0"]').filter({ hasText: expected }).last();
  assert.equal(await toast.textContent(), expected, "actual addNotice toast is exact, not abbreviated");
  await toast.focus(); // Pause the existing notice expiry while checking/screenshotting it.
  await page.waitForTimeout(220); // Existing toast entrance animation.
  assert.deepEqual(errors, [], "no browser errors, including repeated notice React keys");
  const bounds = await toast.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1, "toast fits viewport horizontally");
  assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= viewport.height + 1, "toast fits viewport vertically");
}
async function assertParts(button, expected) {
  await button.waitFor();
  const parts = await button.locator(":scope > span[title]").allTextContents();
  assert.deepEqual(parts.map((part) => part.trim()), expected, "compact input/output/cache counts");
  assert.doesNotMatch(await button.textContent(), /\d+\.0[KM]\b/, "no redundant .0 in K/M counts");
  await button.scrollIntoViewIfNeeded();
  const bounds = await button.boundingBox();
  assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= page.viewportSize().width + 1, "footer fits viewport");
}
async function assertArrows(button) {
  for (const [label, from, to, points] of [
    ["Input", "8.5", "1.5", "2 4 5 1.5 8 4"],
    ["Output", "1.5", "8.5", "2 6 5 8.5 8 6"],
  ]) {
    const svg = button.locator(`span[title="${label}"] svg`);
    assert.equal(await svg.locator("line").getAttribute("y1"), from, `${label} arrow origin`);
    assert.equal(await svg.locator("line").getAttribute("y2"), to, `${label} arrow direction`);
    assert.equal(await svg.locator("polyline").getAttribute("points"), points, `${label} arrowhead`);
  }
}
let base;
try {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  base = `http://127.0.0.1:${port}`;
  report(`Starting owned next dev in ${root} at ${base}; synthetic PI_CODING_AGENT_DIR=${agentDir}`);
  // Worktrees share node_modules by symlink. Turbopack's default filesystem
  // root rejects an external target. Widen only that in-memory dev option;
  // do not rewrite next.config.ts or the dependency symlink. The preload is
  // inherited by Next's worker, and removed with the synthetic agent dir.
  let filesystemRoot = root;
  const dependencyRoot = realpathSync(join(root, "node_modules"));
  while (relative(filesystemRoot, dependencyRoot).startsWith("..")) filesystemRoot = dirname(filesystemRoot);
  const preload = join(agentDir, "next-worktree.cjs");
  writeFileSync(preload, `
const Module = require('node:module');
const load = Module._load;
const target = ${JSON.stringify(realpathSync(join(root, "node_modules/next/dist/server/config.js")))};
Module._load = function(request, parent, isMain) {
  const value = load.apply(this, arguments);
  if (Module._resolveFilename(request, parent) !== target) return value;
  return new Proxy(value, { get(object, key) {
    if (key !== 'default') return Reflect.get(object, key);
    return async (...args) => {
      const config = await object.default(...args);
      config.turbopack = { ...config.turbopack, root: ${JSON.stringify(filesystemRoot)} };
      return config;
    };
  }});
};
`);
  report(`Temporary Turbopack filesystem root: ${filesystemRoot}`);
  // Do not pass provider credentials, Pi agent markers or a real HOME to Next.
  server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: agentDir, TMPDIR: tmpdir(), LANG: "C.UTF-8", CI: "1",
      PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: `--require=${preload}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.once("error", (error) => { serverError = error; });
  serverExited = once(server, "exit");
  server.stdout.pipe(serverLog, { end: false });
  server.stderr.pipe(serverLog, { end: false });
  const deadline = Date.now() + 120_000;
  while (true) {
    if (serverError) throw serverError;
    assert.equal(server.exitCode, null, "Server exited before readiness; see server.log");
    const response = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(5_000) }).catch(() => null);
    if (response?.ok) {
      assert.deepEqual((await response.json()).sessions.map((item) => item.id).sort(), [...fixtures.keys()].sort(), "only synthetic sessions are visible");
      break;
    }
    assert.ok(Date.now() < deadline, "Server readiness timeout; see server.log");
    await delay(250);
  }
  const detail = await (await fetch(`${base}/api/sessions/${TURN}`)).json();
  const answer = detail.context.messages.find((item) => item.role === "assistant" && item.stopReason === "stop");
  assert.equal(answer.durationMs, 3_000, "duration survives real session-reader/API");
  report("PASS: isolated fixture API, three original model responses, persisted durationMs");
  browser = await chromium.launch();
  report(`Chromium ${browser.version()}`);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    context = await browser.newContext({ viewport, locale: "en-US", timezoneId: "UTC" });
    await context.tracing.start({ screenshots: true, snapshots: true });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      requests.push(`${request.method()} ${url.pathname}`);
      const type = request.method() === "POST" && /^\/api\/agent\/[^/]+$/.test(url.pathname) ? request.postDataJSON()?.type : undefined;
      if (url.pathname === "/api/agent/new" || /\/fork$/.test(url.pathname) || commands.has(type)) {
        forbidden.push(`${request.method()} ${url.pathname} ${type ?? ""}`);
        return route.abort();
      }
      return route.continue();
    });
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (event) => { if (event.type() === "error") errors.push(event.text()); });
    page.on("response", (response) => { if (response.url().startsWith(base) && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
    await open(TURN);
    await assertParts(footer(), ["1M", "600", "2.3K", "60", "66.7 t/s"]);
    await assertArrows(footer());
    await exactToast(footer(), turnDetails);
    await page.screenshot({ path: join(artifacts, `${viewport.width}-turn-click.png`) });
    // Rapid reopening specifically catches a constant notice ID / duplicate
    // React keys. The existing notice shelf legitimately stacks unique cards.
    await exactToast(footer(), turnDetails, true);
    await page.screenshot({ path: join(artifacts, `${viewport.width}-turn-enter.png`) });
    // Reset the shelf between scopes; its generic five-card stacking policy is
    // not this regression's target, especially in the 375px viewport.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTitle("Expand process details", { exact: true }).click();
    await assertParts(footer("first"), ["1.2K", "100", "2K", "10", "50.0 t/s"]);
    await exactToast(footer("first"), firstDetails, true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTitle("Expand process details", { exact: true }).click();
    await exactToast(footer("second"), secondDetails);
    assert.equal(await footer().count(), 1, "split final-response process copy must not repeat its usage footer");
    await page.reload({ waitUntil: "domcontentloaded" });
    await footer().waitFor();
    await exactToast(footer(), turnDetails, true);
    await assertParts(footer(), ["1M", "600", "2.3K", "60", "66.7 t/s"]);
    report(`PASS ${viewport.width}px: click + Enter exact toasts; response vs whole-turn sum/time/rate; no duplicated final usage; reload preserves 66.7 t/s; input ↑ output ↓`);

    await open("usage-notice-old");
    await assertParts(footer(), ["1.5K", "1M", "2M"]);
    assert.doesNotMatch(await footer().textContent(), /t\/s|took|NaN|Infinity/);
    await exactToast(footer(), expectedDetails("Turn usage\nInput: 1,500\nOutput: 1,000,000\nCache Read: 2,000,000\nTotal: 3,001,500\nCost: $0", 0, undefined), true);
    await page.screenshot({ path: join(artifacts, `${viewport.width}-legacy.png`) });
    await open("usage-notice-zero");
    await assertParts(footer(), []);
    assert.equal((await footer().textContent()).trim(), "took 0s");
    await exactToast(footer(), expectedDetails("Turn usage\nInput: 0\nOutput: 0\nTotal: 0\nCost: $0\nElapsed time: 0s", 0, 0));
    await open("usage-notice-zero-output");
    await assertParts(footer(), ["999", "0.0 t/s"]);
    await exactToast(footer(), expectedDetails("Turn usage\nInput: 999\nOutput: 0\nTotal: 999\nCost: $0\nElapsed time: 2s\nAverage output speed: 0.0 t/s", 0, 2_000), true);
    await open("usage-notice-rounding");
    await assertParts(footer(), ["1M", "1.1K", "2M", "1050.0 t/s"]);
    await exactToast(footer(), expectedDetails("Turn usage\nInput: 999,950\nOutput: 1,050\nCache Read: 1,999,950\nTotal: 3,000,950\nCost: $0\nElapsed time: 1s\nAverage output speed: 1050.0 t/s", 0, 1_000));
    await open("usage-notice-no-usage");
    assert.equal(await page.locator(".message-usage").count(), 0, "old messages with neither usage nor duration do not invent metadata");
    assert.deepEqual(errors, [], `browser errors at ${viewport.width}px`);
    report(`PASS ${viewport.width}px: K/M rounding/no .0; zero tokens + zero duration; zero output rate; legacy missing duration/rate; missing usage`);
    await context.tracing.stop({ path: join(artifacts, `${viewport.width}-trace.zip`) });
    await context.close();
    context = page = undefined;
  }
  assert.deepEqual(forbidden, [], "no prompts, real model requests, forks or new sessions");
  const sessions = await (await fetch(`${base}/api/sessions`)).json();
  assert.deepEqual(sessions.sessions.map((item) => item.id).sort(), [...fixtures.keys()].sort());
  for (const { path, source } of fixtures.values()) {
    const after = readFileSync(path, "utf8");
    assert.ok(after.startsWith(source), "original synthetic transcript remains unchanged");
    // Merely opening a session can resume its wrapper and append SDK settings
    // metadata. It must never append user/assistant/tool messages or a run.
    const appended = after.slice(source.length).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    assert.ok(appended.every((entry) => ["thinking_level_change", "model_change"].includes(entry.type)), "only wrapper settings metadata may be appended");
  }
  report("PASS: no browser errors/model prompts, no extra sessions; original synthetic messages unchanged (SDK settings metadata permitted)");
} catch (error) {
  console.error(error);
  runLog.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
  if (page) await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  if (context) await context.tracing.stop({ path: join(artifacts, "failure-trace.zip") }).catch(() => {});
} finally {
  writeFileSync(join(artifacts, "requests.json"), JSON.stringify({ requests, forbidden, errors }, null, 2));
  await browser?.close().catch(() => {});
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    const forceKill = setTimeout(() => server.kill("SIGKILL"), 10_000);
    await serverExited;
    clearTimeout(forceKill);
  }
  // This Next version can leave its metadata file after a graceful exit.
  // Remove only this run's lock after verifying its recorded process is dead.
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    if (lock.appUrl === base) {
      const alive = () => { try { process.kill(lock.pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } };
      for (let retry = 0; retry < 50 && alive(); retry++) await delay(100);
      if (!alive()) rmSync(lockPath);
      else { process.exitCode = 1; report(`ERROR: owned Next worker ${lock.pid} did not stop; lock preserved.`); }
    }
  }
  if (readFileSync(join(root, "AGENTS.md"), "utf8") !== agentRules) {
    process.exitCode = 1;
    report("ERROR: Next changed AGENTS.md; generated change preserved for the owner to inspect.");
  }
  rmSync(agentDir, { recursive: true, force: true });
  report(`Cleanup: owned server stopped; synthetic agent directory removed (${!existsSync(agentDir)}).`);
  serverLog.end();
  runLog.end();
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
