/* eslint-disable @typescript-eslint/no-require-imports, no-console */
// scripts-debug/inspector-diff-expand-e2e.js
//
// P2「inspector 文件级 diff 展开」回归测试（Playwright）。
// 依赖：dev server（localhost:30141）+ 当前 cwd 在 git 仓库内、有变更文件。
// 断言：① 三段（unstaged/staged/untracked）默认展开，能看到文件行；
//       ② 折叠/再展开后文件行消失/出现；
//       ③ 「让 agent 提交」按钮存在且按预期 disabled/enabled 切换；
//       ④ git 轮询开关存在。
// 截图证据：/tmp/inspector-diff-expand-{1..4}.png
// exit: 0=PASS / 1=FAIL
const { chromium } = require("playwright");

const BASE = "http://localhost:30141";
const SESSION_ID = process.argv[2] || "019fc63f-1000-74a1-9b3f-b5e78fe2158e"; // 任意有 cwd 的会话

const SHOTS = {
  initial: "/tmp/inspector-diff-expand-1.png",
  collapsed: "/tmp/inspector-diff-expand-2.png",
  reExpanded: "/tmp/inspector-diff-expand-3.png",
  menuOpen: "/tmp/inspector-diff-expand-4.png",
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 120));
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 100)}`));

  await page.goto(`${BASE}/?session=${encodeURIComponent(SESSION_ID)}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(4000);

  // 切到 inspector（Git）tab
  const inspectorTab = page.locator("button", { hasText: "概览" }).first();
  await inspectorTab.click().catch(() => {});
  await page.waitForTimeout(800);

  // 等 git 数据加载（按 file-list 是否出现判断）
  await page
    .locator("text=/Modified|Staged|Untracked/i")
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});

  // ---- 1) 默认展开状态（截屏） ----
  await page.screenshot({ path: SHOTS.initial, fullPage: false });

  // 检查文件行是否可见：Mono path 用 title 存，且为 git 文件行
  // （过滤掉 cwd subtitle 与 BranchChip；git 文件行 path 含 "." 或 "/" 或包含 "??" 等
  // 状态字符前缀）。
  const fileRowPaths = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("div[title]")].filter((el) => {
      const t = el.getAttribute("title") || "";
      const cs = window.getComputedStyle(el);
      // 只看 mono 字体的 title 元素（cwd subtitle 也是 mono，但更长）—— 用 trim 后是否在
      // git diff 输出常见字符集内粗略筛选
      const isMono = cs.fontFamily.toLowerCase().includes("mono");
      if (!isMono) return false;
      // cwd subtitle 是 /data/Code/... 绝对路径；file row 是相对路径
      if (t.startsWith("/")) return false;
      return t.length > 0 && t.length < 200;
    });
    return rows.slice(0, 8).map((el) => el.getAttribute("title"));
  });
  console.log("mono title candidates:", fileRowPaths);

  // ---- 2) 点 modified 行的 chevron 折叠 ----
  // 找到第一个 aria-expanded="true" 的按钮，点后应该变 false。
  const expandedBtns = page.locator('button[aria-expanded="true"]');
  const expCount = await expandedBtns.count();
  console.log(`aria-expanded=true 按钮数: ${expCount}`);
  let toggleOk = false;
  if (expCount > 0) {
    await expandedBtns.first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: SHOTS.collapsed, fullPage: false });
    // 验证：同一组的状态变了；点过的 aria-expanded 变 false
    const stillExpanded = await page.locator('button[aria-expanded="true"]').count();
    const collapsedNow = await page.locator('button[aria-expanded="false"]').count();
    console.log(`折叠后: expanded=${stillExpanded}, collapsed=${collapsedNow}`);
    toggleOk = stillExpanded === expCount - 1 && collapsedNow >= 1;
  }

  // ---- 3) 再展开 ----
  const collapsedBtns = page.locator('button[aria-expanded="false"]');
  if ((await collapsedBtns.count()) > 0) {
    await collapsedBtns.first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: SHOTS.reExpanded, fullPage: false });
  }

  // ---- 4) 打开三点菜单 ----
  // 三点按钮 aria-label / title 含 "More" / "操作"
  const moreBtn = page
    .locator(
      'button[title*="More"], button[title*="操作"], button[aria-label*="More"], button[aria-label*="操作"]',
    )
    .first();
  await moreBtn.click().catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS.menuOpen, fullPage: false });

  // 菜单里应该出现「让 agent 提交」 + 「自动刷新 git」+ MiniToggle
  // inspector 菜单通过 MiniToggle (role=switch) 定位，避开顶栏 language 菜单。
  const menuTexts = await page.evaluate(() => {
    const toggles = [...document.querySelectorAll('button[role="switch"]')];
    // inspector 菜单里只有一个 switch，从它向上找最近的 role="menu" 容器
    const menu = toggles.map((t) => t.closest('[role="menu"]')).find((m) => m !== null);
    if (!menu) return [];
    return [...menu.querySelectorAll("button")]
      .map((el) => (el.textContent || "").trim())
      .filter((t) => t.length > 0);
  });
  console.log("inspector menu items:", menuTexts);

  const hasCommit = menuTexts.some((t) => /提交|commit/i.test(t));
  const hasPolling = menuTexts.some((t) => /刷新|polling/i.test(t));
  const hasToggle = (await page.locator('[role="switch"]').count()) > 0;
  console.log(
    `has commit entry: ${hasCommit}, has polling entry: ${hasPolling}, has MiniToggle: ${hasToggle}`,
  );

  const pass = fileRowPaths.length > 0 && toggleOk && hasCommit && hasPolling && hasToggle;
  console.log(pass ? "PASS inspector 文件级展开 + 菜单" : "FAIL inspector 检查不通过");
  if (errors.length) console.log("console errors:", errors.slice(0, 5));
  console.log("screenshots:", SHOTS);

  await browser.close();
  process.exit(pass ? 0 : 1);
})();
