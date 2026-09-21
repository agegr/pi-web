// Focused e2e check for PDF `#page=` markdown links.
//
//   node e2e/pdf-page-fragment.mjs
//
// Seeds a session whose cwd holds a generated multi-page PDF, then clicks
// markdown links and inspects the file-viewer iframe URL. Screenshots land in
// test-results/e2e/.
//
// Note: the full Chromium build is required. The Chromium headless shell has no
// PDF viewer and downloads the file instead, so nothing renders in the iframe.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.env.E2E_SERVER_MODE || "dev";
assert.ok(mode === "dev" || mode === "start", "E2E_SERVER_MODE must be dev or start");
assert.ok(
  mode !== "dev" || !existsSync(join(root, ".next/dev/lock")),
  "Use a checkout without an active dev server",
);

const PAGE = 183;
const PAGE_COUNT = 200;
const timestamp = "2026-08-23T00:00:00.000Z";
const SESSION = "e2e-pdf-page-fragment";

/** Minimal multi-page PDF: every page prints its own number near the top edge. */
function buildFixturePdf(pageCount) {
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (text) => {
    chunks.push(text);
    length += Buffer.byteLength(text, "latin1");
  };
  const addObject = (body) => {
    offsets.push(length);
    push(body);
  };
  const pageObjectIds = [];
  for (let index = 0; index < pageCount; index += 1) pageObjectIds.push(4 + index * 2);

  push("%PDF-1.4\n");
  addObject("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  addObject(`2 0 obj\n<< /Type /Pages /Count ${pageCount} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>\nendobj\n`);
  addObject("3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n");

  for (let index = 0; index < pageCount; index += 1) {
    const pageId = pageObjectIds[index];
    const contentId = pageId + 1;
    const stream = `BT /F1 108 Tf 40 690 Td (PAGE ${index + 1}) Tj ET\n`;
    addObject(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]`
      + ` /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    );
    addObject(`${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`);
  }

  const xrefOffset = length;
  const size = offsets.length + 1;
  push(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (const offset of offsets) push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.from(chunks.join(""), "latin1");
}

const artifacts = join(root, "test-results/e2e");
mkdirSync(artifacts, { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "pi-web-pdf-e2e-"));
const project = join(agentDir, "project");
const sessionDir = join(agentDir, "sessions", "pdf");
mkdirSync(project, { recursive: true });
mkdirSync(sessionDir, { recursive: true });

const pdfPath = join(project, "report.pdf");
writeFileSync(pdfPath, buildFixturePdf(PAGE_COUNT));

const entries = [
  { type: "session", version: 3, id: SESSION, timestamp, cwd: project },
  {
    type: "message",
    id: "e0",
    parentId: null,
    timestamp,
    message: { role: "user", content: `[PDF page ${PAGE}](${pdfPath}#page=${PAGE})` },
  },
  {
    type: "message",
    id: "e1",
    parentId: "e0",
    timestamp,
    message: { role: "user", content: `[PDF page 1](${pdfPath})` },
  },
];
writeFileSync(
  join(sessionDir, `2026-08-23T00-00-00-000Z_${SESSION}.jsonl`),
  `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
);

let server;
let browser;
const serverLog = createWriteStream(join(artifacts, "pdf-server.log"));

/** The `type=read` iframe URL currently rendered by the file viewer. */
async function viewerSrc(page) {
  const srcs = await page
    .locator("iframe")
    .evaluateAll((frames) => frames.map((frame) => frame.getAttribute("src")));
  return srcs.find((src) => src && src.includes("/api/files/") && src.includes("type=read")) ?? null;
}

async function waitForViewerSrc(page, predicate, label) {
  const deadline = Date.now() + 30_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await viewerSrc(page);
    if (last && predicate(last)) return last;
    await delay(200);
  }
  assert.fail(`${label}: viewer iframe never matched (last src: ${last})`);
}

/** Screenshot just the PDF iframe so the rendered page can be inspected on its own. */
async function shootViewer(page, name) {
  for (const frame of await page.locator("iframe").all()) {
    const src = await frame.getAttribute("src");
    if (src && src.includes("type=read")) {
      await frame.screenshot({ path: join(artifacts, name) });
      return;
    }
  }
}

try {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${port}`;

  server = spawn(
    process.execPath,
    [join(root, "node_modules/next/dist/bin/next"), mode, "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: root,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.pipe(serverLog, { end: false });
  server.stderr.pipe(serverLog, { end: false });

  const readyDeadline = Date.now() + 120_000;
  while (true) {
    assert.equal(server.exitCode, null, "Server exited before readiness; see pdf-server.log");
    const response = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response?.ok) break;
    assert.ok(Date.now() < readyDeadline, "Server readiness timed out; see pdf-server.log");
    await delay(250);
  }

  // The headless shell has no PDF viewer (it downloads the file instead), so the
  // full Chromium build is required to observe the page the viewer lands on.
  browser = await chromium.launch({ channel: "chromium" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (event) => { if (event.type() === "error") errors.push(event.text()); });

  await page.goto(`${base}/?session=${SESSION}`, { waitUntil: "domcontentloaded" });

  // 1. Link with #page= must reach the viewer iframe.
  const pageLink = page.getByRole("link", { name: `PDF page ${PAGE}`, exact: true });
  await pageLink.waitFor();
  await pageLink.click();
  const withFragment = await waitForViewerSrc(page, (src) => src.includes(`#page=${PAGE}`), "page fragment link");
  console.log(`PASS: #page=${PAGE} reached the viewer\n      ${withFragment}`);
  await delay(3000);
  await page.screenshot({ path: join(artifacts, "pdf-page-183.png") });
  await shootViewer(page, "pdf-viewer-183.png");

  // 2. A plain link to the same PDF must clear the jump and remount the viewer.
  await page.getByRole("link", { name: "PDF page 1", exact: true }).click();
  const withoutFragment = await waitForViewerSrc(page, (src) => !src.includes("#page="), "plain link");
  console.log(`PASS: plain link cleared the fragment\n      ${withoutFragment}`);
  await delay(3000);
  await page.screenshot({ path: join(artifacts, "pdf-page-1.png") });
  await shootViewer(page, "pdf-viewer-1.png");

  // 3. Going back to a fragment link must jump again (revision bump, not a stale iframe).
  await pageLink.click();
  await waitForViewerSrc(page, (src) => src.includes(`#page=${PAGE}`), "fragment link after remount");
  console.log("PASS: fragment jump works again after remount");

  assert.deepEqual(errors, [], "Browser console must stay clean");
  assert.equal(server.exitCode, null, "Server must stay up; see pdf-server.log");
  console.log("\nAll PDF page-fragment checks passed.");
} finally {
  await browser?.close().catch(() => {});
  server?.kill("SIGTERM");
}
