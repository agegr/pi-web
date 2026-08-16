# 前端布局与实现现状审计 / 优化方案

> 审计对象：`pi-web-robin` @ v0.8.8（main, `ce402bd`）
> 审计范围：`app/`、`components/`、`hooks/`、`app/globals.css`、构建与样式工具链
> 日期：2026-08-16

---

## 0. 结论速览（TL;DR）

| 维度 | 现状 | 评价 |
|---|---|---|
| 样式方案 | **内联 `style={{}}` 为主（1083 处）**，全局语义 CSS 次之，Tailwind 工具类极少（约 120 处，且 95% 集中在 `components/robin/`） | ⚠️ 四套并存，无统一约定 |
| Tailwind 使用深度 | 只用到"引入 + 少量布局工具类"。`@theme` 里定义的 15 个颜色 token **实际只被用了 4 次**（`text-text-muted`） | ⚠️ 装了但没用起来 |
| `tailwind.config.ts` | **死文件**。Tailwind v4 不再自动读取 JS/TS config，globals.css 里也没有 `@config` 指令 | 🔴 误导性配置 |
| 设计 token | 仅 13 个颜色变量 + 1 个字体变量。**没有**间距/圆角/字号/阴影/层级/状态色 scale | 🔴 主要缺口 |
| 硬编码颜色 | 32 个不同十六进制值 + 40+ 个 rgba 字面量散落在 tsx 中（错误红/成功绿/警告黄全部无 token） | 🔴 暗色模式靠手写第二套值 |
| 交互态 | hover/focus 用 **JS 事件改 DOM style**（`onMouseEnter` 64 处、`currentTarget.style` 156 处） | 🔴 反模式 |
| 断点 | 同一套断点在 **4 个地方**各自定义（globals.css / panel-layout.ts / useIsMobile.ts / Tailwind 默认值），且互相不对齐 | 🔴 已产生实际不一致 |
| 组件粒度 | 6 个"上帝组件"共 12,564 行（占前端 tsx 约 70%），最大 `ChatInput.tsx` 2638 行 | 🔴 |
| 代码分割 | **零 `next/dynamic`**。mermaid / react-syntax-highlighter / katex CSS 全部进首屏 client bundle | 🔴 首屏体积 |
| Server Components | 37 个 tsx 里 32 个是 `"use client"`，5 个 server 组件全是 3 行的壳 | ⚠️ 未利用 RSC |
| 布局架构（shell/面板/拖拽） | CSS 变量 + class 切换 + `useResizablePanel`，**设计得不错** | ✅ 保留 |

**一句话**：布局架构本身是合理的（CSS 变量驱动的可拖拽三栏 + 移动端 overlay），问题全在**样式层没有体系**——Tailwind 只是被"安装"了而不是被"采用"，真正的样式实现是 1000+ 处手写内联对象。优化的核心不是"换框架"，而是**建立 token 体系 + 把交互态还给 CSS + 分层拆包**。

---

## 1. 技术栈与工具链

### 1.1 依赖现状

```
next        16.2.12   (App Router, --webpack 构建)
react       19.2.4
tailwindcss 4.2.2     (v4，CSS-first 配置)
@tailwindcss/postcss  4.2.2
```

`package.json:60` — 注意 **`tailwindcss` 在 `devDependencies`**。对于 `npm publish` 分发的包这是对的（构建产物已经出好 CSS），但要意识到消费者侧不会有 Tailwind。

### 1.2 构建配置

[postcss.config.mjs](postcss.config.mjs) — 唯一插件是 `@tailwindcss/postcss`，正确的 v4 接法。

[next.config.ts](next.config.ts) — 只做了 `serverExternalPackages`、缓存头、版本注入。**没有** `optimizePackageImports`、没有 bundle 分析、没有 `modularizeImports`。

[tailwind.config.ts](tailwind.config.ts) — 🔴 **这个文件不生效**：

```ts
const config: Config = {
  content: ["./pages/**/*", "./components/**/*", "./app/**/*"],  // v4 自动扫描，无需 content
  theme: { extend: {} },                                          // 空
  plugins: [],
};
```

Tailwind v4 改成 CSS-first 配置后，只有在 CSS 里显式写 `@config "../tailwind.config.ts"` 才会加载 JS config。[app/globals.css:1](app/globals.css:1) 只有 `@import "tailwindcss"`，没有 `@config`。所以：
- 这个文件**完全没被读取**；
- 里面的 `content` 路径也是多余的（v4 自动检测源文件）；
- 更糟的是它会误导后来的人往里加配置，然后发现"改了没反应"。

