// Run alone with `node e2e/file-freshness.mjs` in an idle checkout.
// No model credentials, sessions or requests to an existing Pi Web service.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "Use a checkout without an active dev server");
const temp = mkdtempSync(join(tmpdir(), "pi-web-freshness-"));
const project = join(temp, "project");
const artifacts = join(root, "test-results/file-freshness");
mkdirSync(project);
mkdirSync(artifacts, { recursive: true });
mkdirSync(join(temp, "sessions/test"), { recursive: true });
writeFileSync(join(temp, "sessions/test/fixture.jsonl"), JSON.stringify({ type: "session", version: 3, id: "freshness-fixture", timestamp: "2026-01-01T00:00:00.000Z", cwd: project }) + "\n");
const note = join(project, "freshness.md");
const picture = join(project, "freshness.svg");
const html = join(project, "form.html");
const audio = join(project, "sound.wav");
const pdf = join(project, "document.pdf");
const pdfParts = ["%PDF-1.4\n"];
const offsets = [0];
for (const [index, body] of [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>",
].entries()) {
  offsets.push(Buffer.byteLength(pdfParts.join("")));
  pdfParts.push(`${index + 1} 0 obj\n${body}\nendobj\n`);
}
const xref = Buffer.byteLength(pdfParts.join(""));
pdfParts.push(`xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
writeFileSync(pdf, pdfParts.join(""));
const svg = color => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><path fill="${color}" d="M0 0h64v64H0z"/></svg>`;
writeFileSync(note, "# Version-A\n");
writeFileSync(picture, svg("#ff0000"));
writeFileSync(html, '<!doctype html><body style="height:3000px"><input id="notes"><script>window.instance=Math.random()</script></body>');
const wav = Buffer.alloc(44 + 16000 * 5);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40); writeFileSync(audio, wav);
const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const log = createWriteStream(join(artifacts, "server.log"));
const server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: temp, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"],
});
const exited = once(server, "exit");
server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
let browser;
try {
  for (let i = 0; i < 180; i++) {
    assert.equal(server.exitCode, null, "fixture server exited");
    try { if ((await fetch(`${base}/api/web-auth`)).ok) break; } catch { /* starting */ }
    await delay(500);
  }
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  for (const watch of [false, true]) {
    writeFileSync(note, "# Version-A\n"); writeFileSync(picture, svg("#ff0000"));
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "en-US" });
    if (!watch) await context.addInitScript(() => {
      const Native = window.EventSource;
      window.EventSource = class extends EventTarget {
        constructor(url, options) {
          super();
          const parsed = new URL(url, location.href);
          if (parsed.pathname.startsWith("/api/files/") && parsed.searchParams.get("type") === "watch") { this.readyState = 0; return; }
          return new Native(url, options);
        }
        close() { this.readyState = 2; }
      };
    });
    // No route interception: Playwright routing would disable the HTTP cache.
    const page = await context.newPage();
    await page.goto(`${base}/?cwd=${encodeURIComponent(project)}`);
    const open = async path => {
      const entry = page.locator("#session-sidebar").getByTitle(path.replace(/\\/g, "/"), { exact: true });
      await entry.waitFor({ timeout: 120000 }); await entry.dispatchEvent("click");
    };
    const panel = page.locator("#file-panel");
    await open(note); await panel.getByRole("heading", { name: "Version-A", exact: true }).waitFor();
    await delay(300); writeFileSync(note, "# Version-B\n");
    if (!watch) await open(note);
    await panel.getByRole("heading", { name: "Version-B", exact: true }).waitFor({ timeout: 10000 });
    writeFileSync(note, "# Version-C\n");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await panel.getByRole("heading", { name: "Version-C", exact: true }).waitFor({ timeout: 10000 });
    await open(picture);
    const pixel = () => panel.locator("img").evaluate(img => {
      if (!img.complete || !img.naturalWidth) return null;
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
      const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0);
      return [...ctx.getImageData(10, 10, 1, 1).data].slice(0, 3).join(",");
    });
    await panel.locator("img").waitFor();
    for (let i = 0; i < 100 && await pixel() !== "255,0,0"; i++) await delay(50);
    assert.equal(await pixel(), "255,0,0");
    await delay(300); writeFileSync(`${picture}.tmp`, svg("#0000ff")); renameSync(`${picture}.tmp`, picture);
    if (!watch) await open(picture);
    for (let i = 0; i < 100 && await pixel() !== "0,0,255"; i++) await delay(50);
    assert.equal(await pixel(), "0,0,255", "atomic replacement refreshes the same path");
    await open(html);
    const iframe = panel.locator("iframe"); await iframe.waitFor();
    const frame = await (await iframe.elementHandle()).contentFrame();
    await frame.locator("#notes").fill("Keep my note");
    await frame.evaluate(() => scrollTo(0, 120));
    const instance = await frame.evaluate(() => window.instance);
    for (let i = 0; i < 2; i++) {
      await open(html); await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
      await delay(300);
      assert.equal(await frame.evaluate(() => window.instance), instance);
      assert.equal(await frame.locator("#notes").inputValue(), "Keep my note");
      assert.equal(await frame.evaluate(() => scrollY), 120);
    }
    await open(audio); await panel.locator("audio").waitFor();
    await page.waitForFunction(() => document.querySelector("#file-panel audio")?.readyState >= 1);
    await panel.locator("audio").evaluate(el => { el.currentTime = 2; el.dataset.instance = "original"; });
    const src = await panel.locator("audio").getAttribute("src");
    await open(audio); await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await delay(300);
    assert.equal(await panel.locator("audio").getAttribute("src"), src);
    assert.equal(await panel.locator("audio").evaluate(el => el.dataset.instance), "original");
    assert.ok(await panel.locator("audio").evaluate(el => el.currentTime >= 1.9));
    await open(pdf); await panel.locator("iframe").waitFor(); await delay(500);
    const pdfSrc = await panel.locator("iframe").getAttribute("src");
    await panel.locator("iframe").evaluate(el => { el.dataset.instance = "original"; });
    await open(pdf); await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await delay(300);
    assert.equal(await panel.locator("iframe").getAttribute("src"), pdfSrc);
    assert.equal(await panel.locator("iframe").evaluate(el => el.dataset.instance), "original");
    // Chromium's internal PDF scroll state is not script-accessible; keeping
    // the iframe node and URL proves recovery did not navigate/restart it.
    const encoded = note.replace(/\\/g, "/").split("/").filter(Boolean).map(encodeURIComponent).join("/");
    for (const type of ["meta", "read", "download"]) {
      const response = await context.request.get(`${base}/api/files/${encoded}?type=${type}`);
      assert.equal(response.status(), 200); assert.equal(response.headers()["cache-control"], "private, no-store, max-age=0");
    }
    const denied = await context.request.get(`${base}/api/files/etc/passwd?type=read`);
    assert.equal(denied.status(), 403);
    console.log(`PASS: ${watch ? "normal" : "missing"} watch: same-size text, focus, atomic image, unchanged HTML/audio/PDF, headers and permissions`);
    await context.close();
  }
} finally {
  await browser?.close(); server.kill("SIGTERM");
  await Promise.race([exited, delay(15000).then(() => server.kill("SIGKILL"))]);
  log.end(); rmSync(temp, { recursive: true, force: true });
}
