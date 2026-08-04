import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── 隔离 ───────────────────────────────────────────────────────────────────
//
// lib/theme.ts 的全局主题目录是 join(os.homedir(), ".pi", "agent", "themes")。
// 将 USERPROFILE 指向临时目录并动态 import，避免测试耦合真实 ~/.pi/agent/themes/。
// os.homedir() 每次调用读取环境变量（无模块级缓存），动态 import 后即生效。

const baseDir = mkdtempSync(join(tmpdir(), "piweb-theme-test-"));
const globalThemesDir = join(baseDir, ".pi", "agent", "themes");
mkdirSync(globalThemesDir, { recursive: true });

process.env.USERPROFILE = baseDir;

const { listThemeSets, resolveTheme } = await import("./theme.ts");

// ─── Fixture ────────────────────────────────────────────────────────────────
//
// pi CLI theme JSON（与官方文件名约定一致：base-dark.json / base-light.json）。

const GRUVBOX_DARK = {
  name: "gruvbox-dark",
  vars: { bg0: "#282828", bg1: "#3c3836", bg2: "#504945", bg3: "#665c54", bg4: "#7c6f64", fg0: "#fbf1c7", fg3: "#bdae93", fg4: "#a89984", orange: "#d65d0e" },
  colors: { accent: "orange", border: "bg4", text: "", muted: "fg4", dim: "fg4", selectedBg: "bg1" },
};

const GRUVBOX_LIGHT = {
  name: "gruvbox-light",
  vars: { bg0: "#fbf1c7", bg1: "#ebdbb2", bg2: "#d5c4a1", bg3: "#bdae93", bg4: "#a89984", fg0: "#282828", fg3: "#665c54", fg4: "#7c6f64", orange: "#d65d0e" },
  colors: { accent: "orange", border: "bg4", text: "", muted: "fg4", dim: "fg4", selectedBg: "bg1" },
};

const SOLARIZED_DARK = {
  name: "solarized-dark",
  vars: { bg0: "#002b36", bg1: "#073642", bg2: "#094250", bg3: "#586e75", bg4: "#657b83", fg0: "#839496", fg3: "#586e75", fg4: "#657b83", blue: "#268bd2" },
  colors: { accent: "blue", border: "bg3", text: "", muted: "fg4", dim: "fg4", selectedBg: "bg1" },
};

// 单文件主题（无 -dark/-light 后缀），验证文件名约定外的回退路径
const MONOKAI = {
  name: "monokai",
  vars: { bg0: "#272822", bg1: "#2e2e2e", bg3: "#3e3d32", fg0: "#f8f8f2", fg3: "#75715e", fg4: "#555555", green: "#a6e22e" },
  colors: { accent: "green", border: "bg3", text: "", muted: "fg4", dim: "fg4", selectedBg: "bg1" },
};

const write = (name, body) => writeFileSync(join(globalThemesDir, `${name}.json`), JSON.stringify(body));
write("gruvbox-dark", GRUVBOX_DARK);
write("gruvbox-light", GRUVBOX_LIGHT);
write("solarized-dark", SOLARIZED_DARK);
write("monokai", MONOKAI);