**动作**：删掉它，或者改成 `@theme` 里的真实配置。

### 1.3 Tailwind 的实际接入方式

[app/globals.css:1-19](app/globals.css:1)：

```css
@import "tailwindcss";

@theme {
  --color-bg: var(--bg);
  --color-bg-panel: var(--bg-panel);
  --color-bg-hover: var(--bg-hover);
  --color-bg-selected: var(--bg-selected);
  --color-border: var(--border);
  --color-text: var(--text);
  --color-text-muted: var(--text-muted);
  --color-text-dim: var(--text-dim);
  --color-accent: var(--accent);
  /* ...共 15 个 */
}
```

这个桥接写法本身是**对的**——把手写的 `--bg` / `--text` 语义变量提升成 Tailwind 的 `bg-bg-panel` / `text-text-muted` / `border-border` 工具类，同时保留 `html.dark` 覆写来做主题切换。

问题是**没人用**。全仓库扫描：

```
bg-bg-* / text-text-* / border-border 等 token 工具类实际使用次数：
  text-text-muted   4 次
  其余全部          0 次
```

对比之下，`color: "var(--text-muted)"` 这种内联写法出现了 **127 次**，`border: "1px solid var(--border)"` 出现了 **105 次**。

也就是说：**`@theme` 这段配置目前是纯粹的死代码**，它唯一的作用是让 Tailwind 生成了一堆没人引用的 utility class（好在 v4 是按需生成，不产生体积）。

---

## 2. 样式实现：四套系统并存

### 2.1 分布量化

```
内联 style={{}}      1083 处   ← 主力
className=            314 处
  ├─ 全局语义 class   ~190 处  (.markdown-body, .file-viewer-*, .extension-widget-* ...)
  ├─ Tailwind 工具类  ~120 处  (几乎全在 components/robin/)
  └─ CSS Module         ~11 处  (仅 ChatMinimap)
globals.css          1412 行
ChatMinimap.module.css 232 行
AppShell 内联 <style>  ~85 行  (AppShell.tsx:1549)
```

### 2.2 系统 A：内联 style 对象（遗留主力）

覆盖全部核心组件。典型样例 [components/AppShell.tsx:960](components/AppShell.tsx:960)：

```tsx
<button
  style={{
    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    height: 32, padding: 0, background: "none", border: "none",
    borderRadius: 9, color: "var(--text-muted)", cursor: disabled ? "default" : "pointer",
    fontSize: 12, opacity: disabled ? 0.35 : 1,
    transition: "background 0.12s, color 0.12s",
  }}
  onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; } }}
  onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
>
```

按文件分布（style 对象数）：

| 文件 | 内联 style | className |
|---|---:|---:|
| ModelsConfig.tsx | 188 | 0 |
| ChatInput.tsx | 107 | 1 |
| SessionSidebar.tsx | 102 | 1 |
| MessageView.tsx | 89 | 10 |
| SkillsConfig.tsx | 83 | 0 |
| PluginsConfig.tsx | 83 | 0 |
| AppShell.tsx | 80 | 12 |
| FileExplorer.tsx | 51 | 0 |
| ChatWindow.tsx | 49 | 19 |
| FileViewer.tsx | 47 | 21 |

**代价**：

1. **无法用 CSS 伪类** → 于是有了 64 处 `onMouseEnter` + 156 处 `currentTarget.style` 直接改 DOM。这套 JS hover 有几个真实问题：
   - React 重渲染后 `style` prop 会覆盖 JS 写入的值，鼠标停在原地但样式被重置；
   - 触屏设备上 `mouseenter` 触发后**永远不会 leave**，元素卡在 hover 态；
   - `:focus-visible`、`:active`、`:disabled` 只能靠三元表达式手工模拟；
   - 每个按钮多两个闭包，列表渲染时是实打实的分配开销。
2. **无法用媒体查询** → 响应式只能靠 `useIsMobile()` 走 JS，导致 SSR 首帧永远按 desktop 渲染再跳变（`useIsMobile.ts:22` 的 `getServerSnapshot` 返回 `false`）。
3. **无法复用** → `padding: "8px 10px"` 出现 18 次、`border: "1px solid var(--border)"` 出现 105 次，改一次要全局搜。
4. **体积** → 内联样式无法被 gzip 跨元素压缩，且每次渲染重建对象。

### 2.3 系统 B：全局语义 CSS（globals.css，1412 行）

