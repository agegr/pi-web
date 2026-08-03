# 待办/概览清理与 Git 面板归一：方案定稿

> 状态：方案定稿；**P-1（window.React 基础设施修复）单独立项先行**
> 目的：消除 Todo/Inspector 的功能重复、死按钮、未接通能力；归一 Git 面板（解决 inspector 与 git-status 扩展的三方冲突）；接通任务点击跳转；接回 TodoBadge；**修复浏览器侧扩展加载链路的根本缺陷**。全程上游友好（零共享核心改动）。
> 关联：[`PANELS-UX-WALKTHROUGH.md`](./PANELS-UX-WALKTHROUGH.md)、[`PLAN-ENGINE-INTEGRATION.md`](./PLAN-ENGINE-INTEGRATION.md)、[`UPSTREAM-SYNC.md`](./UPSTREAM-SYNC.md)
> 上游约束：改动只在「pi-web 独有文件」，漂移时加 `// —— 跟随上游适配` 注释。

---

## 一、现状诊断（代码已逐行核实）

### 1.1 待办展示：四个组件，两个活的、两个死的

| 组件                    | 数据源                                | 实际渲染？              | 跳转能力                         | 判定                          |
| ----------------------- | ------------------------------------- | ----------------------- | -------------------------------- | ----------------------------- |
| `TodoPanel`             | `/api/task-list`（只读 tasks）        | ✅ 面板 tab             | ❌ 无                            | 正常但与 inspector 任务区重复 |
| `InspectorPanel` 任务区 | `/api/task-list`（读 tasks+entryIds） | ✅ 面板 tab             | ⚠️ 代码完整但 `onTaskClick` 未接 | 重复 + 跳转失效               |
| `TodoBadge`             | `/api/task-list`                      | ❌ **从未挂载**（孤儿） | ❌                               | 死代码                        |
| `TodoSidebar`           | `/api/task-list`                      | ❌ **从未挂载**（孤儿） | ❌                               | 死代码                        |

> 四者各自独立 fetch 同一接口，四份 `TodoTask` 接口定义 + 四份 reload 逻辑 + 四份 `useTodoLiveRefresh` 订阅。

### 1.2 InspectorPanel：活的能力 + 一堆死交互

| 元素                                          | 可用？    | 证据                                                                        |
| --------------------------------------------- | --------- | --------------------------------------------------------------------------- |
| Git 变更统计（+/-/modified/staged/untracked） | ✅        | `/api/git-diff` 10s 轮询                                                    |
| 分支选择器                                    | 🔴 死按钮 | `InspectorPanel.tsx:664` 无 `onClick`                                       |
| commit / push 按钮                            | 🔴 死按钮 | `InspectorPanel.tsx:729` 无 `onClick`                                       |
| pin（常驻）                                   | 🟡 半失效 | `onToggle` 空函数；tab 容器已接管显隐                                       |
| 收起态 pill                                   | 🔴 死路径 | `open` 恒 `true`，永不渲染                                                  |
| 任务点击跳转                                  | 🔴 未接   | `builtin.tsx` 没传 `onTaskClick`，底层 `useMessageScroll` 也没接 ChatWindow |

> branch/commit 死按钮处置依据：`grep 'git commit|git push|git checkout|git switch|git add' app/api/ lib/` → 零匹配。项目无 git 写操作基础设施；pi 是 coding agent，git 操作应由 agent 用工具完成。正确形态是「注入 prompt 让 agent 提交」。

### 1.3 跳转链路：三处断点

```
useMessageScroll(现成) ─断点①─▶ ChatWindow 没调用它(message DOM 没注册)
                                  ─断点②─▶ AppShell 没暴露 scrollToEntry
                                                            ─断点③─▶ WorkspacePanelContext 没有 scrollToEntry 通道
                                                                                    ──▶ 面板 onTaskClick = ()=>{}
```

底层 hook、数据（`entryIds`）、`InspectorTaskRow`（连测试）全齐，就差接三节。**注意**：`InspectorTaskRow` 的点击反馈 class `task-row-clicked` 无 CSS 规则（见 1.6），反馈视觉失效。

### 1.4 Git 信息现存三方重叠（核心冲突）

