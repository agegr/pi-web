# 计划栏 + 引擎栏：工作流、UI/UX 与开关机制深度分析

> 状态：调研完成，待决策
> 关联：`components/PlanPanel.tsx`(1497行)、`components/EngineDashboard.tsx`(783行)、`lib/agent-orchestrator/*`(18文件)、`lib/unified-engine/*`(26文件)、`lib/plan-mode-store.ts`、`lib/engine-runtime-store.ts`、`lib/extensions/builtin.tsx`、`app/api/plan/*`(13路由)、`app/api/engine/*`
> 并列文档：[`PROMPTS-PANEL-PLAN.md`](./PROMPTS-PANEL-PLAN.md)

---

## 一、工作流全景：一条「规划 → 自主执行」流水线

```
PlanPanel（多 Agent 协同讨论）
  发起需求 → POST /api/plan/orchestrate → createOrchestrator
    → SSE /api/plan/[id]/events（实时讨论时间线）
    → 多 Agent 轮次 → 综合推荐方案（confidence 排序）
  用户选/改/重议 → POST confirm
    ├─ 普通模式：方案文档落盘
    └─ 引擎模式：setRequestOpenEngine(true) → 切 EngineDashboard
                    ↓
EngineDashboard（autoplan 自主编程引擎）
  方案作 autoplan 输入 → design→build→verify→archive
  SSE /api/engine/stream → 拉取 /api/engine/state → engine-runtime-store → 切片渲染
  三看板：ProcessMonitor / RequirementLifecycleBoard / TaskStatusBoard
  per-run 详情：StageStepper + 任务 + 控制(start/pause/resume) + 日志
```

- **Plan 状态机**：`idle→parsing→discussing→synthesizing→awaiting_confirm→[awaiting_clarify|executing]→done/failed/cancelled`，带 `resumableOrchestratorId`（退出暂存）+ 服务端 history（刷新恢复）+ 15s 对账。
- **Engine 状态**：`EnginePhase = idle|planning|discussing|executing|done|error`；stage 映射 `archive→delivered / verify→executing / build→converged / open·design→discussing`；`isEngineStateEquivalent` 幂等比较防抖。

---

## 二、Plan 诊断：🔴 发起链路断裂（疑似孤岛，与提示词栏同病）

### 2.1 决定性证据

| grep                                    | 结果                                                           | 含义                                          |
| --------------------------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| `planMode`（排除 plan-mode-store/test） | **零外部读写**                                                 | 没有任何组件读/写 planMode 做分流             |
| `planMode` in ChatInput / AppShell      | **零命中**                                                     | 底部输入框完全不感知计划模式                  |
| `orchestrate` in `components/`          | **零调用**                                                     | 前端没有任何代码 POST `/api/plan/orchestrate` |
| `setPlanMode(true)` 全项目              | **零调用**（仅 PlanPanel 内部 3 处 `setPlanMode(false)` 退出） | **无进入 Plan 模式的入口**                    |
| `/plan` slash / enterPlan / togglePlan  | **零命中**                                                     | 无 slash 命令、无按钮、无 toggle              |

**推论**：planMode 恒为初始 `false` → PlanPanel 永远走 `!orchestratorId` 引导分支 → 引导界面提示「输入框已在底部统一接管需求录入」，但 ChatInput 不感知 planMode → 发消息走普通 agent → **讨论永远不会被发起**。后端 `orchestrate` route + `createOrchestrator` 完整存在，却无前端调用方。

这与提示词栏的「建好未通电」**同源**——PlanPanel 内部逻辑（SSE 订阅、confirm、rediscuss、history 恢复）齐全，但缺最关键的「进入 + 发起」一根线。`stashResumable`/`resumeOrchestrator` 提示它曾被接通过，疑在某次跟随上游重构时入口被拆掉。