按块划分：

| 区段 | 行数 | 内容 |
|---|---|---|
| token + 主题 | 1–95 | `@theme` / `:root` / `html.dark` / view-transition |
| 基础重置 | 94–128 | box-sizing、html/body、滚动条 |
| extension widget | 130–332 | 扩展状态栏（BEM 风格，写得规范） |
| markdown-body | 342–590 | react-markdown 输出样式（写得规范） |
| code block / mermaid | 592–896 | 代码块、mermaid 缩放弹窗 |
| file viewer | 898–1058 | 工具栏、模式切换 |
| frontmatter | 1060–1123 | YAML 元信息卡 |
| keyframes | 1125–1211 | 10 个动画 |
| **面板布局** | 1213–1412 | sidebar / right-panel 的响应式行为 |

这部分质量其实**明显高于内联样式**——用了 `color-mix()`、`@supports`、`prefers-reduced-motion`、`env(safe-area-inset-*)`、container query，考虑得很细。

问题：
- 1412 行单文件，无模块划分，改动风险高；
- 25 处 `!important`（`globals.css` 内），全部是为了**压过内联样式**——这是系统 A 和系统 B 打架的直接证据，例如 [globals.css:1261](app/globals.css:1261) `border-right: none !important;`、[globals.css:1408](app/globals.css:1408) `font-size: 16px !important;`；
- 没有和 `@theme` 打通：`.markdown-body` 里写 `font-size: 14px` 而不是 token。

### 2.4 系统 C：Tailwind 工具类（仅 `components/robin/`）

新写的 dashboard 模块用了 Tailwind，但是是**半套**的：

[components/robin/Dashboard.tsx:44](components/robin/Dashboard.tsx:44)
```tsx
<div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
  <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
    <h1 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
```

模式很固定：**布局/间距/字号走 Tailwind，颜色一律回退到内联 `style`**。全模块 `style={{ color: "var(--...)" }}` 这类写法有 130+ 处，而 `@theme` 明明已经把它们暴露成了 `text-text` / `text-text-muted` / `text-accent`。

这直接说明：`@theme` 桥接建好了但团队不知道 / 没形成习惯。**这是最容易见效的一个修复点**。

另外 `border-t` 必须手工配 `style={{ borderColor: "var(--border)" }}`（见 `CalendarViews.tsx:148`、`SettingsPanel.tsx:256`、`GoogleConnect.tsx:79`、`WeekGrid.tsx:198`），因为 Tailwind v4 的默认边框色改成了 `currentColor`。这个也应该在 `@theme` 里一次性解决。

### 2.5 系统 D：CSS Module + 组件内 `<style>`

- [components/ChatMinimap.module.css](components/ChatMinimap.module.css)（232 行）—— 全仓库**唯一**的 CSS Module，写得最规范，但是个孤例。
- [components/AppShell.tsx:1549](components/AppShell.tsx:1549) —— 组件里直接 `<style>{\`...\`}</style>` 注入 85 行 CSS（含 keyframes、container query、媒体查询）。这段样式是全局作用域的，且随组件挂载重复插入。

---

## 3. 设计 Token 体系：现状与缺口

### 3.1 现有 token（13 色 + 1 字体）

```css
:root {                        html.dark {
  --bg          #ffffff          --bg          #1a1a1a
  --bg-panel    #f5f5f5          --bg-panel    #242424
  --bg-hover    #eeeeee          --bg-hover    #2e2e2e
  --bg-selected #e8e8e8          --bg-selected #383838
  --border      #e0e0e0          --border      #3a3a3a
  --text        #1a1a1a          --text        #e8e8e8
  --text-muted  #6b7280          --text-muted  #9ca3af
  --text-dim    #9ca3af          --text-dim    #6b7280
  --accent      #2563eb          --accent      #60a5fa
  --accent-hover#1d4ed8          --accent-hover#93c5fd
  --user-bg     #eff6ff          --user-bg     #1e293b
  --assistant-bg#ffffff          --assistant-bg#1a1a1a
  --tool-bg     #f9fafb          --tool-bg     #1f2937
  --bg-subtle   rgba(0,0,0,.03)  --bg-subtle   rgba(255,255,255,.04)
}
```

命名清晰、覆盖了主色面。**问题在于缺的那些。**

### 3.2 缺口 1：状态色（最严重）

错误/成功/警告色**完全没有 token**，全靠 tsx 里硬编码：