| 信息                           | git-status 扩展                         | InspectorPanel      | FileExplorer  |
| ------------------------------ | --------------------------------------- | ------------------- | ------------- |
| 分支名                         | ✅ `/api/extensions/git-status` + label | ✅ `/api/git-diff`  | ❌            |
| modified/staged/untracked 计数 | ✅ **完全相同**                         | ✅                  | ✅ 文件级着色 |
| +/- 行数                       | ❌                                      | ✅ **（唯一独有）** | ❌            |
| 面板 order                     | **100（排最前）**                       | 1200                | —             |

inspector 相比 git-status 扩展，**唯一独有信息是「+/- 行数统计」**。两套并行数据源：`/api/git-diff` vs `/api/extensions/git-status`。

### 1.5 已有「面板治理」基础设施（可复用）

| 设施         | 位置                                          | 现状                          |
| ------------ | --------------------------------------------- | ----------------------------- |
| 面板控制层   | `lib/panel-controller.ts`（globalThis store） | ✅ navigate/badges/visibility |
| 面板开关 UI  | `SettingsPanel`「工作区面板」5 个 ToggleRow   | ✅                            |
| 实时刷新     | `hooks/useTodoLiveRefresh.ts`                 | ✅                            |
| 运行时 store | `lib/agent-runtime-store.ts`                  | ✅                            |
| 跳转底层     | `hooks/useMessageScroll.ts`                   | ✅ 写好未接                   |

### 1.6 两个新发现的隐藏 bug（核实确认）

**Bug-A：`window.React` 从未被挂载（见 §九 H1，已升级为确定根因）** — 浏览器侧扩展加载链路全断。

**Bug-B：`task-row-clicked` 视觉反馈失效** — `InspectorTaskRow.tsx:51/53` 正确 add/remove class，但 grep 全项目 `.css` 无 `.task-row-clicked` 规则；测试 `InspectorTaskRow.test.tsx:140-190` 只断言 class 名、未断言视觉 → 测试过但反馈无效。TodoPanel 复用 InspectorTaskRow 前必须补 CSS。

---

## 二、依赖关系原则（硬约束）

**核心原则：builtin 面板（inspector/TodoPanel）零依赖任何可选扩展。**

```
inspector(Git UI)  ──零依赖──▶  git-status 扩展（可选，卸了不影响）
        │
        └──数据──▶ /api/git-diff（pi-web 独有 route，系统 git）

TodoPanel(任务)  ──零依赖──▶  git-status 扩展
        │
        └──数据──▶ /api/task-list ──软依赖──▶ @juicesharp/rpiv-todo（上游插件，自动装，空降级）

git-status 扩展 ──软依赖──▶ inspector（action 切 tab；inspector 关了→降级，不报错）
```

- inspector 完全自包含（builtin 注册与扩展加载是两条平行链路）。
- 正确依赖方向：git-status 扩展软依赖 inspector，不是反过来。
- TodoPanel 软依赖 rpiv-todo（数据层，空降级），不依赖任何 pi-web 扩展。

---

## 三、方案 C：inspector 升格 + git-status 扩展降级

### 3.1 三条技术路径裁决

| 路径                     | 做法                                              | 可行性                                        |
| ------------------------ | ------------------------------------------------- | --------------------------------------------- |
| A. 扩展 import inspector | git-status render 里 `import { InspectorPanel }`  | ❌ webpackIgnore 运行时外部模块，无 `@/` 别名 |
| B. inspector UI 搬进扩展 | `window.React.createElement` 重写 1367 行         | ❌ 不支持 JSX、要重写所有 hooks/API           |
| **C. 职责重分配**        | inspector 升格为唯一 Git 面板；扩展降级为「入口」 | ✅ **最优**                                   |

C 优于 B'-1（删 inspector）：复杂 UI 留在 inspector（打包 React），扩展只做擅长的 action+label。

### 3.2 职责终态

```
┌─ inspector（builtin 面板，打包 React）─────────── 唯一 Git 面板 UI ─┐
│  +/- 行数、modified/staged/untracked 计数（/api/git-diff）         │
│  10s 轮询 + "Xs ago" 刷新指示 + 分支名（纯展示）                    │
│  P2: 点统计 → 文件级 diff 展开；title 改 "Git"                      │
│  删任务区 + 所有死按钮                                              │
└──────────────────────────────────────────────────────────────────────┘
┌─ git-status 扩展（window.React，轻量）────────── 入口，不渲染面板 ─┐
│  actions: "Show Git Status" → run: navigate("inspector")          │
│  workspaceLabels: 会话列表分支名                                   │
│  workspacePanels: ❌ 删除                                          │
└──────────────────────────────────────────────────────────────────────┘
┌─ TodoPanel ── 唯一任务中心（接跳转，见 §六）─┐  ┌─ FileExplorer ── 不动 ─┐
│  进度环 + 三态 + scrollToEntry              │  │ 文件树 git 着色保留     │
└─────────────────────────────────────────────┘  └─────────────────────────┘
```

