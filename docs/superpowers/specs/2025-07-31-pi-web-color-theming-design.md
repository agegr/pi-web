# Pi Web 自定义主题色设计文档

**日期**：2025-07-31  
**作者**：PR 贡献者  
**状态**：设计已确认，待实现  
**关联仓库**：https://github.com/agegr/pi-web

---

## 1. 目标与范围

### 1.1 目标

在保留现有 light/dark 深浅模式切换的基础上，为 Pi Web 增加一组用户可切换的主题色（Sky / Lavender / Mint / Coral），让界面整体色调跟随主题色变化，同时保证文字、气泡、按钮等元素的可视度。

### 1.2 范围

- 新增 4 套自定义主题色，每套都包含 light 和 dark 两种模式。
- 在现有 light/dark 切换按钮上增加 hover 调色盘。
- 颜色选择持久化到 `localStorage`，页面刷新不丢失（最终产品实现，测试 mockup 不持久化）。
- 完全向后兼容：未选择主题色的用户看到现有默认配色；原有 `pi-theme` 键值不变。

### 1.3 非目标

- 不做完全自定义取色器。
- 不改动服务端配置或后端 API。
- 不替换现有 Tailwind / CSS 变量体系，只扩展。

---

## 2. 整体设计

### 2.1 架构

颜色主题与深浅模式是两个独立的维度：

- **深浅模式**：由 `html.dark` class 控制，存储在 `localStorage.getItem("pi-theme")`（`"light" | "dark"`）。
- **主题色**：由 `html[data-theme]` 控制，存储在 `localStorage.getItem("pi-color-theme")`（`"default" | "sky" | "lavender" | "mint" | "coral"`）。

两个维度组合形成最终配色方案。例如：

- `html`（无 dark，无 data-theme）→ Default Light
- `html.dark` → Default Dark
- `html[data-theme="sky"]` → Sky Light
- `html[data-theme="sky"].dark` → Sky Dark

### 2.2 数据流

```
用户 hover light/dark 按钮
       │
       ▼
调色盘弹出（ColorThemePalette 组件）
       │
       ▼
用户点击颜色圆点
       │
       ▼
setColorTheme("sky")
       │
       ├── 设置 document.documentElement.setAttribute("data-theme", "sky")
       ├── 写入 localStorage.setItem("pi-color-theme", "sky")
       └── 触发 useTheme 的 listeners，刷新依赖主题色的组件
       │
       ▼
页面刷新时 layout.tsx 内联脚本读取 localStorage
       └── 在 React 水合前设置 data-theme，避免闪烁
```

---

## 3. CSS 变量与主题定义

### 3.1 变量体系

继续使用 `app/globals.css` 中已存在的 CSS 变量：

```css
--bg
--bg-panel
--bg-hover
--bg-selected
--border
--text
--text-muted
--text-dim
--accent
--accent-hover
--user-bg
--assistant-bg
--tool-bg
```

### 3.2 默认主题

保持 `:root` 和 `html.dark` 不变，确保未选择主题色的用户界面完全不变。

### 3.3 自定义主题色值

每套主题色都覆盖上述全部变量，原则是：

- **浅色主题**：主背景使用极淡的色调，文字使用深色以保证可读性；accent 使用对应色相的中等深色。
- **深色主题**：主背景使用对应色相的深色，文字使用接近白色的浅色；accent 使用对应色相的亮色，确保按钮/链接在深色背景上清晰可见。
- **气泡**：`--user-bg` 与主背景 `--bg` 保持明显色差；`--assistant-bg` 在浅色主题用纯白以突出，在深色主题与 `--bg` 一致、靠边框区分。
- **工具块/代码块**：`--tool-bg` 使用与主题色相一致的深色，而不是通用蓝灰。

已确认的主题色值见下表（最终代码中应使用这些 hex 值，或在此基础上微调）：

| 主题 | Light bg | Light accent | Dark bg | Dark accent | Dark tool-bg |
|------|----------|--------------|---------|-------------|--------------|
| Default | #ffffff | #2563eb | #1a1a1a | #60a5fa | #1f2937 |
| Sky | #f0f9ff | #0284c7 | #0c4a6e | #7dd3fc | #172554 |
| Lavender | #faf5ff | #7c3aed | #2e1065 | #c4b5fd | #312e81 |
| Mint | #f0fdf4 | #059669 | #064e3b | #6ee7b7 | #14532d |
| Coral | #fff5f5 | #e11d48 | #7f1d1d | #ff8fa3 | #450a0f |

完整变量定义在实现阶段写入 `app/globals.css`，按 `html[data-theme="xxx"]:not(.dark)` 和 `html[data-theme="xxx"].dark` 两组声明。

---

## 4. 组件与状态

### 4.1 扩展 `hooks/useTheme.ts`

保持现有 API：`theme`、`toggleTheme`、`isDark`。

新增 API：

```ts
type ColorTheme = "default" | "sky" | "lavender" | "mint" | "coral";

export function useTheme() {
  // ... existing theme/toggleTheme/isDark

  const colorTheme: ColorTheme = /* read from document.documentElement.dataset.theme or localStorage fallback "default" */;

  const setColorTheme = useCallback((next: ColorTheme) => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("pi-color-theme", next);
    } catch {
      // ignore
    }
    listeners.forEach((cb) => cb());
  }, []);

  return { theme, toggleTheme, isDark, colorTheme, setColorTheme };
}
```

### 4.2 新增 `components/ColorThemePalette.tsx`

职责：仅在 hover 时展示一个窄长调色盘。