```
"#ef4444"  32 次   ← 错误红（亮色）
"#f87171"  24 次   ← 错误红（暗色，手工挑的第二个值）
"#dc2626"   6 次   ← 又一个错误红
"#4ade80"  19 次   ← 成功绿
"#16a34a"   8 次   ← 又一个成功绿
"#22c55e"   3 次   ← 第三个成功绿
"#d97706"   6 次   ← 警告黄
"#f59e0b"   3 次   ← 又一个警告黄
"#fff"     30 次   ← 应该是 --accent-fg
```

共 **32 个不同的十六进制值**，外加 40+ 个 `rgba(...)` 字面量（阴影、遮罩、pulse 动画）。

后果：
- 暗色模式下这些颜色**不会跟随主题**，需要在每个使用点写 `theme === "dark" ? "#f87171" : "#ef4444"` 这类判断（或者干脆没写，导致暗色下对比度不足）；
- 想调整品牌色/对比度要改 100+ 处；
- 无障碍对比度无法集中保证。

### 3.3 缺口 2：尺度 scale

| 缺失 | 现状证据 |
|---|---|
| 间距 | `padding: "8px 10px"`(18) / `"0 10px"`(9) / `"7px 10px"`(8) / `"6px 8px"`(8) / `"5px 8px"`(8) / `"6px 9px"`(7) / `"6px 10px"`(7) / `"10px 8px"`(7) ... **20+ 个不同组合**，明显是随手写的而非成体系 |
| 圆角 | `borderRadius: 9`、`5px`、`6px`、`7px`、`8px`、`999px`、`50%` 混用 |
| 字号 | 11 / 12 / 13 / 14 / 15 / 18 px 直接写数字，没有 scale |
| 阴影 | `0 2px 8px rgba(0,0,0,0)` 到 `0 20px 60px rgba(0,0,0,0.4)`，全部一次性 |
| 动效时长 | `0.12s`(大量) / `0.15s` / `0.2s` / `0.25s` / `120ms` / `180ms` / `360ms` / `620ms` / `900ms` |
| z-index | 见下 |

### 3.4 缺口 3：层级（z-index）

内联 `zIndex` 取值分布：

```
0, 1, 2, 20, 40, 60, 90, 95, 100(×5), 120(×3), 199, 200, 500(×3), 1000(×4), 1100(×2)
```

再加上 globals.css 里的 `z-index: 220`（resize handle）、`240`（backdrop）、`250`（right panel）、`100`（minimap preview）。

`199` 和 `95` 这种值说明有人在"我要盖住那个但不能盖住这个"的场景下手工试出来的。这是层级体系缺失的典型症状。

### 3.5 缺口 4：`@theme` 未承载这些

现在 `@theme` 里只桥接了颜色。间距/圆角/字号/阴影/断点全都没进去，所以即使想用 Tailwind 也用不了项目自己的尺度。

---

## 4. 布局架构（这部分是好的）

### 4.1 整体结构

```
app/layout.tsx  (RSC)
├─ <html> 主题预加载脚本（防 FOUC，layout.tsx:64）
├─ Noto_Sans_Mono via next/font（自托管，无 CLS）
└─ <body> flex column，html/body 锁死 100dvh + overflow:hidden
   │
   ├─ app/page.tsx (RSC 壳) → <Suspense><I18nProvider><AppShell/>
   │     └─ AppShell.tsx (2264 行，"use client")
   │        ├─ .sidebar-container       ← 会话侧栏 + 文件树，可拖拽
   │        ├─ .panel-resize-handle
   │        ├─ 中间列 (flex:1)
   │        │   ├─ 顶栏 36px + env(safe-area-inset-top)
   │        │   └─ ChatWindow / ModelsConfig / SkillsConfig / PluginsConfig
   │        └─ .right-panel-container   ← FileViewer + TabBar，可拖拽
   │
   ├─ app/dashboard/page.tsx (RSC 壳) → robin/Dashboard.tsx
   │     └─ 自带滚动容器（因为 body 是 overflow:hidden）
   └─ app/dashboard/settings/page.tsx → robin/SettingsPanel.tsx
```

### 4.2 面板系统（推荐保留并推广其模式）

宽度走 CSS 变量，由 [hooks/useResizablePanel.ts](hooks/useResizablePanel.ts) 在拖拽时写入：

```css
.sidebar-container.sidebar-open   { width: var(--sidebar-width, 260px); }
.right-panel-container.right-panel-open { width: var(--right-panel-width, clamp(360px, 42vw, 640px)); }
```

