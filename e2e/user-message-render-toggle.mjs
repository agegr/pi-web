// Browser regression for the user-message render/source toggle (issue #1407):
// the stored prompt stays readable verbatim, and reading it never touches the
// session. Standalone: seeds a throwaway PI_CODING_AGENT_DIR, starts and stops
// its own dev server on a free loopback port, and never talks to a model.
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
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-user-source-"));
const project = join(agentDir, "project");
const sessionDir = join(agentDir, "sessions", "e2e");
mkdirSync(project);
mkdirSync(sessionDir, { recursive: true });
const timestamp = "2026-08-23T00:00:00.000Z";
const ISSUE = "e2e-user-source-issue";
const PAIR = "e2e-user-source-pair";
const MEDIA = "e2e-user-source-media";
const SKILL = "e2e-user-source-skill";
const LONG = "e2e-user-source-long";

// The reporter's message from #1407 plus markdown, formulae and entities.
const ISSUE_TEXT = [
  '<TableOperator v-model="columns" :tableId="TABLE_ID_CONST.BUSINESS.${basic.businessModule.toUpperCase()}.Demo" :refresh="queryData" /> 咋更离谱呢，要不就去掉 ${basic.businessModule.toUpperCase()} 不要这个变量，直接拼后面部分',
  "",
  "## E2E source heading",
  "",
  "**E2E bold** and _E2E italic_ and `E2E inline code`",
  "",
  '<div class="e2e-raw">E2E html &amp; entities &lt;tag&gt; &#39;quote&#39; &nbsp; end</div>',
  "",
  "Template ${user.name} -> ${pick(item)} and a lone ${ brace",
  "",
  "$$E = mc^2$$ and inline $a^2 + b^2 = c^2$.",
  "",
  "| E2E column | Value |",
  "| --- | --- |",
  "| ${row.id} | <b>raw</b> |",
  "",
  "> E2E quoted line",
  "- E2E list item ${vars}",
].join("\n");
const PAIR_A = "E2E alpha **alpha bold** stays rendered";
const PAIR_B = "E2E beta **beta bold** stays rendered";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const IMAGE_BLOCK = { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } };
const MEDIA_TEXT = "E2E image message **bold** text";
const SKILL_BODY = "# E2E skill body\n\nDo the E2E skill thing.";
const SKILL_TEXT = '<skill name="e2e-skill" location="/tmp/e2e-skill/SKILL.md">\nReferences are relative to /tmp/e2e-skill.\n\n'
  + SKILL_BODY + "\n</skill>\n\nrun E2E skill";
const SKILL_COMMAND = "/skill:e2e-skill run E2E skill";
// Above the 100,000-character markdown guard: rendered stays click-to-reveal.
const LONG_TEXT = "E2E long message with **markdown** and ${value}\n\n"
  + "E2E paragraph line with ${template.value} and <b>raw</b> stays plain.\n\n".repeat(1600)
  + "E2E long end";

function message(id, parentId, role, content) {
  return { type: "message", id, parentId, timestamp, message: { role, content } };
}

const originals = new Map();

function writeSession(id, entries) {
  const header = { type: "session", version: 3, id, timestamp, cwd: project };
  const content = [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  writeFileSync(join(sessionDir, `2026-08-23T00-00-00-000Z_${id}.jsonl`), content);
  originals.set(id, content.trimEnd().split("\n"));
}

writeSession(ISSUE, [
  message("u1", null, "user", ISSUE_TEXT),
  message("a1", "u1", "assistant", "E2E answer to the issue prompt"),
]);
writeSession(PAIR, [
  message("u1", null, "user", PAIR_A),
  message("a1", "u1", "assistant", "E2E alpha reply"),
  message("u2", "a1", "user", PAIR_B),
  message("a2", "u2", "assistant", "E2E beta reply"),
]);
writeSession(MEDIA, [
  message("m1", null, "user", [IMAGE_BLOCK]),
  message("a1", "m1", "assistant", "E2E image-only reply"),
  message("m2", "a1", "user", [{ type: "text", text: MEDIA_TEXT }, IMAGE_BLOCK]),
  message("a2", "m2", "assistant", "E2E image-text reply"),
]);
writeSession(SKILL, [
  message("s1", null, "user", SKILL_TEXT),
  message("a1", "s1", "assistant", "E2E skill reply"),
]);
writeSession(LONG, [
  message("l1", null, "user", LONG_TEXT),
  message("a1", "l1", "assistant", "E2E long reply"),
]);

const clipboardMock = () => {
  const writes = [];
  Object.defineProperty(window, "__e2eClipboard", { value: writes, configurable: true });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (value) => { writes.push(String(value)); return Promise.resolve(); } },
  });
};