行为：

- 包裹在 light/dark 切换按钮外侧，与按钮共享 hover 区域。
- 调色盘宽度约 160–180px，高度约 36–40px，5 个颜色圆点横向排列，圆点直径 18px。
- 鼠标离开按钮/调色盘后延迟约 300ms 再隐藏，给用户足够时间移入调色盘。
- 按钮到调色盘的 8px 间隙纳入 hover 敏感区，避免移动过程中调色盘消失。
- 每个圆点有 `aria-label` 和 `title`，支持键盘操作。

Default 圆点设计：

- 圆形内用 135° 斜线分成两半。
- 一半为灰色 `#4b5563`，代表 dark 模式。
- 一半为近白色 `#f9fafb`，代表 light 模式。
- 外框 1px 半透明描边，避免轮廓在浅色/深色背景下消失。

### 4.3 修改 `components/AppShell.tsx`

将现有的 light/dark 图标按钮替换为：

```tsx
<div className="theme-toggle-wrap">
  <button onClick={toggleTheme} ...>
    {isDark ? <MoonIcon /> : <SunIcon />}
  </button>
  <ColorThemePalette
    current={colorTheme}
    onSelect={setColorTheme}
  />
</div>
```

原有 light/dark 点击行为、View Transition 动画保持不变。

### 4.4 修改 `app/layout.tsx`

内联初始化脚本同时读取 `pi-theme` 和 `pi-color-theme`：

```html
<script>
  (function(){
    try {
      var t = localStorage.getItem("pi-theme");
      if (t === "dark") document.documentElement.classList.add("dark");
      var c = localStorage.getItem("pi-color-theme");
      if (c && c !== "default") document.documentElement.setAttribute("data-theme", c);
    } catch(e) {}
  })();
</script>
```

这样可以避免页面加载时的主题闪烁。

---

## 5. 国际化

在 `lib/i18n/messages/en.ts` 和 `lib/i18n/messages/zh-CN.ts` 新增 key：

```ts
"theme.default": "Default"
"theme.sky": "Sky"
"theme.lavender": "Lavender"
"theme.mint": "Mint"
"theme.coral": "Coral"
```

如维护者要求，再补充 `ja` / `ru` 语言包。

---

## 6. 可访问性

- 调色盘 `role="group"`，每个圆点 `aria-label` 描述主题名。
- 当前选中的圆点通过 `aria-pressed` 或 `aria-current` 标识。
- 支持键盘 Tab 进入调色盘，Enter/Space 选择。
- 保持 `prefers-reduced-motion` 下的动画降级。

---

## 7. 测试计划

### 7.1 单元测试

- `hooks/useTheme.ts`：
  - `setColorTheme` 正确设置 DOM 属性和 localStorage。
  - 不支持的值回退为 `"default"`。
  - 原有 `toggleTheme` 行为不变。

### 7.2 组件测试

- `ColorThemePalette`：
  - hover 显示，mouseleave 延迟隐藏。
  - 点击圆点调用 `onSelect`。
  - 当前主题圆点有 active 样式。

### 7.3 手动测试

- 刷新页面无主题闪烁。
- light/dark 切换仍触发 View Transition 动画。
- 所有 5 个主题在 light/dark 下文字、气泡、按钮、链接清晰可读。
- 未选择过主题色的旧用户界面完全不变。

---

## 8. 文件变更清单

| 文件 | 变更 |
|------|------|
| `app/globals.css` | 新增 4 套主题色（light + dark）变量定义 |
| `app/layout.tsx` | 内联脚本读取并设置 `data-theme` |
| `hooks/useTheme.ts` | 新增 `colorTheme`、`setColorTheme` API |
| `components/ColorThemePalette.tsx` | 新增调色盘组件 |
| `components/AppShell.tsx` | 在 light/dark 按钮处嵌入调色盘 |
| `lib/i18n/messages/en.ts` | 新增主题名翻译 key |
| `lib/i18n/messages/zh-CN.ts` | 新增主题名翻译 key |
| `hooks/useTheme.test.mjs`（可选） | 新增/更新测试 |

---

## 9. 向后兼容与风险

- **向后兼容**：未选择主题色的用户 `pi-color-theme` 不存在，一律视为 `"default"`，界面与现有完全一致。
- **原有 light/dark 切换**：逻辑、localStorage key、View Transition 动画均不受影响。
- **SSR / 水合**：`layout.tsx` 内联脚本优先于 React 渲染，`useSyncExternalStore` 读取 DOM 值，避免不一致。
- **风险**：自定义主题色数量增加后，`globals.css` 体积增大。可通过只覆盖必要变量来最小化；本设计已精简为仅覆盖 13 个核心变量。

---

## 10. PR 提交说明建议

标题：`feat: add color theme palette with Sky/Lavender/Mint/Coral presets`

正文要点：

1. 说明动机：用户在现有 light/dark 之外希望有主题色选择，提升个性化体验。
2. 实现概要：扩展 `useTheme`，新增 `ColorThemePalette` 组件，扩展 CSS 变量。
3. 强调向后兼容与 light/dark 切换行为不变。
4. 列出测试覆盖：单元测试 + 手动测试矩阵。
5. 如有截图/GIF，附在 PR 描述中。

---

## 11. 后续可扩展方向（非本 PR 范围）

- 允许用户自定义单色调（色相旋转）。
- 将主题偏好持久化到服务端配置（类似 `models.json`）。
- 根据系统 `prefers-color-scheme` 自动选择默认深浅模式。