数据源统一：`/api/git-diff` 成唯一 git 数据源；`/api/extensions/git-status` 可删/转发。

---

## 四、完整工作流（落地后）

```
① 一眼看进度：顶栏 TodoBadge "☑ 2/5"（接回顶栏）
② 管理任务：TodoPanel tab → 点任务 → scrollToEntry 跳聊天现场
③ 看代码影响：Git tab（=inspector）→ +/- 行数 + 文件级展开
④ 快捷入口：Cmd+K "Show Git Status" → 切到 Git tab（git-status 扩展 action）
⑤ 会话定位：会话列表分支名（git-status 扩展 label）
```

四载体零信息重叠：badge=概数、todo=任务清单、inspector=代码面、FileExplorer=文件树。

---

## 五、跳转通道技术设计（P1 核心）

### 5.1 命令通道与渲染状态分离（关键陷阱）

`agent-runtime-store.update()` 用 `JSON.stringify` 深比较判断 notify。函数不可序列化（`JSON.stringify(fn)`===`undefined`），故 `scrollToEntry` **不进 snapshot**，作 imperative 命令通道：

```ts
class AgentRuntimeStore {
  private snapshot: AgentRuntimeSnapshot = ...;   // 渲染状态（原样）
  private scrollToEntryFn: ((id: string) => void) | null = null;  // 命令通道（新增，不 notify）
  setScrollToEntry(fn) { this.scrollToEntryFn = fn; }
  scrollToEntry(id) { this.scrollToEntryFn?.(id); }
}
```

### 5.2 落地点（MessageView 无 data-entry-id，用 register ref）

- `MessageView.tsx` 无 `data-entry-id`（entryId 只作 prop/key）；
- `ChatWindow.tsx:845` 有现成包裹 div `<div ref={attachVisibleRef(idx, currentRefIdx)}>`，`entryIds[idx]` 在手边；
- 改造：`attachVisibleRef` 叠加 `register(entryIds[idx], el)`；
- 虚拟滚动外的消息由 `useMessageScroll` fallback 兜底。

### 5.3 完整链路（AppShell 零改）

```
ChatWindow: useMessageScroll() → register/scrollTo；包裹 div ref 叠加 register；
            useEffect 注册 scrollTo 到 runtime store，卸载注销。
WorkspacePanelsHost: active.render({ ..., scrollToEntry: store.scrollToEntry })
builtin.tsx TodoPanel: render: (ctx) => <TodoPanel onTaskClick={ctx.scrollToEntry} />
```

---

## 六、TodoPanel 重塑产品级设计（方案 C 后唯一任务中心）

### 6.1 重塑后 UI 规格

```
┌──────────────────────────────────────────┐
│ 待办  ◔(进度环)  2/5            ↻ 刷新   │  标题栏：标题+进度环+计数+刷新
├──────────────────────────────────────────┤
│ ▾ 进行中 (1)                              │  分组(可折叠)
│   ● 任务A  ⟳ 正在重构跳转逻辑        ↗   │  activeForm 脉冲 + 跳转箭头
│      [点击整行 → scrollToEntry]           │
├──────────────────────────────────────────┤
│ ▾ 待办 (2)                                │
│   ○ 任务B                                 │
│   ○ 任务C  ⛔ 依赖: 1                     │  blockedBy 可视化
├──────────────────────────────────────────┤
│ ▸ 已完成 (2)                       [显示] │  默认折叠
└──────────────────────────────────────────┘
   空状态：让 agent 创建待办（引导文案）
```

### 6.2 五个提升点（每个都有现成资产）

| 提升       | 现状           | 重塑后                   | 资产来源                                                                  |
| ---------- | -------------- | ------------------------ | ------------------------------------------------------------------------- |
| 进度环     | 仅文字 `(2/5)` | 标题栏环形进度           | inspector 的 `ProgressRing`（方案C后 inspector 删任务区不再需要，直接搬） |
| 点击跳转   | ❌ 无          | 整行可点 → scrollToEntry | `onTaskClick` 从 ctx 注入                                                 |
| 跳转反馈   | —              | 点击高亮渐隐             | **补 `.task-row-clicked` CSS**（Bug-B）                                   |
| activeForm | 纯文字         | 脉冲动画 `⟳`             | `inspector-pulse` keyframes（从 inspector 内联搬全局）                    |
| 行组件     | 自写 `TodoRow` | 复用 `InspectorTaskRow`  | 已有 + 带测试                                                             |

