import { chromium } from "playwright";

const BASE = "http://127.0.0.1:30145";
const SID = "e2e-long-session-0001";

const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(30000);

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

const result = {};
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  // Wait for sidebar to list sessions, then click the long one.
  await page.waitForFunction(() => (document.body.innerText || "").includes("5000"), { timeout: 30000 });
  // Click the sidebar row containing "5000 条消息" (the long session).
  await page.getByText("5000 条消息").first().click();
  // Wait for chat to render E2E messages.
  try {
    await page.waitForFunction(() => (document.body.innerText || "").includes("E2E "), { timeout: 30000 });
    result.rendered = true;
  } catch { result.rendered = false; }
  result.bodySample = (await page.evaluate(() => document.body.innerText || "")).slice(0, 200);
  // Scroll to top repeatedly to trigger pagination sentinel.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => { const sc = document.querySelector('[class*="overflow"]'); if (sc) sc.scrollTop = 0; window.scrollTo(0, 0); });
    await page.waitForTimeout(500);
  }
  result.afterScrollSample = (await page.evaluate(() => document.body.innerText || "")).slice(0, 120);
} catch (e) {
  result.threw = String(e);
} finally {
  result.pageErrors = pageErrors.slice(0, 5);
  result.consoleErrors = consoleErrors.slice(0, 5);
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