let server, serverExited, browser, page, context, serverError;
const serverLog = createWriteStream(join(artifacts, "user-message-render-toggle-server.log"));
const interrupt = () => {
  process.exitCode = 1;
  server?.kill("SIGTERM");
  void browser?.close().catch(() => {});
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

// --- toggling helpers -------------------------------------------------------

const toggleButton = (entry, label) => entry.getByRole("button", { name: label, exact: true });

async function assertToggle(entry, label) {
  const button = toggleButton(entry, label);
  await button.waitFor({ state: "attached" });
  assert.equal(await button.getAttribute("title"), label, `the toggle title must read ${label}`);
  assert.equal(await button.getAttribute("aria-label"), label, `the toggle label must read ${label}`);
  assert.ok(await button.locator("svg").count() >= 1, `the ${label} toggle keeps its icon`);
  return button;
}

/** Hovers a message so its action row is interactive, then reads the row. */
async function actionRow(entry, expected) {
  await entry.hover();
  const row = entry.getByRole("button", { name: "Copy", exact: true }).locator("..").locator("..");
  await row.getByRole("button", { name: expected.at(-1), exact: true }).waitFor();
  const buttons = row.getByRole("button");
  assert.equal(await buttons.count(), expected.length, "the action row keeps four actions");
  assert.deepEqual(await buttons.evaluateAll((list) => list.map((button) =>
    (button.getAttribute("aria-label") || button.textContent || "").trim())), expected);
  assert.deepEqual(await buttons.evaluateAll((list) => list.map((button) => button.querySelectorAll("svg").length > 0)),
    expected.map(() => true), "every action keeps its icon");
  return row;
}

async function assertSource(entry, expected) {
  const source = entry.locator(".user-message-source");
  await source.waitFor();
  assert.equal(await source.evaluate((element) => element.children.length), 0, "source stays a pure text node");
  assert.equal(await source.evaluate((element) => getComputedStyle(element).whiteSpace), "pre-wrap");
  assert.equal(await source.evaluate((element) => element.textContent), expected, "source keeps the stored text byte for byte");
  assert.equal(await source.innerText(), expected, "source innerText is the whole stored text");
  return source;
}

async function copyNow(entry) {
  const button = entry.getByRole("button", { name: "Copy", exact: true });
  await button.waitFor();
  const previous = await page.evaluate(() => window.__e2eClipboard.length);
  await entry.hover();
  await button.click();
  await page.waitForFunction((count) => window.__e2eClipboard.length > count, previous);
  return page.evaluate(() => window.__e2eClipboard.at(-1));
}
const clipboardWrites = () => page.evaluate(() => window.__e2eClipboard.slice());

async function entryHeight(entry) {
  const box = await entry.boundingBox();
  assert.ok(box, "the message must be mounted");
  return box.height;
}

/** The bubble's capped scroll box, found by its cap rather than by markup. */
async function bubbleGuard(entry) {
  return entry.evaluate((element) => {
    const bubble = [...element.querySelectorAll("div")].find((div) => getComputedStyle(div).maxHeight === "300px");
    return bubble ? { clientHeight: bubble.clientHeight, scrollHeight: bubble.scrollHeight } : null;
  });
}

const settingsSection = () => page.locator(".settings-language-options");

async function chooseLocale(code) {
  const option = page.locator(".settings-language-options button").filter({
    has: page.locator(".settings-language-code", { hasText: new RegExp(`^${code}$`) }),
  });
  await option.click();
  await page.waitForFunction((expected) => document.documentElement.lang === expected, code);
}

/** In the viewport, not just mounted: a phone drawer parks it off-canvas. */
const inViewport = (locator) => locator.evaluate((element) => {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0
    && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight;
}).catch(() => false);

/** Opens Settings › General in English, runs the checks, and closes it again. */
async function withSettings(callback) {
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  const drawer = !(await inViewport(settings));
  if (drawer) {
    await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
    const opened = Date.now() + 10_000;
    while (!(await inViewport(settings))) {
      assert.ok(Date.now() < opened, "the sidebar must reveal Settings");
      await delay(100);
    }
  }
  await settings.click();
  if (!(await settingsSection().count())) {
    const tab = page.locator(".settings-section-tabs").getByRole("button", { name: "General", exact: true });
    if (await tab.isVisible()) await tab.click();
    else await page.locator(".settings-mobile-section-picker").selectOption("general");
  }
  await settingsSection().waitFor();
  await callback();
  await page.keyboard.press("Escape");
  await settingsSection().waitFor({ state: "detached" });
  // A phone drawer stays open behind the dialog; its backdrop closes it.
  if (drawer) await page.mouse.click(page.viewportSize().width - 8, 200);
}

async function assertNoHorizontalOverflow(label) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  assert.ok(metrics.scrollWidth <= metrics.innerWidth + 1,
    `${label}: the page must not scroll sideways (${metrics.scrollWidth} > ${metrics.innerWidth})`);
}