> ✅ **代码调用链已闭环坐实**（第二轮深读补证）：
>
> - `setOrchestratorId` 全项目仅 PlanPanel 调用，唯一「设值」是 `:594` 从 `/api/plan/history` **恢复历史编排**——只能消费旧数据，不能新建。
> - PlanPanel 调 10 个 API（roles/config/history/log/snapshot/events/select/confirm/export/models），**唯独不含 orchestrate**。
> - PlanPanel 引导界面无输入框（唯一 `<input>` 在 1248 行 ConfigSection，是配置非需求）；注释「底部统一接管」与 ChatInput 零感知 plan **矛盾** → 接管从未实现。
> - `orchestrate` 全项目仅出现在后端 route + store 注释，前端零调用。
>
> **结论**：消费端齐全（订阅/选/确认/导出/恢复），**生产端彻底断裂**（无入口、无发起、orchestratorId 只能从空 history 恢复）。用户进 Plan tab → 空引导界面 + 空 history → 无法做任何事。比提示词栏更彻底（提示词栏至少 UI 能交互存状态）。
>
> 运行时 double-check（可选）：启动 dev → 进 Plan tab 发消息 → 观察网络请求是否走 `/api/plan/orchestrate`（预期：否，走普通 `/api/agent/[id]`）。

### 2.2 次要问题

- **1497 行巨型组件**：引导/配置/时间线/方案/恢复/log 全挤一文件。`docs/component-splitting-strategy.md` 本就把它列为待拆。
- **pros/cons 双栏 grid**（1083行）：324px 栏里两栏各 ~150px，Markdown 列表换行惨烈。

---

## 三、Engine 诊断

### 3.1 🔴 根容器尺寸错配（与提示词栏 ConfigModal 同源）

```tsx
// EngineDashboard.tsx:400 根容器
<div style={{
  width: "min(1120px, 94vw)",     // 桌面端 = 1120px
  height: "min(78vh, 760px)",      // 固定视窗高
  padding: 14, ...
}}>
```

被 WorkspacePanelsHost 塞进 340px 栏（内容区 ~324px）：

- 横向溢出（1120 vs 324）。
- `isMobile` 兜底失效：三栏 grid `isMobile ? "1fr" : "1fr 1fr 1fr"`，但 `useIsMobile()` 看窗口宽度，桌面开侧栏时窗口仍宽 → `false` → 三栏在 324px 每栏 ~100px，挤爆。
- 高度 `min(78vh,760px)` 不填满侧栏 `flex:1` 内容区，底部留白或溢出。

### 3.2 🔴 `engine.run.*` / `engine.stage.*` 动态 i18n 键全缺（与 `promptOpt.category.*` 同 bug）

代码（EngineDashboard:112/196）：

```tsx
{t(`engine.run.${status}`)}                    // status: running/completed/failed/paused...
{t(`engine.run.${p.status}`)} · {t(`engine.stage.${p.stage}`)}  // stage: open/design/build/verify/archive
```

grep `engine.run.` / `engine.stage.` 整个 `lib/i18n/`（含 messages 子目录）：**零命中**。全部 fallback 显示英文键名（`engine.run.running`、`engine.stage.build`）。

### 3.3 🟡 comet 依赖降级缺口

- `vendor/comet/` 存在；`lib/unified-engine/guards/comet-cli.ts:115` 用 `existsSync(.../comet-guard.mjs)` 探测。
- 但探测结果**没反馈到 tab 注册**——builtin 无条件注册 engine 面板，comet 缺失时 Engine tab 照样显示，点进去才报错。

### 3.4 🟡 其他

- 错误信息硬编码中文（`创建失败：${status}` / `操作失败：${status}`，347/365），i18n 漏网。
- 三看板 + StageStepper 全在 783 行单文件内，未拆分。

---

## 四、共性问题

| 问题                 | 影响                                                                                                          | 根因                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **零面板开关机制**   | 5 个 tab 全部无条件注册，用户无法隐藏不需要的面板                                                             | `builtin.tsx` 硬编码；无 feature flag / disabledPanels / 偏好 |
| **CSS 变量未定义**   | `--git-added/moderated/deleted`、`--accent-text`、`--color-warning`、`--color-error-soft` 在 globals.css 全缺 | `.zcode/plans` 计划过但未落地                                 |
| **动态 i18n 键缺失** | promptOpt.category / engine.run / engine.stage 全 fallback 键名                                               | 动态 `t(\`x.${var}\`)`+`as never` 绕过类型检查                |
| **配色硬编码**       | Plan `COLOR_DOT` hex、Engine `#64748b` 等                                                                     | 未走主题变量                                                  |

---

## 五、「增加开关」方案（用户点名的提升点）

### 5.1 必要性