test.after(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

// ─── 对比度工具（WCAG 相对亮度） ────────────────────────────────────────────

function relativeLuminance(hex) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex);
  if (!match) return 0.5;
  const [r, g, b] = [1, 2, 3].map((index) => {
    const channel = parseInt(match[index], 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ─── listThemeSets ──────────────────────────────────────────────────────────

test("listThemeSets 按 base 名聚合 dark/light 变体为 set", () => {
  const sets = listThemeSets();
  const byName = new Map(sets.map((s) => [s.name, s]));

  assert.ok(byName.has("gruvbox"), "gruvbox set 应存在");
  assert.equal(byName.get("gruvbox").hasDark, true);
  assert.equal(byName.get("gruvbox").hasLight, true);

  assert.ok(byName.has("solarized"), "solarized set 应存在");
  assert.equal(byName.get("solarized").hasDark, true);
  assert.equal(byName.get("solarized").hasLight, false);

  // 单文件主题也成 set
  assert.ok(byName.has("monokai"));
});

// ─── resolveTheme：配对变体 ─────────────────────────────────────────────────

test("resolveTheme 解析 gruvbox dark 变体（vars 引用 + 亮度推断）", () => {
  const t = resolveTheme("gruvbox", "dark");
  assert.ok(t, "应解析成功");
  assert.equal(t.isDark, true);
  assert.equal(t.cssVars["--bg"], "#282828");
  // colors 里的 var 引用解析：accent: "orange" → vars.orange（经对比度保障 ≥4.5:1）
  assert.ok(contrastRatio(t.cssVars["--accent"], t.cssVars["--bg"]) >= 4.5);
  // border: "bg4" → vars.bg4（#7c6f64 在 bg 上 3.03:1，过 3.0 保障后不变）
  assert.equal(t.cssVars["--border"], "#7c6f64");
  // colors.text 为空串 → 回落 vars.fg0
  assert.equal(t.cssVars["--text"], "#fbf1c7");
});

test("resolveTheme 解析 gruvbox light 变体", () => {
  const t = resolveTheme("gruvbox", "light");
  assert.ok(t);
  assert.equal(t.isDark, false);
  assert.equal(t.cssVars["--bg"], "#fbf1c7");
  assert.equal(t.cssVars["--text"], "#282828");
});

test("resolveTheme 派生 --composer-focus-bg（聚焦态与主题协调）", () => {
  const dark = resolveTheme("gruvbox", "dark");
  const light = resolveTheme("gruvbox", "light");
  assert.ok(dark);
  assert.ok(light);
  // dark 变体：聚焦背景 = 面板色提亮（#3c3836 向白方向）
  const darkFocus = dark.cssVars["--composer-focus-bg"];
  const darkPanel = dark.cssVars["--bg-panel"];
  assert.ok(darkFocus.startsWith("#"), "dark 聚焦背景应为 hex");
  assert.ok(darkFocus > darkPanel, "dark 聚焦背景应亮于面板色");
  // light 变体：聚焦背景 = 面板色向白混合
  const lightFocus = light.cssVars["--composer-focus-bg"];
  const lightPanel = light.cssVars["--bg-panel"];
  assert.ok(lightFocus.startsWith("#"), "light 聚焦背景应为 hex");
  assert.ok(lightFocus > lightPanel, "light 聚焦背景应亮于面板色");
});

test("resolveTheme 缺失变体时回退到相反变体", () => {
  // solarized 只有 dark 文件：请求 light 应回退 dark 文件，极性由内容决定
  const t = resolveTheme("solarized", "light");
  assert.ok(t);
  assert.equal(t.isDark, true);
  assert.equal(t.cssVars["--bg"], "#002b36");
});

// ─── resolveTheme：单文件主题 ──────────────────────────────────────────────

test("resolveTheme 单文件主题（无后缀）优先于相反变体回退", () => {
  // monokai.json 存在且 monokai-dark.json 不存在：dark/light 请求都走单文件
  const dark = resolveTheme("monokai", "dark");
  const light = resolveTheme("monokai", "light");
  assert.ok(dark);
  assert.ok(light);
  assert.equal(dark.cssVars["--bg"], "#272822");
  assert.equal(light.cssVars["--bg"], "#272822");
});

// ─── resolveTheme：不存在与非法输入 ─────────────────────────────────────────

test("resolveTheme 不存在的主题返回 null", () => {
  assert.equal(resolveTheme("nonexistent", "dark"), null);
  assert.equal(resolveTheme("", "dark"), null);
});

// ─── 文字对比度保障（web 可读性） ─────────────────────────────────────────────

test("文字层级对比度保障：muted ≥ 4.5、dim ≥ 3、dim 弱于 muted", () => {
  // solarized dark 原版 muted/dim 对比不足（2.79/3.37），映射层应提升 muted；
  // gruvbox light 原版 dim 3.24 接近下限，应保持或微调。
  const solarizedDark = resolveTheme("solarized", "dark");
  const gruvboxLight = resolveTheme("gruvbox", "light");
  assert.ok(solarizedDark);
  assert.ok(gruvboxLight);

  for (const resolved of [solarizedDark, gruvboxLight]) {
    const bg = resolved.cssVars["--bg"];
    const textRatio = contrastRatio(resolved.cssVars["--text"], bg);
    const mutedRatio = contrastRatio(resolved.cssVars["--text-muted"], bg);
    const dimRatio = contrastRatio(resolved.cssVars["--text-dim"], bg);
    assert.ok(textRatio >= 4.5, `text 对比度应 ≥4.5（实际 ${textRatio.toFixed(2)}）`);
    assert.ok(mutedRatio >= 4.5, `muted 对比度应 ≥4.5（实际 ${mutedRatio.toFixed(2)}）`);
    assert.ok(dimRatio >= 3.0, `dim 对比度应 ≥3.0（实际 ${dimRatio.toFixed(2)}）`);
    assert.ok(dimRatio < mutedRatio, "dim 应弱于 muted（层级递减）");
  }
});

// ─── 层级适配（高级 UI 评审整改项） ──────────────────────────────────────────

test("层级适配：accent 系 ≥4.5、border ≥3、气泡/侧边栏/选中态分层", () => {
  for (const [name, mode] of [
    ["gruvbox", "dark"],
    ["gruvbox", "light"],
    ["solarized", "dark"],
    ["solarized", "light"],
  ]) {
    const resolved = resolveTheme(name, mode);
    assert.ok(resolved, `${name}/${mode} 应解析成功`);
    const vars = resolved.cssVars;
    const bg = vars["--bg"];

    // 静止态 accent 与语法高亮语义色：全部 ≥4.5:1
    for (const key of ["--accent", "--accent-blue", "--accent-green", "--accent-orange", "--accent-red"]) {
      assert.ok(contrastRatio(vars[key], bg) >= 4.5, `${name}/${mode} ${key} ≥4.5（实际 ${contrastRatio(vars[key], bg).toFixed(2)}）`);
    }
    // 边框分隔线可见性：≥3:1
    assert.ok(contrastRatio(vars["--border"], bg) >= 3.0, `${name}/${mode} border ≥3.0`);
    // 用户气泡与面板分层（不再同色，可辨层级 ≥1.25:1）
    const userVsPanel = contrastRatio(vars["--user-bg"], vars["--bg-panel"]);
    assert.ok(userVsPanel >= 1.25, `${name}/${mode} 气泡与面板对比 ≥1.25（实际 ${userVsPanel.toFixed(2)}）`);
    // 侧边栏表面色存在且与主背景可辨（≥1.5:1）
    assert.ok(vars["--bg-sidebar"], `${name}/${mode} 应有侧边栏色`);
    const sidebarVsBg = contrastRatio(vars["--bg-sidebar"], bg);
    assert.ok(sidebarVsBg >= 1.5, `${name}/${mode} 侧边栏与主背景对比 ≥1.5（实际 ${sidebarVsBg.toFixed(2)}）`);
    // 选中态与 hover 区分（accent 微染）
    assert.notEqual(vars["--bg-selected"], vars["--bg-hover"], `${name}/${mode} 选中态应异于 hover`);
  }
});