约束逻辑抽到了纯函数 [lib/panel-layout.ts](lib/panel-layout.ts)（`getSidebarMaxWidth` / `getRightPanelMaxWidth` / `clampPanelWidth`），**有单测、可测试、无 DOM 依赖**。这是全项目最干净的一块。

三档响应式行为（globals.css:1245–1412）：

| 视口 | 侧栏 | 右侧文件面板 |
|---|---|---|
| ≥960px | 挤压布局，width 动画 | 挤压布局，可拖拽 |
| 641–959px | 挤压布局 | **overlay + backdrop**（拖拽手柄隐藏） |
| ≤640px | fixed overlay，translateX 滑入 | 全屏 fixed |

移动端细节做得很到位：`env(safe-area-inset-*)`、`--app-viewport-height`（[hooks/useViewportHeight.ts](hooks/useViewportHeight.ts) 处理 iOS 键盘）、`interactiveWidget: "resizes-content"`、44px 最小触控目标、`font-size: 16px` 防 iOS 缩放。

### 4.3 主题切换

[hooks/useTheme.ts](hooks/useTheme.ts) + View Transitions API 做圆形擦除动画，尊重 `prefers-reduced-motion`，用 `useSyncExternalStore` 保证 SSR 安全，`layout.tsx` 里内联脚本防闪烁。**做得好，不用动。**

---

## 5. 断点：4 套定义，已产生不一致

| 来源 | 值 |
|---|---|
| `app/globals.css` | 380 / 480 / 640 / 641 / 959 / 960 |
| `lib/panel-layout.ts:1` | `MOBILE_MAX_WIDTH = 640`、`SPLIT_PANEL_MIN_WIDTH = 960` |
| `hooks/useIsMobile.ts:6` | `(max-width: 640px)` |
| Tailwind 默认 | sm=640 / md=768 / lg=1024 / xl=1280 |

`useIsMobile.ts:5` 有注释 `// Mobile breakpoint shared with app/globals.css (max-width: 640px)` —— 说明作者已经意识到这是手工同步的。

**已产生的实际不一致**：`Dashboard.tsx:73` 用 `md:grid-cols-[...]`（=768px）切换两栏布局，但应用自己的"宽屏"阈值是 960px。dashboard 在 768–959px 之间会用双栏，而同一视口下主界面的文件面板还是 overlay 模式。视觉语言不统一。

**修法**：在 `@theme` 里定义 `--breakpoint-*`，让 Tailwind、CSS、JS 三方读同一个源。

---

## 6. 组件结构与性能

### 6.1 上帝组件

| 文件 | 行数 | useState | useEffect | useCallback | 内联 SVG |
|---|---:|---:|---:|---:|---:|
| ChatInput.tsx | 2638 | 13 | 20 | 14 | 23 |
| SessionSidebar.tsx | 2314 | **30** | 17 | 18 | 27 |
| ModelsConfig.tsx | 2292 | 15 | 13 | 21 | 9 |
| AppShell.tsx | 2264 | 16 | 12 | **42** | 29 |
| MessageView.tsx | 1721 | 13 | 1 | 0 | 9 |
| FileViewer.tsx | 1541 | — | — | — | 3 |
| SkillsConfig.tsx | 1400 | — | — | — | 0 |
| ChatWindow.tsx | 1336 | 3 | 11 | 4 | 3 |

前 8 个文件 ≈ 15,500 行，占 `app/` + `components/` 的绝大部分。

`SessionSidebar` 里 30 个 `useState` 意味着任何一个状态变化都会重渲染整棵会话树 + 文件树。

### 6.2 记忆化几乎没有

全仓库 `memo` / `React.memo` 只有 4 处（ChatWindow 2、MessageView 1、MermaidBlock 1、ChatMinimap 1）。

考虑到 `MessageView` 是 1721 行且在长会话里要渲染几百条消息，每条消息还挂着 markdown 解析 + 代码高亮 —— **这是最大的运行时性能风险点**。已有 `lib/chat-lazy-load.ts` 说明作者做过分页尝试，可以在此基础上加 `memo` + 稳定 props。

### 6.3 内联 SVG 重复

130 个内联 `<svg>`，散落各处，同一个图标（关闭、复制、齿轮、chevron）在多个文件里各画一遍。没有 icon 组件层。

### 6.4 Client / Server 边界

37 个 tsx 里 **32 个是 `"use client"`**。5 个 server component 全是 3–5 行的路由壳：

