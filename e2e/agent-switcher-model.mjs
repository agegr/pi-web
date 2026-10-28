// Isolated browser regression: real session files, stats API and Agents panel;
// no prompts, model calls, or changes to the user's sessions.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-agent-model-"));
const project = join(agentDir, "project");
const sessionsDir = join(agentDir, "sessions", "e2e");
mkdirSync(project);
mkdirSync(sessionsDir, { recursive: true });
const timestamp = "2026-10-01T00:00:00.000Z";
const mainId = "e2e-agent-model-main";
const pathFor = (id) => join(sessionsDir, `${id}.jsonl`);
const originals = new Map();
const children = [
  { id: "high", model: "gpt-6.1-sol", thinking: "high" },
  { id: "off", model: "gpt-6-luna", thinking: "off" },
  { id: "legacy", model: "legacy-model", legacy: true },
  { id: "unknown" },
  { id: "long", model: `long-model-${"identifier-".repeat(30)}`, thinking: "xhigh" },
];

function seed(id, config = {}) {
  const lines = [{ type: "session", version: 3, id, timestamp, cwd: project,
    ...(id !== mainId ? { parentSession: pathFor(mainId) } : {}),
  }];
  let parentId = null;
  const append = (type, fields) => {
    const entry = { type, id: `${id}-${lines.length}`, parentId, timestamp, ...fields };
    lines.push(entry);
    parentId = entry.id;
  };
  if (id !== mainId) append("custom", { customType: "pi-web:subagent", data: {
    version: 1, parentSessionId: mainId, parentSessionPath: pathFor(mainId),
    profile: "tsgw-general", description: `E2E ${config.id}`, createdAt: timestamp,
  } });
  if (config.model && !config.legacy) append("model_change", { provider: "tsgw", modelId: config.model });
  if (config.thinking) append("thinking_level_change", { thinkingLevel: config.thinking });
  append("message", { message: { role: "user", content: id === mainId ? "E2E main task" : `E2E ${config.id}` } });
  append("message", { message: {
    role: "assistant", content: [{ type: "text", text: "Finished" }],
    ...(config.model ? { model: config.model, provider: "tsgw" } : {}),
    timestamp: Date.parse(timestamp), durationMs: 1000,
    usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } },
  } });
  if (id !== mainId) append("custom", { customType: "pi-web:subagent-result", data: { version: 1, status: "completed", completedAt: timestamp } });
  const text = `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
  writeFileSync(pathFor(id), text);
  originals.set(id, text);
}
seed(mainId, { model: "main-model", thinking: "high" });
for (const config of children) seed(`e2e-agent-model-${config.id}`, config);

let server, serverExited, browser, page, serverError;
const serverLog = createWriteStream(join(artifacts, "agent-switcher-model-server.log"));
try {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.once("error", (error) => { serverError = error; });
  serverExited = once(server, "exit");
  server.stdout.pipe(serverLog, { end: false });
  server.stderr.pipe(serverLog, { end: false });
  const deadline = Date.now() + 120_000;
  while (true) {
    if (serverError) throw serverError;
    assert.equal(server.exitCode, null, "server exited before readiness; see server log");
    const response = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) {
      const { sessions } = await response.json();
      assert.equal(sessions.length, children.length + 1);
      assert.equal(sessions.filter((session) => session.relation?.kind === "subagent").length, children.length);
      break;
    }
    assert.ok(Date.now() < deadline, "server readiness timed out");
    await delay(250);
  }
  browser = await chromium.launch({ args: process.getuid?.() === 0 ? ["--no-sandbox"] : [] });
  for (const [width, locale] of [[1280, "en"], [390, "en"], [320, "en"], [390, "zh-CN"]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "en-US" });
    await context.addInitScript((value) => localStorage.setItem("pi-locale", value), locale);
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    const forbidden = [];
    const statsRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Keep selected-session initialization read-only too. The session list,
    // context, stats and subagent viewer still use the real backend.
    await page.route((url) => url.pathname.startsWith("/api/agent/"), async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === "/api/agent/running") return route.fulfill({ json: { runningSessionIds: [], awaitingInputSessionIds: [] } });
      if (pathname.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"connected","isStreaming":false}\n\n' });
      if (pathname.endsWith("/lease")) return route.fulfill({ json: { running: false, awaitingInput: false, subagentsActive: false } });
      if (route.request().method() !== "GET") forbidden.push(pathname);
      return route.fulfill({ json: { isStreaming: false, isCompacting: false } });
    });
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/sessions/stats") statsRequests.push(request);
    });
    await page.goto(`${base}/?session=${mainId}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Finished", { exact: true }).waitFor();
    if (width < 600) await page.locator("[data-mobile-toolbar-more]").click();
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    const panel = page.getByRole("listbox", { name: "Agents", exact: true });
    const row = (name) => panel.getByRole("option").filter({ hasText: `E2E ${name}` });
    await row("high").getByText("gpt-6.1-sol", { exact: true }).waitFor();
    assert.equal(await panel.getByRole("option").count(), children.length + 1);
    // Strict Mode remounts the effect once in dev (aborting its first fetch).
    assert.ok(statsRequests.length >= 1 && statsRequests.length <= 2, "one family batch per mount, not one request per row");
    for (const request of statsRequests) assert.deepEqual(JSON.parse(request.postData()).ids.sort(), [...originals.keys()].sort());
    for (const config of children) {
      const option = row(config.id);
      const body = option.locator(":scope > span").nth(1);
      const lines = body.locator(":scope > span");
      assert.equal(await lines.count(), 3, `${config.id}: only title, metadata and usage`);
      const metadata = lines.nth(1);
      assert.equal(await metadata.evaluate((el) => getComputedStyle(el).whiteSpace), "nowrap");
      assert.equal(await metadata.getByText("tsgw-general", { exact: true }).count(), 1);
      const title = await metadata.getAttribute("title");
      assert.ok(title.includes("tsgw-general · ") && title.includes(locale === "en" ? "ago" : "前"), "relative time stays in tooltip");
      if (config.model) {
        assert.ok(title.includes(`tsgw/${config.model}`), "tooltip retains full provider/model id");
        await metadata.getByText(config.model, { exact: true }).waitFor();
      } else assert.equal(await metadata.textContent(), "tsgw-general");
      if (config.thinking && config.thinking !== "off") {
        const depth = metadata.getByText(`· ${config.thinking}`, { exact: true });
        await depth.waitFor();
        const bounds = await depth.boundingBox();
        const container = await metadata.boundingBox();
        assert.ok(bounds.x >= container.x && bounds.x + bounds.width <= container.x + container.width + 1,
          `${width}px ${config.id}: thinking depth remains visible`);
      } else assert.doesNotMatch(await metadata.textContent(), /· (off|high|xhigh)/);
      const dimensions = await metadata.boundingBox();
      assert.ok(dimensions.height < 20, "metadata stays on one line");
      const profile = await metadata.getByText("tsgw-general", { exact: true }).boundingBox();
      assert.ok(profile.width >= Math.min(60, dimensions.width * 0.39), "long model ids do not squeeze the profile to a single letter");
    }
    const longModel = row("long").getByText(children.at(-1).model, { exact: true });
    assert.ok(await longModel.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === "ellipsis"));
    const main = panel.getByRole("option").filter({ hasText: "E2E main task" });
    assert.doesNotMatch(await main.textContent(), /main-model|· high/, "main-agent row is unchanged");
    await page.screenshot({ path: join(artifacts, `agent-switcher-model-${width}-${locale}.png`) });
    await row("high").locator("..").getByRole("button", { name: locale === "en" ? "View sub-agent work in side panel" : "在侧栏面板中查看子代理工作", exact: true }).click();
    await page.getByRole("tab", { name: "E2E high" }).waitFor();
    assert.deepEqual(forbidden, [], "viewing agents never dispatches an agent command");
    assert.deepEqual(errors, [], "no browser runtime errors");
    await context.close();
    console.log(`PASS: ${width}px ${locale} three lines, models, thinking, missing/off levels, ellipsis, batch request and viewer button`);
  }
  for (const [id, original] of originals) assert.equal(readFileSync(pathFor(id), "utf8"), original, "viewing never changes session files");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  await page?.screenshot({ path: join(artifacts, "agent-switcher-model-failure.png") }).catch(() => {});
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
}
