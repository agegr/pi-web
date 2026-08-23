import { chromium } from "playwright";

const BASE = "http://127.0.0.1:30145";
const SID = "e2e-long-session-0001";

const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(30000);

const consoleErrors = [];
const pageErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => pageErrors.push(String(e)));

const result = {};
try {
  await page.goto(`${BASE}/?session=${SID}`, { waitUntil: "domcontentloaded" });
  // Primary check: chat renders the long session without crashing.
  try {
    await page.waitForFunction(() => (document.body.innerText || "").includes("E2E "), { timeout: 30000 });
    result.rendered = true;
  } catch {
    result.rendered = false;
  }
  result.bodySample = await page.evaluate(() => (document.body.innerText || "").slice(0, 200));
} catch (e) {
  result.threw = String(e);
} finally {
  result.consoleErrors = consoleErrors.slice(0, 5);
  result.pageErrors = pageErrors.slice(0, 5);
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