Plan（多 Agent 编排，耗 token）/ Engine（自主编程，依赖 comet + node-pty）是重型功能，多数用户用不到。强制常驻 5 个 tab 既占空间，又让用户面对用不了/不想用的入口。

### 5.2 设计：面板可见性偏好 + 依赖降级

```
设置面板（SettingsPanel）新增「工作区面板」分组
  └ 每个面板一个开关（todo/inspector/prompts/plan/engine）
     默认：todo/inspector/on；prompts/plan/engine 可默认关（按成熟度）
     持久化：localStorage（与 theme/lang 同级）

builtin.tsx 注册时：
  1. 读用户偏好 → 过滤 workspacePanels
  2. 依赖探测：engine 需要 comet-guard.mjs existsSync → 不在则强制不注册
     prompts 需要 prompt-system（恒在）→ 不探
  3. plan 当前发起链路断裂 → 标记 experimental，默认关，或注册但带「开发中」徽标
```

### 5.3 实现路径（最小侵入）

- 新建 `hooks/usePanelPrefs.ts`（localStorage + useSyncExternalStore，仿 useTheme）。
- `lib/extensions/builtin.tsx`：`registerBuiltinExtensions()` 读偏好 + 依赖探测，条件 push 面板。
- `SettingsPanel` 加「工作区面板」配置区。
- 改动全在 pi-web 独有文件，零上游冲突。

---

## 六、落地优先级

| 优先级 | 项                                                                              | 价值                                         | 风险             |
| ------ | ------------------------------------------------------------------------------- | -------------------------------------------- | ---------------- |
| **P0** | globals.css 补 `--git-*`/`--accent-text`/`--color-warning`/`--color-error-soft` | 一处救四面板（Plan/Engine/Prompt/Inspector） | 零               |
| **P0** | 补 `engine.run.*`/`engine.stage.*`/`promptOpt.category.*` 动态 i18n 键          | 修可见 bug（键名乱码）                       | 零               |
| **P0** | Engine 根容器嵌入式改造（`width/height:100%`、三栏 grid 常驻单栏）              | Engine 从「溢出不可用」→「可用」             | 低（纯样式）     |
| **P1** | 面板开关机制（5.2/5.3）                                                         | 用户可控、重型功能按需、依赖降级             | 低（独有文件）   |
| **P1** | 运行时验证 Plan 发起链路是否真断；若断 → 决定接通 or 标实验性                   | 澄清 Plan 定性                               | —                |
| **P2** | Plan pros/cons 窄栏纵向堆叠                                                     | 局部可读性                                   | 低               |
| **P2** | PlanPanel / EngineDashboard 拆子组件                                            | 维护性                                       | 中（大文件重构） |
| **P3** | 配色硬编码 → CSS 变量                                                           | 主题一致性                                   | 低               |

---

## 七、上游同步评估

- Plan/Engine 全套 lib（agent-orchestrator / unified-engine）已是 pi-web 独有，列在 UPSTREAM-SYNC「我们独有文件（merge 零冲突）」。
- 依赖的上游接口（`ModelRegistry`/`ModelRuntime`/`SettingsManager`/`getAgentDir`/`completeSimple`）漂移时，按现有流程在我们独有文件内适配即可。
- 面板开关、i18n 补键、CSS 变量、Engine 根容器改造**全部在独有文件**，不碰上游共享核心，merge 零冲突。
- 唯一需跟上游：无（本批改动不依赖上游私有结构，与提示词栏的 systemPrompt 注入不同）。

---

## 附：调研关键事实索引

- Plan 孤岛证据：`grep planMode`（零外部读写）、`grep orchestrate components/`（零调用）、ChatInput/AppShell 不感知 planMode。
- Engine 尺寸错配：`EngineDashboard.tsx:400`（width/height 固定）、`useIsMobile` 看窗口宽度。
- Engine i18n 缺键：`EngineDashboard.tsx:112/196` 动态 `t(\`engine.run.${}\`)`，`lib/i18n/` 零定义。
- comet 降级：`lib/unified-engine/guards/comet-cli.ts:115` existsSync 探测，结果未反馈注册。
- 面板开关：`lib/extensions/builtin.tsx` 无条件注册，零 feature flag。
- CSS 变量缺：`app/globals.css` :root/html.dark 仅 15 变量，无 `--git-*` 等。