```tsx
export default function DashboardPage() {
  return <Suspense><I18nProvider><Dashboard /></I18nProvider></Suspense>;
}
```

`I18nProvider` 在 client 侧从 localStorage 读 locale（见 `app/dashboard/page.tsx` 注释），所以整棵树被迫下沉到 client。对于本地开发工具这可以接受，但意味着 **RSC 的收益一点没拿到**。

### 6.5 代码分割：零

`grep next/dynamic | React.lazy` → **0 结果**。

首屏（`/`）client bundle 直接包含：

| 依赖 | 引入位置 | 备注 |
|---|---|---|
| `mermaid` ^11.14 | MermaidBlock.tsx | 极大，只在渲染 mermaid 代码块时需要 |
| `react-syntax-highlighter` (Prism) + `vs` + `vscDarkPlus` | MermaidBlock.tsx:4、FileViewer.tsx:8 | 两个主题都静态 import |
| `react-markdown` + remark-gfm/math + rehype-katex/raw/sanitize | MarkdownBody / ChatMinimap / FileViewer | |
| `katex/dist/katex.min.css` | **layout.tsx:4 全局引入** | 所有页面都吃，包括 `/dashboard` |
| `@lobehub/icons` × 31 个 provider 图标 | ModelsConfig.tsx:20-49 | 逐个静态 import，而 ModelsConfig 是个模态框 |
| `mammoth` | （docx 预览） | |

`ModelsConfig.tsx` 是弹窗才打开的配置面板，却把 31 个厂商图标静态打进首屏。

---

## 7. 其他观察

**好的**：
- 208 处 `aria-*` / `role=`，`:focus-visible` outline 在 CSS 里统一处理，键盘快捷键有专门 hook；
- i18n 体系完整（`lib/i18n/messages/{en,zh-CN}.ts` 各 590 行，`translate()` 全覆盖）；
- `prefers-reduced-motion` 在 4 处被尊重；
- 测试覆盖不错（组件旁边有 `.test.mjs`，含布局相关的 `MobilePwaLayout.test.mjs`、`AppShell.mobile-toolbar.test.mjs`）。

**要注意的**：
- `.next` 目录 944MB（含 dev 缓存，正常，但没有 bundle 体积基线）；
- 没有 stylelint；ESLint 只有 `eslint-config-next` 默认规则，不会拦截内联样式或硬编码色值。

---

## 8. 优化方案（按 ROI 排序）

### 阶段 0 — ✅ 已完成（2026-08-16）

实际落地内容见本节下方，与最初草案有两处修正：

1. **`--default-border-color` 不存在。** Tailwind v4 的 `--default-*` 命名空间只有 transition 和 font-family（见 `node_modules/tailwindcss/theme.css:492-499`）。改用官方推荐的 `@layer base` 通用规则。已确认全仓库没有任何元素依赖 `currentColor` 边框，改动安全。
2. **`@theme` 里的变量会被摇树。** Tailwind 只发出被某个 utility 引用到的 `@theme` 变量，未被引用的直接不输出——手写 CSS 里 `var(--radius-panel)` 会静默失效。所以所有 token 的**值都声明在 `:root`**，`@theme` 只做别名，与既有的 `--text-muted` / `--color-text-muted` 写法一致。断点是唯一例外（媒体查询需要字面量）。

改动文件：`app/globals.css`、`lib/panel-layout.ts`、`hooks/useIsMobile.ts`、`components/robin/{Dashboard,SettingsPanel}.tsx`，删除 `tailwind.config.ts`。
验证：659 个测试全通过、tsc 无错、独立 PostCSS 编译确认 token 在明暗两套主题下都解析正确、浏览器实测 960px 断点生效。

> 注：本地 `next dev`（PID 3062）在编辑期间输出过一次**部分陈旧**的 CSS —— `:root` 是新的、`html.dark` 还是旧的。源码无误，独立编译结果正确，重启 dev server 即可。

---

### 阶段 0 原始方案（供参考）

**0.1 删除 `tailwind.config.ts`**
它不生效且会误导。

**0.2 补齐 `@theme`，把缺口一次性填上**

