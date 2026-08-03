// scripts-debug/todo-jump-e2e.js
//
// P1「点击任务跳转聊天」回归测试（Playwright）。
//
// 背景：方案C P1 的跳转通道（scrollToEntry）经 6 个 commit 修复（窗口.React →
// sessionId 参数 → findEntryForTask user/assistant → 虚拟滚动 → first match →
// data-entry-id querySelector）。本脚本锁定该行为，防止回归。
//
// 断言：
//   ① 点击 TodoPanel 任务后，聊天滚动容器 scrollTop 发生变化（跳转了）；
//   ② 点不同任务，scrollTop 不同（不同任务跳各自创建消息）。
//
// 依赖：
//   - dev server 运行（localhost:30141）
//   - 一个带 ≥2 个 todo 任务的会话（默认 019fc63f...，可参数传入）
//
// 用法：
//   node scripts-debug/todo-jump-e2e.js [sessionId]
//   exit 0 = PASS / 1 = FAIL / 0 (SKIP) = 会话任务不足
import { chromium } from "playwright";

const SESSION_ID = process.argv[2] || "019fc63f-1000-74a1-9b3f-b5e78fe2158e";
const BASE = "http://localhost:30141";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 120));
  });

  await page.goto(`${BASE}/?session=${encodeURIComponent(SESSION_ID)}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(5000);
  await page.locator("button", { hasText: "待办" }).first().click();
  await page.waitForTimeout(1000);

  // 展开所有折叠组（▸ 标题），让已完成任务可见
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].forEach((b) => {
      if ((b.textContent || "").trim().startsWith("▸")) b.click();
    });
  });
  await page.waitForTimeout(500);

  // 聊天滚动容器 = 最大的可滚动 div（chat 区）
  const chatTop = () =>
    page.evaluate(() => {
      const els = [...document.querySelectorAll("div")].filter(
        (e) => e.scrollHeight > e.clientHeight + 200 && e.clientHeight > 400,
      );
      return els.length ? els.sort((a, b) => b.scrollHeight - a.scrollHeight)[0].scrollTop : -1;
    });

  const tasks = page.locator('button[title^="Jump to"]');
  const n = await tasks.count();
  if (n < 2) {
    console.log(`SKIP: 会话 ${SESSION_ID.slice(0, 8)} 不足 2 个任务 (${n})`);
    await browser.close();
    process.exit(0);
  }

  // 点前 4 个任务，记录各自滚动位置
  const results = [];
  for (let i = 0; i < Math.min(n, 4); i++) {
    await tasks.nth(i).click();
    await page.waitForTimeout(1500);
    results.push(await chatTop());
  }
  console.log("各任务点击后 scrollTop:", results);
  const distinct = new Set(results).size;
  const pass = distinct > 1 && results[0] >= 0;
  console.log(pass ? "PASS 不同任务跳不同位置" : "FAIL 跳转异常");
  if (errors.length) console.log("console errors:", errors.slice(0, 3));
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
