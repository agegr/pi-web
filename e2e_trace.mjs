import { chromium } from "playwright";

const BASE = "http://127.0.0.1:30145";
const SID = "e2e-long-session-0001";

const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(30000);

const requests = [];
page.on("request", (r) => { if (r.url().includes("/api/")) requests.push(`REQ ${r.method()} ${r.url().split("30145")[1]}`); });
page.on("response", (r) => { if (r.url().includes("/api/")) requests.push(`RES ${r.status()} ${r.url().split("30145")[1]}`); });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

const result = {};
try {
  await page.goto(`${BASE}/?session=${SID}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(15000);
  result.bodySample = (await page.evaluate(() => document.body.innerText || "")).slice(0, 150);
  result.rendered = (await page.evaluate(() => document.body.innerText || "")).includes("E2E");
} catch (e) {
  result.threw = String(e);
} finally {
  console.log("=== requests ===");
  requests.slice(0, 30).forEach((x) => console.log(x));
  console.log("=== pageErrors ===", pageErrors.slice(0, 5));
  console.log("=== result ===", JSON.stringify(result));
  await browser.close();
}