### 6.3 用户旅程（五者首次闭环）

```
① agent 调 todo 工具建 3 任务 → 顶栏 TodoBadge "☑ 0/3" 亮起；TodoPanel 三行
② agent 开始任务1 → in_progress + activeForm="正在分析 ChatWindow"
   → TodoPanel 任务1 脉冲；用户点任务1 → 聊天滚到 agent 工作现场（scrollToEntry）
③ agent 完成任务1 → 进度环 1/3，任务移入"已完成"折叠组
④ 全部完成 → TodoBadge 变绿 "☑ 3/3"
⑤ 用户切 Git tab（=inspector）→ 看 +/- 行数确认改动范围
```

### 6.4 落地代码级

| 文件                           | 改动                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `components/TodoPanel.tsx`     | 加 `onTaskClick` prop；标题栏加 `ProgressRing`；任务行换 `InspectorTaskRow`；删 `TodoSection`/`TodoRow` |
| `app/globals.css`              | **补 `.task-row-clicked` 规则**（Bug-B）+ `@keyframes inspector-pulse`（从 inspector 内联搬全局）       |
| `lib/extensions/builtin.tsx`   | TodoPanel render 传 `onTaskClick={ctx.scrollToEntry}`                                                   |
| `components/ui/MiniToggle.tsx` | 从 PromptsConfig 抽出通用开关（三点菜单 L2 用）                                                         |

---

## 七、开关体系

| 层级                | 控制什么     | 位置                        | 现状                                  |
| ------------------- | ------------ | --------------------------- | ------------------------------------- |
| L1 显示开关（已有） | tab 是否出现 | SettingsPanel「工作区面板」 | ✅ todo/inspector/prompts/plan/engine |
| L2 功能开关（新增） | 组件内子功能 | 各面板三点菜单              | ❌ 待加                               |

L2 候选：TodoBadge 显隐（独立于 todo tab）、git 轮询开关、已完成默认折叠。L2 用抽出的 `MiniToggle`（`role=switch`+`aria-checked`，无障碍合规）+ `usePersistentState`（localStorage）。git-status 扩展无面板后不需进 PanelId 开关。

---

## 八、上游友好性核对

| 改动                                             | 文件                                                                | 风险                    |
| ------------------------------------------------ | ------------------------------------------------------------------- | ----------------------- |
| **P-1：挂 window.React**                         | `hooks/useExtensions.ts` 模块顶层（独有）                           | 🟢                      |
| inspector 删任务区/死按钮，专注 Git，title→"Git" | `components/InspectorPanel.tsx`（独有）                             | 🟢                      |
| git-status 扩展删 panel、改 action、留 label     | `extensions/git-status/index.ts`+重编 `index.js`（独有）            | 🟢                      |
| agent-runtime-store 加 scrollToEntry 命令通道    | `lib/agent-runtime-store.ts`（独有）                                | 🟢                      |
| WorkspacePanelContext 加 scrollToEntry           | `lib/extensions/types.ts`（独有）                                   | 🟢                      |
| TodoPanel 重塑 + ProgressRing 搬入               | `components/TodoPanel.tsx`（独有）                                  | 🟢                      |
| 补 `.task-row-clicked` + `inspector-pulse` CSS   | `app/globals.css`（独有）                                           | 🟢                      |
| 抽 MiniToggle                                    | `components/ui/MiniToggle.tsx`（独有新增）+ PromptsConfig 改 import | 🟢                      |
| TodoBadge 接回顶栏                               | `components/TodoBadge.tsx`+`AppShell` 插一行                        | 🟢🟡                    |
| ChatWindow register ref + 注册 effect（~3 行）   | `components/ChatWindow.tsx`（共享核心）                             | 🟡 增量，带跟随上游注释 |
| 抽 lib/todo-types.ts + hooks/useTodoTasks.ts     | 独有新增                                                            | 🟢                      |
| 删 TodoSidebar.tsx                               | 孤儿死代码                                                          | 🟢                      |

全 🟢 + 2 处 🟡 增量最小侵入。