/** English labels, then the same states under zh-CN and zh-TW. */
async function checkLocaleLabels(entry) {
  await assertToggle(entry, "Source");
  await withSettings(async () => {
    await chooseLocale("zh-CN");
    await assertToggle(entry, "原文");
    await chooseLocale("zh-TW");
    await assertToggle(entry, "原文");
    await chooseLocale("en");
    await assertToggle(entry, "Source");
  });
  await entry.hover();
  await toggleButton(entry, "Source").click();
  await assertToggle(entry, "Render");
  assert.ok(await toggleButton(entry, "Render").locator("svg circle").count() >= 1, "Render shows the eye icon");
  await withSettings(async () => {
    await chooseLocale("zh-CN");
    await assertToggle(entry, "渲染");
    await chooseLocale("zh-TW");
    await assertToggle(entry, "渲染");
    await chooseLocale("en");
    await assertToggle(entry, "Render");
  });
  await entry.hover();
  await toggleButton(entry, "Render").click();
  await assertToggle(entry, "Source");
  assert.equal(await entry.locator(".user-message-source").count(), 0);
}

// --- run --------------------------------------------------------------------

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
    assert.equal(server.exitCode, null, "the server exited before readiness; see the server log");
    const response = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) {
      const { sessions } = await response.json();
      assert.deepEqual(sessions.map((session) => session.id).sort(), [ISSUE, PAIR, MEDIA, SKILL, LONG].sort());
      break;
    }
    assert.ok(Date.now() < deadline, "server readiness timed out; see the server log");
    await delay(250);
  }

  browser = await chromium.launch();
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 780 }]) {
    context = await browser.newContext({ viewport, locale: "en-US" });
    await context.addInitScript(clipboardMock);
    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [];
    const writes = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (event) => { if (event.type() === "error") errors.push(event.text()); });
    page.on("response", (response) => {
      if (response.url().startsWith(base) && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
    });
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "GET" || !url.pathname.startsWith("/api/")) return;
      writes.push({ path: url.pathname, body: request.postData() ?? "" });
    });

    // #1407: the exact prompt comes back as one text node, entities and all.
    await page.goto(`${base}/?session=${ISSUE}`, { waitUntil: "domcontentloaded" });
    const issue = page.locator('[data-entry-id="u1"]');
    await issue.locator(".markdown-user-message").waitFor();
    assert.equal(await issue.locator("strong").filter({ hasText: "E2E bold" }).count(), 1, "the default state renders markdown");
    assert.equal(await issue.locator(".user-message-source").count(), 0);
    const issueRow = await actionRow(issue, ["Copy", "Edit from here", "New session", "Source"]);
    assert.equal(await copyNow(issue), ISSUE_TEXT, "rendered Copy keeps the stored text");
    await toggleButton(issue, "Source").click();
    const issueSource = await assertSource(issue, ISSUE_TEXT);
    const sourceHtml = await issueSource.innerHTML();
    assert.ok(issueSource && sourceHtml.includes("&amp;amp; entities &amp;lt;tag&amp;gt;"), "entities stay undecoded");
    assert.ok(ISSUE_TEXT.includes("$$E = mc^2$$") && ISSUE_TEXT.includes("$a^2 + b^2 = c^2$"));
    assert.equal(await issue.locator("strong").count() + await issue.locator("code").count() + await issue.locator("table").count(), 0,
      "the source view keeps no rendered markdown nodes");
    assert.equal(await copyNow(issue), ISSUE_TEXT, "Source Copy copies the same text");
    assert.deepEqual((await clipboardWrites()).slice(-2), [ISSUE_TEXT, ISSUE_TEXT]);
    await toggleButton(issue, "Render").click();
    await issue.locator(".user-message-source").waitFor({ state: "detached" });
    await assertToggle(issue, "Source");
    assert.equal(await issue.locator("strong").filter({ hasText: "E2E bold" }).count(), 1, "Render restores markdown");

    // Keyboard: focus alone reveals the row, Enter and Space toggle it.
    await toggleButton(issue, "Source").focus();
    assert.equal(await toggleButton(issue, "Source").evaluate((button) => getComputedStyle(button).opacity), "1",
      "focusing an action reveals the action row");
    await page.keyboard.press("Enter");
    await issue.locator(".user-message-source").waitFor();
    await assertToggle(issue, "Render");
    await toggleButton(issue, "Render").focus();
    await page.keyboard.press("Space");
    await issue.locator(".user-message-source").waitFor({ state: "detached" });
    await assertToggle(issue, "Source");

    // Back and forth twice, then the dynamic English/Chinese wording.
    for (let round = 0; round < 2; round++) {
      await issue.hover();
      await toggleButton(issue, "Source").click();
      await assertSource(issue, ISSUE_TEXT);
      await toggleButton(issue, "Render").click();
      await issue.locator(".user-message-source").waitFor({ state: "detached" });
    }
    await checkLocaleLabels(issue);
    await issue.locator(".markdown-user-message").waitFor();
    if (viewport.width <= 600) {
      const boxes = await issueRow.getByRole("button").evaluateAll((buttons, width) => buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left >= -0.5 && rect.right <= width + 0.5 && rect.width > 0;
      }), viewport.width);
      assert.ok(boxes.every(Boolean), "every action stays inside the 375px viewport");
      await assertNoHorizontalOverflow("375px action row");
    }
    await page.screenshot({ path: join(artifacts, `user-source-issue-${viewport.width}.png`) });
    console.log(`PASS: ${viewport.width}px issue #1407 source, copy, keyboard, and labels`);

    // Two messages on one screen never share their toggle.
    await page.goto(`${base}/?session=${PAIR}`, { waitUntil: "domcontentloaded" });
    const alpha = page.locator('[data-entry-id="u1"]');
    const beta = page.locator('[data-entry-id="u2"]');
    await alpha.locator(".markdown-user-message").waitFor();
    await beta.locator(".markdown-user-message").waitFor();
    await alpha.hover();
    await toggleButton(alpha, "Source").click();
    await assertSource(alpha, PAIR_A);
    assert.equal(await beta.locator(".user-message-source").count(), 0, "the other message keeps rendering");
    assert.equal(await beta.locator("strong").filter({ hasText: "beta bold" }).count(), 1);
    await assertToggle(beta, "Source");
    await toggleButton(alpha, "Render").click();
    await alpha.locator(".user-message-source").waitFor({ state: "detached" });
    assert.equal(await alpha.locator("strong").filter({ hasText: "alpha bold" }).count(), 1);
    await beta.hover();
    await toggleButton(beta, "Source").click();
    await assertSource(beta, PAIR_B);
    assert.equal(await alpha.locator(".user-message-source").count(), 0);
    assert.equal(await alpha.locator("strong").filter({ hasText: "alpha bold" }).count(), 1);
    await toggleButton(beta, "Render").click();
    await beta.locator(".user-message-source").waitFor({ state: "detached" });
    console.log(`PASS: ${viewport.width}px messages toggle independently`);

    // Attachments: no toggle without text, and images survive the source view.
    await page.goto(`${base}/?session=${MEDIA}`, { waitUntil: "domcontentloaded" });
    const imageOnly = page.locator('[data-entry-id="m1"]');
    const imageText = page.locator('[data-entry-id="m2"]');
    await imageOnly.locator("img").waitFor();
    assert.equal(await imageOnly.getByRole("button", { name: "Source", exact: true }).count(), 0,
      "a pure attachment message offers no Source toggle");
    await imageText.locator("img").waitFor();
    await imageText.hover();
    await toggleButton(imageText, "Source").click();
    await assertSource(imageText, MEDIA_TEXT);
    assert.equal(await imageText.locator("img").count(), 1, "the attachment stays mounted in the source view");
    assert.equal(await imageText.locator("img").isVisible(), true);
    await toggleButton(imageText, "Render").click();
    await imageText.locator(".user-message-source").waitFor({ state: "detached" });
    assert.equal(await imageText.locator("img").count(), 1);
    console.log(`PASS: ${viewport.width}px attachments`);

    // Skills stay compact; Source shows the stored expansion; Copy keeps the command.
    await page.goto(`${base}/?session=${SKILL}`, { waitUntil: "domcontentloaded" });
    const skill = page.locator('[data-entry-id="s1"]');
    await skill.locator('button[aria-expanded="false"]').waitFor();
    const compact = await skill.innerText();
    assert.ok(compact.includes("/skill:e2e-skill") && compact.includes("run E2E skill"), "skills render compact");
    assert.ok(!compact.includes("E2E skill body"), "the expanded skill body stays collapsed");
    assert.equal(await copyNow(skill), SKILL_COMMAND, "Copy keeps the skill command");
    await skill.hover();
    await toggleButton(skill, "Source").click();
    await assertSource(skill, SKILL_TEXT);
    assert.ok((await skill.innerText()).includes("E2E skill body"));
    assert.equal(await copyNow(skill), SKILL_COMMAND, "Source Copy still copies the skill command");
    assert.deepEqual((await clipboardWrites()).slice(-2), [SKILL_COMMAND, SKILL_COMMAND]);
    await toggleButton(skill, "Render").click();
    await skill.locator(".user-message-source").waitFor({ state: "detached" });
    assert.equal(await skill.locator('button[aria-expanded="false"]').count(), 1);
    assert.ok(!(await skill.innerText()).includes("E2E skill body"));
    console.log(`PASS: ${viewport.width}px skill compact/source/copy`);

    // Oversized prompts keep the render guard in both directions.
    await page.goto(`${base}/?session=${LONG}`, { waitUntil: "domcontentloaded" });
    const long = page.locator('[data-entry-id="l1"]');
    const reveal = long.getByRole("button", { name: /Message content is very large/ });
    await reveal.waitFor();
    assert.ok((await entryHeight(long)) <= 460, "the guarded message stays bounded");
    await assertToggle(long, "Source");
    await long.hover();
    await toggleButton(long, "Source").click();
    const longSource = await assertSource(long, LONG_TEXT);
    assert.ok((await longSource.innerText()).length > 100_000, "Source shows the complete oversized prompt");
    const guarded = await bubbleGuard(long);
    assert.ok(guarded && guarded.clientHeight <= 320 && guarded.scrollHeight > guarded.clientHeight,
      "the source view scrolls inside the capped bubble");
    assert.ok((await entryHeight(long)) <= 460, "the source view stays bounded");
    await toggleButton(long, "Render").click();
    await long.locator(".user-message-source").waitFor({ state: "detached" });
    await reveal.waitFor();
    assert.ok((await entryHeight(long)) <= 460, "switching back keeps the oversized render guard");
    const guardedAgain = await bubbleGuard(long);
    assert.ok(guardedAgain && guardedAgain.clientHeight <= 320, "the bubble cap survives the round trip");
    await assertNoHorizontalOverflow(`${viewport.width}px long message`);
    console.log(`PASS: ${viewport.width}px oversized prompt guard`);

    // Never a model prompt, never a session mutation.
    assert.deepEqual(writes.filter((write) => /"type"\s*:\s*"prompt"/.test(write.body)
      || write.path.endsWith("/fork") || write.path === "/api/agent/new"), [], "the toggle must not prompt or fork");
    assert.deepEqual(writes.filter((write) => write.path.startsWith("/api/sessions") && write.path !== "/api/sessions/ui-state"), [],
      "the toggle must not write session data");
    assert.deepEqual(errors, [], `browser errors at width ${viewport.width}`);
    console.log(`PASS: ${viewport.width}px browser regression without prompts or session writes`);
    await context.tracing.stop();
    await context.close();
    context = undefined;
    page = undefined;
  }

  for (const [id, original] of originals) {
    const lines = readFileSync(join(sessionDir, `2026-08-23T00-00-00-000Z_${id}.jsonl`), "utf8").trimEnd().split("\n");
    const added = lines.slice(original.length);
    assert.deepEqual(lines.slice(0, original.length), original, `${id}: the transcript must stay byte for byte`);
    assert.ok(added.every((line) => JSON.parse(line).type === "thinking_level_change"),
      `${id}: viewing a source must append no transcript entry`);
  }
  console.log("PASS: transcripts unchanged; user-message render toggle verified");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  if (page) await page.screenshot({ path: join(artifacts, "user-source-failure.png") }).catch(() => {});
  if (context) await context.tracing.stop({ path: join(artifacts, "user-source-trace.zip") }).catch(() => {});
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