```css
@theme {
  /* 已有颜色桥接保留 */
  --color-bg: var(--bg);
  /* ... */

  /* 新增：状态色（替换 32 个硬编码 hex） */
  --color-danger: var(--danger);
  --color-danger-soft: var(--danger-soft);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-on-accent: var(--on-accent);

  /* 新增：Tailwind v4 默认边框色 = currentColor，改掉它
     ⚠️ 此写法无效，实际实现改用 @layer base 通用规则，见上方修正 1 */
  --default-border-color: var(--border);

  /* 新增：断点，与 lib/panel-layout.ts 对齐 */
  --breakpoint-mobile: 641px;
  --breakpoint-split: 960px;

  /* 新增：圆角/阴影/时长 scale */
  --radius-sm: 5px;  --radius-md: 7px;  --radius-lg: 9px;
  --shadow-panel: 0 10px 28px rgb(0 0 0 / 0.10);
  --shadow-overlay: -12px 0 32px rgb(0 0 0 / 0.18);
}

:root {
  --danger: #dc2626;      --danger-soft: #ef4444;
  --success: #16a34a;     --warning: #d97706;
  --on-accent: #ffffff;
}
html.dark {
  --danger: #f87171;      --danger-soft: #ef4444;
  --success: #4ade80;     --warning: #f59e0b;
  --on-accent: #0b1220;
}
```

设完之后 `border-t` 不用再手配 `borderColor`，`text-danger` / `bg-danger/10` 直接可用。

**0.3 定义 z-index 常量层**

```css
@theme {
  --z-base: 0;      --z-sticky: 100;   --z-resize: 220;
  --z-backdrop: 240; --z-panel: 250;   --z-popover: 500;
  --z-modal: 1000;  --z-toast: 1100;
}
```
把 `zIndex: 199` / `95` 这类魔数换掉。

**0.4 写一份 `docs/styling.md` 约定**：新代码只准用 Tailwind 工具类 + token；内联 style 仅限"运行时计算值"（拖拽宽度、虚拟滚动 offset、动态 top）。

### 阶段 1 — 高 ROI（1–2 天）

**1.1 消灭 JS hover（64 处 `onMouseEnter` + 156 处 `currentTarget.style`）**

这是修复"触屏卡 hover"和"重渲染丢样式"两个真实 bug，同时删掉几百行代码。做法：把这些按钮抽成 3–4 个共享组件（`IconButton` / `ToolbarButton` / `MenuItem`），交互态全部走 CSS：

```tsx
// components/ui/IconButton.tsx
export function IconButton({ size = 24, ...props }) {
  return <button className="ui-icon-button" data-size={size} {...props} />;
}
```
```css
.ui-icon-button { color: var(--text-muted); transition: background .12s, color .12s; }
.ui-icon-button:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
.ui-icon-button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.ui-icon-button:disabled { opacity: .35; cursor: default; }
@media (hover: none) { .ui-icon-button:hover { background: none; } }  /* 触屏不卡 hover */
```

`globals.css` 已经有 `.file-viewer-icon-button`（898–1009 行）几乎一模一样的实现——把它提升成通用组件即可，不用从零写。

**1.2 `robin/` 模块颜色改用 token 工具类**

130+ 处 `style={{ color: "var(--text-muted)" }}` → `className="text-text-muted"`。纯机械替换，`@theme` 已经就绪。做完后 `components/robin/` 变成"纯 Tailwind"的样板，供后续迁移参照。

**1.3 代码分割**

```tsx
const MermaidBlock = dynamic(() => import("./MermaidBlock").then(m => m.MermaidBlock), { ssr: false });
const ModelsConfig = dynamic(() => import("./ModelsConfig").then(m => m.ModelsConfig));
const SkillsConfig = dynamic(() => import("./SkillsConfig").then(m => m.SkillsConfig));
const PluginsConfig = dynamic(() => import("./PluginsConfig").then(m => m.PluginsConfig));
const FileViewer = dynamic(() => import("./FileViewer").then(m => m.FileViewer));
```

- 三个 Config 面板（合计 4783 行 + 31 个图标）都是弹窗触发，100% 该懒加载；
- `katex.min.css` 从 `layout.tsx` 移到实际用到的组件；
- `react-syntax-highlighter` 的两个主题改成按当前 theme 动态 import；
- `next.config.ts` 加 `experimental.optimizePackageImports: ["@lobehub/icons"]`。

先跑一次 `ANALYZE=1 next build` 建立体积基线。

**1.4 统一断点单一来源**

`lib/panel-layout.ts` 作为 SSOT，`@theme` 的 `--breakpoint-*` 与之对齐，`useIsMobile` 从常量读，globals.css 用 `@media (width <= theme(--breakpoint-mobile))`。同时把 `Dashboard.tsx` 的 `md:` 改成项目自己的 `split:` 断点。