---

## 九、待验证假设 → 已确认根因

### H1（已升级为**确定根因**）：`window.React` 从未被挂载

- **证据**：全项目搜 `window.React =` / `window.ReactDOM =` / `globalThis.React =` 的**赋值** → **零结果**。`window.React` 仅出现在「读取」处（`git-status/index.js:2`、`index.ts:7`、`types.ts:126` 注释）。
- **后果链**：`var React = window.React` → `React=undefined` → `activate()` 内 `React.createElement` 抛 TypeError → 被 `useExtensions.loadExtensions` 的 catch 吞掉 → `console.warn` → 不注册。**git-status 扩展（及所有依赖 window.React 的浏览器侧扩展）从未加载成功**。
- **文档不一致**：AGENTS.md 声称"AppShell 暴露 window.React/window.ReactDOM"——**过时，代码从未实现**。
- **影响范围**：不只是 git-status，**整个浏览器侧扩展加载链路是断的**（含未来用户自装 local 扩展）。

### H1 修复方案（P-1，已定为单独立项）

**落点**：`hooks/useExtensions.ts` **模块顶层**（加载扩展的唯一入口，独有文件，零冲突）。

```ts
// hooks/useExtensions.ts 顶部（"use client" 之后、其他 import 之前）
import * as React from "react";
if (typeof window !== "undefined") {
  // 扩展运行时用 window.React 创建元素；必须在 loadExtensions() 之前挂好。
  // 本模块是扩展加载的唯一入口，模块加载早于 loadExtensions 调用，时机正确。
  (window as unknown as { React: typeof React }).React = React;
}
```

**为何此落点最优**：

1. 独有文件，零上游冲突 🟢；
2. 时机正确——`useExtensions` 被 `WorkspacePanelsHost` import 时模块顶层先执行，早于任何 `loadExtensions()` 调用；
3. 职责内聚——扩展 React 挂载与扩展加载同处一个模块。

**实验 E1（验证）**：浏览器开 pi-web + DevTools Console。

- 成功信号：Console 不再有 `[extensions] Failed to load "git-status"`；Cmd+K 出现 "Show Git Status" action；会话列表出现分支名 label。
- 失败信号：仍 warn → 根因另寻（URL 404 / activate 内部错），回收堆栈。

### Bug-B（确认）：`task-row-clicked` 无 CSS 规则

- `InspectorTaskRow.tsx:51/53` add/remove class，但全项目 `.css` 无对应规则 → 点击无视觉反馈。
- 测试 `InspectorTaskRow.test.tsx:140-190` 只断言 class 名 → 通过但反馈失效。
- 修复：`globals.css` 补 `.task-row-clicked { background: var(--bg-hover); transition: background 0.15s; }`（P0）。

### E2：方案 C 后的回归

- 面板列只有一个 Git tab（=inspector）；Cmd+K "Show Git Status" 切到它；会话列表有分支名。

---

## 十、分阶段实施（P-1 单独立项 → P0-P3）

### P-1 基础设施修复（单独立项先行，全局收益）

> 收益远超本方案：修复后**所有浏览器侧扩展**（含未来用户自装）才能加载。即使不做 Todo/Inspector 清理，这个 bug 也该修。

```
└─ hooks/useExtensions.ts 模块顶层挂 window.React（见 §九 修复方案）
   验证：E1（Console 无 warn + Cmd+K 有 action + 会话列表有分支名）
   闸门：tsc + eslint + test:node + test:coverage 全绿
```

### P0 清债（纯清理/抽取，行为可预期）

```
├─ 修 Bug-B：globals.css 补 .task-row-clicked + @keyframes inspector-pulse（从 inspector 内联搬）
├─ 抽 components/ui/MiniToggle.tsx（从 PromptsConfig，L2 开关用）
├─ 删 TodoSidebar.tsx（孤儿）
├─ inspector 删任务区/死按钮/pin/收起pill，专注 Git，title→"Git"
├─ git-status 扩展删 workspacePanels，action.run→navigate("inspector")，保留 label
├─ 重编 extensions/git-status/index.js
└─ 抽 lib/todo-types.ts + hooks/useTodoTasks.ts 收敛重复
```

### P1 接通跳转 + TodoPanel 重塑

