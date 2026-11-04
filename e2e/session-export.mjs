import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import { chromium } from "playwright";
import { getPackageDir } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { labelSessionExport } = await jiti.import("../lib/session-export-html.ts");
const { exportFromFile } = await import(pathToFileURL(join(getPackageDir(), "dist/core/export-html/index.js")));
const dir = mkdtempSync(join(tmpdir(), "pi-web-export-test-"));
const timestamp = "2026-01-01T12:00:00.000Z";
const rows = [{ type: "session", version: 3, id: "synthetic", cwd: dir, timestamp }];
function message(id, parentId, role, content, extra = {}) {
  rows.push({ type: "message", id, parentId, timestamp, message: { role, content, timestamp: Date.parse(timestamp), ...extra } });
}
const assistant = { api: "openai-completions", provider: "synthetic", model: "synthetic", stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
message("u1", null, "user", [{ type: "text", text: "Identical text" }]);
message("a1", "u1", "assistant", [{ type: "text", text: "Identical text" }], assistant);
message("u2", "a1", "user", [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=" }]);
message("a2", "u2", "assistant", [{ type: "thinking", thinking: "Synthetic thinking only" }], assistant);
message("a3", "a2", "assistant", [{ type: "toolCall", id: "t1", name: "read", arguments: { path: "/synthetic/example.txt" } }, { type: "toolCall", id: "bash-call", name: "bash", arguments: { command: "printf synthetic" } }], assistant);
message("result", "a3", "toolResult", [{ type: "text", text: "Synthetic tool result" }], { toolCallId: "t1", toolName: "read", isError: false });
message("bash-result", "result", "toolResult", [{ type: "text", text: "Synthetic bash tool output" }], { toolCallId: "bash-call", toolName: "bash", isError: false });
const skill = '<skill name="synthetic-skill" location="/synthetic/SKILL.md">\nSynthetic skill instructions\n</skill>';
message("skill-only", "bash-result", "user", skill);
message("skill-text", "skill-only", "user", `${skill}\n\nSynthetic skill request`);
const hostileText = 'Literal </script> and </body>\n\n<img src=x onerror="window.__exportHostileExecuted=true">\n\n[unsafe link](javascript:window.__exportHostileExecuted=true)';
message("hostile-user", "skill-text", "user", hostileText);
message("hostile-assistant", "hostile-user", "assistant", [{ type: "text", text: hostileText }], assistant);
message("bash-execution", "hostile-assistant", "bashExecution", "", { command: "printf standalone", output: "Synthetic standalone shell output", exitCode: 0, cancelled: false });
message("a4", "bash-execution", "assistant", [{ type: "text", text: "Branch one answer" }], assistant);
message("a5", "u1", "assistant", [{ type: "text", text: "Branch two answer" }], assistant);
rows.push({ type: "label", id: "label", parentId: "a4", timestamp, targetId: "a4", label: "First branch" });
const source = join(dir, "synthetic.jsonl");
writeFileSync(source, rows.map(row => JSON.stringify(row)).join("\n") + "\n");

const browser = await chromium.launch(process.env.CHROME_CHANNEL ? { channel: process.env.CHROME_CHANNEL } : {});
try {
  const output = join(dir, "raw.html");
  await exportFromFile(source, output);
  const raw = readFileSync(output, "utf8");
  // Earlier closing-body literals must survive untouched; unknown endings fail closed.
  const scriptPrefix = '<html><body><script>const closingBody = "</body>";</script>';
  const inserted = labelSessionExport(`${scriptPrefix}</body>\n</html>`, "en");
  assert.ok(inserted.startsWith(scriptPrefix));
  assert.ok(inserted.indexOf(".pi-web-export-role") > scriptPrefix.length);
  for (const missingEnding of ["<html><body>no closing tags", scriptPrefix, `${scriptPrefix}</body>unexpected`]) {
    assert.equal(labelSessionExport(missingEnding, "en"), missingEnding);
  }
  // Resolve only this generated fixture: never enumerate or read private sessions.
  const resolver = join(dir, "session-reader.mjs");
  writeFileSync(resolver, `export const resolveSessionPath = async () => ${JSON.stringify(source)};`);
  const routeJiti = createJiti(import.meta.url, {
    tsconfigPaths: true,
    alias: { [fileURLToPath(new URL("../lib/session-reader", import.meta.url)).replaceAll("\\", "/")]: resolver },
  });
  const { GET } = await routeJiti.import("../app/api/sessions/[id]/export/route.ts");
  for (const suffix of ["", "?inline=1&locale=zh-CN"]) {
    const response = await GET(new Request(`http://localhost/api/sessions/synthetic/export${suffix}`), { params: Promise.resolve({ id: "synthetic" }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
    assert.match(response.headers.get("Content-Disposition"), suffix ? /^inline;/ : /^attachment;/);
    assert.match(response.headers.get("Content-Disposition"), /filename="pi-session-synthetic.html"; filename\*=UTF-8''pi-session-synthetic.html/);
    assert.equal(response.headers.get("Content-Security-Policy"), "frame-ancestors 'none'");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("X-Frame-Options"), "DENY");
    assert.equal(response.headers.get("Cache-Control"), "no-cache");
    assert.match(await response.text(), /pi-web-export-role/);
  }
  const server = createServer(async (request, response) => {
    const exported = await GET(new Request(`http://localhost${request.url}`), { params: Promise.resolve({ id: "synthetic" }) });
    response.writeHead(exported.status, Object.fromEntries(exported.headers));
    response.end(await exported.text());
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const downloadPage = await browser.newPage();
    await downloadPage.setContent(`<a download href="http://127.0.0.1:${server.address().port}/api/sessions/synthetic/export?locale=en">Export</a>`);
    const pending = downloadPage.waitForEvent("download");
    await downloadPage.locator("a").click();
    const download = await pending;
    assert.equal(download.suggestedFilename(), "pi-session-synthetic.html");
    assert.equal(await download.failure(), null);
    assert.match(readFileSync(await download.path(), "utf8"), /pi-web-export-role/);
    await downloadPage.close();
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  console.log("PASS export route: actual browser HTML download, synthetic CLI export, attachment/inline and security headers preserved");
  const embedded = html => html.match(/<script id="session-data"[^>]*>([\s\S]*?)<\/script>/)[1];
  async function hostileRendering(page) {
    const rendering = [];
    for (const id of ["hostile-user", "hostile-assistant"]) {
      const content = page.locator(`#entry-${id} > .markdown-content`);
      assert.match(await content.innerText(), /Literal <\/script> and <\/body>/);
      assert.match(await content.innerText(), /<img src=x onerror="window\.__exportHostileExecuted=true">/);
      assert.equal(await content.locator("[onerror], a[href^='javascript:']").count(), 0);
      rendering.push(await content.innerHTML());
    }
    assert.equal(await page.evaluate(() => window.__exportHostileExecuted), undefined);
    return rendering;
  }
  const baselinePage = await browser.newPage({ offline: true });
  await baselinePage.goto(pathToFileURL(output).href);
  const baselineHostile = await hostileRendering(baselinePage);
  await baselinePage.close();
  for (const [locale, user, agent, tool] of [["en", "User", "Assistant", "Tool"], ["zh-CN", "用户", "助手", "工具"], ["zh-TW", "使用者", "助手", "工具"], ["invalid", "User", "Assistant", "Tool"]]) {
    const html = labelSessionExport(raw, locale);
    assert.equal(embedded(html), embedded(raw), "embedded session data stays byte-for-byte identical");
    const file = join(dir, `${locale}.html`);
    writeFileSync(file, html);
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, offline: true });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(file).href);
    await page.waitForSelector(".pi-web-export-role");
    async function heading(id, text) {
      const label = page.locator(`#${id} > .pi-web-export-role`);
      assert.equal(await label.count(), 1, `${id} has exactly one label`);
      assert.equal(await label.innerText(), text);
      assert.equal(await label.isVisible(), true);
    }
    await heading("entry-u1", user);
    await heading("entry-a1", agent);
    await heading("entry-u2", user);
    await heading("entry-a2", agent);
    await heading("entry-a3", agent);
    await heading("tool-call-t1", tool);
    await heading("tool-call-bash-call", tool);
    await heading("entry-bash-execution", tool);
    assert.equal(await page.locator("#tool-call-bash-call > .tool-command").innerText(), "$ printf synthetic");
    assert.match(await page.locator("#tool-call-bash-call").innerText(), /Synthetic bash tool output/);
    assert.equal(await page.locator("#entry-bash-execution > .tool-command").innerText(), "$ printf standalone");
    assert.match(await page.locator("#entry-bash-execution").innerText(), /Synthetic standalone shell output/);
    assert.match(await page.locator("#tool-call-t1").innerText(), /Synthetic tool result/);
    assert.equal(await page.locator("#entry-u2 img").count(), 1);
    for (const id of ["skill-only", "skill-text"]) {
      await heading(`entry-${id}`, user);
      assert.equal(await page.locator(`#entry-${id}.skill-user-entry`).count(), 1);
      assert.equal(await page.locator(`#entry-${id} .pi-web-export-role`).count(), 1);
    }
    assert.equal(await page.locator("#entry-skill-only > .user-message").count(), 0);
    assert.equal(await page.locator("#entry-skill-text > .user-message").innerText(), "Synthetic skill request");
    assert.deepEqual(await hostileRendering(page), baselineHostile, "SDK hostile-text escaping is unchanged");
    for (let i = 0; i < 2; i++) {
      await page.locator("#tree-container").getByText("assistant: Branch two answer", { exact: false }).click();
      await page.waitForSelector("#entry-a5 > .pi-web-export-role");
      await heading("entry-a5", agent);
      await heading("entry-u1", user);
      await page.locator("#tree-container").getByText("assistant: Branch one answer", { exact: false }).click();
      await page.waitForSelector("#tool-call-t1 > .pi-web-export-role");
      await heading("entry-a1", agent);
      await heading("tool-call-t1", tool);
      await heading("tool-call-bash-call", tool);
      await heading("entry-bash-execution", tool);
      await heading("entry-skill-only", user);
      await heading("entry-skill-text", user);
      assert.deepEqual(await hostileRendering(page), baselineHostile);
    }
    if (process.env.EXPORT_SCREENSHOT && locale === "en") await page.screenshot({ path: process.env.EXPORT_SCREENSHOT, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await heading("entry-u1", user);
    await heading("entry-a3", agent);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${locale}: offline role labels, identical text, images, thinking, tools incl. bash calls/standalone shell, skill-only/skill+text, unchanged hostile-text escaping/no execution, branch rerenders, phone width, unchanged embedded data`);
  }
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