### 阶段 2 — 中期（1–2 周，可增量）

**2.1 建立 `components/ui/` 原语层**

`Button` / `IconButton` / `Panel` / `Dialog` / `Field` / `Badge` / `Menu` / `Tooltip` / `Icon`。不引 UI 库，就用 Tailwind + token 自建，保持现在的视觉。这一步是后续所有迁移的前提。

**2.2 抽 Icon 组件**

130 个内联 SVG → `components/ui/icons.tsx`，去重后估计 30–40 个。单独文件便于将来换 sprite。

**2.3 拆分 globals.css**

```
app/styles/
  tokens.css      (@theme + :root + html.dark)
  base.css        (reset, html/body, scrollbar)
  markdown.css    (.markdown-body 全家)
  panels.css      (sidebar / right-panel 响应式)
  extensions.css  (.extension-widget-*)
```
`globals.css` 只留 `@import`。顺便清掉 25 处 `!important`（它们大多在内联样式被移除后自然消失）。

**2.4 拆分上帝组件**

优先级：`SessionSidebar`（30 个 state）> `ChatInput`（2638 行）> `ModelsConfig`（188 处内联样式）。
按"每个子面板一个文件 + 状态提到 reducer 或 zustand"来切。**注意：这几个文件都有配套测试，拆分时以测试为安全网。**

**2.5 长列表性能**

`MessageView` 加 `memo` + 稳定 key，配合已有的 `lib/chat-lazy-load.ts`；如果长会话仍卡，上虚拟滚动（`@tanstack/react-virtual`）。

### 阶段 3 — 长期（可选）

- **迁移策略**：不要"大重构"。定规则——**碰到哪个文件就把那个文件迁到 Tailwind + ui 原语**，配合 ESLint 规则渐进收紧（先 warn `react/forbid-dom-props: style`，白名单已迁移目录）。
- **RSC 边界**：把 locale 从 localStorage 挪到 cookie，`I18nProvider` 就能在 server 侧确定语言，dashboard 页面可以做成真正的 RSC。
- **加 stylelint**，禁止裸 hex 色值。
- **视觉回归测试**：项目已有 Browser 预览工具链，可以加几个关键布局的截图快照。

---

## 9. 建议的执行顺序

```
第 1 天   0.1 删死配置 → 0.2 补 @theme token → 0.3 z-index 层 → 0.4 写约定文档
第 2–3 天 1.3 代码分割（体积收益最直观，先建基线）
第 4–5 天 1.1 IconButton/ToolbarButton 抽取，消灭 JS hover
第 6 天   1.2 robin 模块颜色 token 化 + 1.4 断点统一
之后      2.x 按模块增量推进，每次改动只碰当前在做的文件
```

阶段 0 + 1 大约 1 周，能拿到：**首屏 bundle 显著下降、触屏 hover bug 消失、暗色模式状态色正确、新代码有明确写法**。阶段 2 之后再谈组件拆分，风险最低。

---

## 10. 附：关键文件索引

| 关注点 | 文件 |
|---|---|
| Token / 主题 / 全局样式 | [app/globals.css](app/globals.css) |
| Tailwind 死配置（建议删） | [tailwind.config.ts](tailwind.config.ts) |
| 应用外壳 / 三栏布局 | [components/AppShell.tsx:1547](components/AppShell.tsx:1547) |
| 面板宽度约束（纯函数，好） | [lib/panel-layout.ts](lib/panel-layout.ts) |
| 拖拽实现 | [hooks/useResizablePanel.ts](hooks/useResizablePanel.ts) |
| 断点 JS 侧 | [hooks/useIsMobile.ts:6](hooks/useIsMobile.ts:6) |
| 移动端视口高度 | [hooks/useViewportHeight.ts](hooks/useViewportHeight.ts) |
| 主题切换 + View Transition | [hooks/useTheme.ts](hooks/useTheme.ts) |
| Tailwind 用得最多的模块 | [components/robin/](components/robin/) |
| 唯一 CSS Module（好样板） | [components/ChatMinimap.module.css](components/ChatMinimap.module.css) |
| 组件内注入 CSS（应外移） | [components/AppShell.tsx:1549](components/AppShell.tsx:1549) |
| 重依赖静态 import | [components/ModelsConfig.tsx:20](components/ModelsConfig.tsx:20)、[components/MermaidBlock.tsx:4](components/MermaidBlock.tsx:4) |
| 全局 katex CSS | [app/layout.tsx:4](app/layout.tsx:4) |