```
├─ agent-runtime-store 加 scrollToEntry 命令通道（不进 snapshot）
├─ ChatWindow register ref + 注册/注销 effect（增量，带注释）
├─ types.ts WorkspacePanelContext 加 scrollToEntry?
├─ WorkspacePanelsHost ctx 注入
├─ builtin.tsx TodoPanel 传 onTaskClick
└─ TodoPanel 重塑（进度环 + InspectorTaskRow + 跳转 + activeForm 脉冲，见 §六）
```

### P2 增强 + 开关

```
├─ inspector 文件级 diff 展开（扩 /api/git-diff 加 files）
├─ TodoBadge 接回顶栏（AppShell 1526-1645 区，🟡 增量一行）
├─ inspector「让 agent 提交」按钮（注入 prompt，非直接 git）
├─ L2 功能开关（TodoBadge 显隐 / git 轮询 / 已完成折叠，用 MiniToggle）
└─ 删/转发 /api/extensions/git-status（数据源统一）
```

### P3 打磨

```
├─ 跨面板联动（任务进行中 + 有未提交 → inspector 提醒）
├─ i18n 键补全（lib/i18n/ours-messages.ts 中英）
├─ 测试补全（含 task-row-clicked 视觉断言）
└─ 更新本文档「已实施」状态
```

---

## 十一、决策记录

| #      | 决策                                                            | 依据                                                                 |
| ------ | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| D1     | 职责划分：方案 C（inspector=唯一 Git 面板，TodoPanel=任务中心） | git-status 扩展是正牌 Git tab；inspector 用打包 React 写复杂 UI 更易 |
| D2     | branch/commit 死按钮 → P0 删除                                  | 项目零 git 写操作基础设施；正确形态是注入 prompt                     |
| D3     | TodoBadge 保留并接回顶栏                                        | 顶栏常驻进度徽标是好 UX；visibility 开关已有                         |
| D4     | 跳转走 agent-runtime-store 命令通道，AppShell 零改              | 最上游友好；函数不进 snapshot（JSON.stringify 陷阱）                 |
| D5     | git-status 扩展降级（删 panel，留 action+label），不删除        | label 有独立价值；保留扩展 demo；软依赖 inspector 不反向             |
| D6     | inspector/TodoPanel 零依赖可选扩展                              | builtin 核心面板原则；卸载扩展不得破坏核心功能                       |
| **D7** | **P-1（window.React）单独立项先行**                             | 全局基础设施缺陷，断了所有浏览器侧扩展；收益远超本方案，独立可合并   |

---

## 附：关键证据索引

- `lib/extensions/builtin.tsx` — builtin 面板注册；inspector `open` 恒 true、`onToggle` 空函数
- `components/InspectorPanel.tsx:664/729` — branch/commit 死按钮（无 onClick）
- `components/WorkspacePanelsHost.tsx:190-191` — `requestRender`/`state` 空壳注入
- `hooks/useMessageScroll.ts` — 跳转底层（现成未接）
- `components/ChatWindow.tsx:845` — 包裹 div ref 落点
- `lib/agent-runtime-store.ts` — `update()` JSON.stringify 深比较（函数陷阱）
- `app/api/task-list/route.ts` — 已返回 entryIds（跳转数据就绪）
- `app/api/git-diff/route.ts` — inspector 数据源（无 files 字段，P2 扩展）
- `extensions/git-status/index.ts:145/170` — workspacePanels("Git") + workspaceLabels
- `extensions/git-status/index.js:2` — `var React = window.React`（H1 根因读取点）
- `hooks/useExtensions.ts` — **H1 修复落点**（模块顶层挂 window.React）+ `loadExtensions` catch 吞错
- `lib/extensions/discovery.ts:188` — `buildManifest` 返回 git-status
- `lib/panel-controller.ts` — PanelId 不含 git-status（扩展面板不受 SettingsPanel 开关管）
- `lib/recommended-plugins.ts` — rpiv-todo 自动安装（TodoPanel 数据软依赖）
- `components/InspectorTaskRow.tsx:6/51/53` — `TASK_ROW_CLICKED_CLASS`（Bug-B，无 CSS）
- `components/InspectorTaskRow.test.tsx:140-190` — 只断言 class 名，未断言视觉（Bug-B 测试盲区）
- `components/PromptsConfig.tsx:497` — `MiniToggle`（待抽到 components/ui/）
- `app/globals.css:25-64` — CSS 变量双套（明/暗），TodoPanel 重塑着色资源齐备
- `app/globals.css` 无 `.task-row-clicked` / `inspector-pulse`（Bug-B + 待搬动效）
