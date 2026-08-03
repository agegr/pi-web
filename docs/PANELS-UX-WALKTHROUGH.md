# 三栏接通后：完整体验走查与 UX 设计

> 状态：A（面板控制层 + Plan 接线）已实施并通过 tsc/eslint；B 为体验走查与待办清单
> 关联：[`PLAN-ENGINE-INTEGRATION.md`](./PLAN-ENGINE-INTEGRATION.md)、[`PLAN-ENGINE-PANEL-ANALYSIS.md`](./PLAN-ENGINE-PANEL-ANALYSIS.md)、[`PROMPTS-PANEL-PLAN.md`](./PROMPTS-PANEL-PLAN.md)

---

## 一、A 阶段已落地（本次实施）

| 文件                                      | 内容                                                                                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/panel-controller.ts`（新）           | globalThis 单例：`navigate(id)`（切 tab，持久化 localStorage）、`badges`（徽标）、`visibility`（开关偏好）、`engineAvailable`（comet 探测回填）；`usePanelController()` hook |
| `app/api/engine/available/route.ts`（新） | comet 探测（复用 `isCometAvailable`），供面板列决定是否显示 Engine tab                                                                                                       |
| `lib/plan-starter.ts`（新）               | `startPlanDiscussion(requirement, {cwd})` → POST `/api/plan/orchestrate`                                                                                                     |
| `components/WorkspacePanelsHost.tsx`      | activeId 提权到 controller；按 `visibility`+`engineAvailable` 过滤；tab 徽标；navigate 切换                                                                                  |
| `hooks/useAgentSession.ts`                | `handleBuiltinSlashCommand` 加 `case "plan"`：发起讨论 → `setPlanMode(true)`+`setOrchestratorId(id)`+`navigate("plan")`                                                      |
| `components/PlanPanel.tsx`                | confirm 两处 `setRequestOpenEngine(true)` → `navigate("engine")`（废除死信号）                                                                                               |
| `components/ChatInput.tsx`                | BUILTIN_SLASH_COMMANDS 加 `/plan`                                                                                                                                            |
| `lib/i18n/messages/{en,zh-CN}.ts`         | 加 `chat.commandPlan`（带本地增强注释）                                                                                                                                      |

验证：tsc exit 0；eslint 0 errors（仅 2 个既有 warning）；vitest 17/18 文件通过（唯一失败 `PinCurrentDirButton.test.tsx` 经 stash 隔离确认为**既有失败**，与本次改动无关）。

---

## 二、Plan 接通后完整体验走查

```
① 用户输入 /plan <需求>（或 planMode 下底部输入，见 D1）
② useAgentSession case "plan" → startPlanDiscussion
   → POST /api/plan/orchestrate → { id }
   → setPlanMode(true) + setOrchestratorId(id)
   → navigate("plan") ← 自动切到 Plan tab（已实现）
③ PlanPanel 订阅 SSE → 实时讨论时间线（多 Agent 轮次）
④ 讨论结束（awaiting_confirm）→ 推荐方案（confidence 排序）+ 最终横幅
   └ ⚠️ T1（待做）：此状态变化时 bumpBadge("plan")，用户切走也能知道讨论结束
⑤ 用户选方案 → confirm（POST /confirm）
   ├ 普通模式：方案文档落盘 → 提示 docPath
   └ 引擎模式：navigate("engine") ← 已实现，切到引擎面板
```

### 体验断点 / 待办

- **T1 徽标触发**：PlanPanel 的 snapshot.status 变 `awaiting_confirm`/`done` 时 `getPanelController().bumpBadge("plan")`（当前未接线——用户讨论结束无感知）。
- **T2 讨论中补充需求**：planMode 激活时底部输入走普通 agent（orchestrate 无"追加需求"接口）。设计决策见 D1。
- **T3 讨论恢复**：已有（resumableOrchestratorId + history 卡片）；refresh 后 navigate 持久化保证回到上次 tab。

---

## 三、Engine 体验走查

```
① 进入：Plan confirm（navigate("engine")）或 EngineDashboard 手动创建（title+cwd+启动）
② 三看板：ProcessMonitor / RequirementLifecycleBoard / TaskStatusBoard
   └ ⚠️ P0 待修：根容器 width:min(1120px,94vw) 在 340px 栏溢出；三栏 grid 需常驻单栏
③ 点 run → per-run 详情：StageStepper + 任务 + 控制(start/pause/resume) + 日志
   └ ⚠️ P0 待修：engine.run.*/engine.stage.* i18n 键缺（显示键名）；错误硬编码中文
④ 执行完成（done）→ ⚠️ T4（待做）：bumpBadge("engine")
```

### 待办

- **T4 徽标触发**：EngineDashboard 状态变 `done`/`error` 时 `bumpBadge("engine")`。
- **comet 降级**：已实现 tab 隐藏（engineAvailable=false）；若 confirm 后 navigate("engine") 但 tab 被隐藏 → fallback 第一个可见面板 + 建议 notice 提示"引擎不可用"（见 D3）。

---

## 四、Prompt 接通后体验走查（P2 待做，方案见 PROMPTS-PANEL-PLAN.md）

```
① 用户开总闸（agentsMdModular）→ rpc-manager resourceLoaderOptions 注入（P2）
② 面板：模块列表（按来源分组）→ 开关
③ 详情：压缩 / LLM 精炼 / 重置 + 原文/压缩对比
④ 动态预览：输入需求 → 看选中哪些模块
```

- P2 前：面板默认关（visibility.prompts=false，已实现）；P2 接通后改默认 true。

---

## 五、UX 设计决策记录

- **D1 planMode 下底部输入分流**：orchestrate 无"追加需求"接口 → 建议 planMode 激活时 ChatInput 显示"计划模式"提示，输入走 `/plan` 语法（新讨论）或禁用，避免用户以为在补充当前讨论。
- **D2 徽标触发点**：PlanPanel `awaiting_confirm`/`done`、EngineDashboard `done`/`error` 时 `bumpBadge`；进入 tab 时 `clearBadge`（WorkspacePanelsHost 已实现 clear）。
- **D3 navigate 到不可见面板**：navigate("engine") 时若 engine 被隐藏（comet 缺失/开关关）→ WorkspacePanelsHost fallback 到第一个可见面板；调用方（PlanPanel confirm）应加 notice"引擎未启用"。
- **D4 面板开关 UI**：建议 SettingsPanel 加"工作区面板"分组（每个面板一个 MiniToggle，调 `setVisible`）；或面板列底部齿轮。默认值见 panel-controller DEFAULT_VISIBLE（prompts/plan 接通前默认关）。

---

## 六、后续待办（按优先级）

```
P0（✅ 已实施，2026 接续轮）
  ├─ ✅ globals.css 补 --git-added/--git-modified/--git-deleted/--git-untracked/--accent-text/--color-warning/--color-error-soft（:root + html.dark 两套）
  ├─ ✅ 补 engine.run.*(5)/engine.stage.*(5)/engine.task.*(5)/promptOpt.category.*(9) 中英 i18n 键；promptOpt.previewResult 改 {selected}/{saved} 插值（PromptsConfig 同步改 t()）
  └─ ✅ Engine 根容器嵌入式（width/height:100% + 单栏 grid + boardTab 恒显，删除 useIsMobile）

P1（✅ 徽标接线 + 开关 UI 已实施，2026 接续轮）
  ├─ ✅ T1/T4 徽标接线：PlanPanel SSE 事件（awaiting_confirm/done，且不在 plan tab）→ bumpBadge("plan")；EngineDashboard phase（done/error，且不在 engine tab）→ bumpBadge("engine")；进入 tab 自动 clearBadge
  ├─ ✅ D4 面板开关 UI：SettingsPanel 新增「工作区面板」分组（5 个 ToggleRow → panel-controller.setVisible，i18n settings.workspacePanels）
  └─ ✅ D1 讨论中输入提示：ChatInput 感知 planMode（usePlanMode），讨论中（planMode&&orchestratorId）在输入框上方显示提示条（chat.planModeHint）

P2（Prompt 接通 ✅ + 面板重构 进行中，2026 接续轮）
  ├─ ✅ Prompt 接通：新建 lib/prompt-loader-options.ts（getPromptModuleLoaderOptions：总闸关返回 {}，开返回 { agentsFilesOverride 复用 composeAgentsMd }）；rpc-manager createAgentSessionServices 加 resourceLoaderOptions。源头注入，不 parse systemPrompt，上游友好
  ├─ ✅ S1 静默刷新：load 默认 silent=true（toggle/compress/reset 后不闪 loading），初始 load(false) 显示骨架
  └─ ✅ 面板重构：PromptsConfig 重写为单栏主从切换（去 ConfigModal 外壳/死按钮/重复标题；配色硬编码 → CSS 变量；MiniToggle 加 role=switch/aria-checked；列表行原生 div 替代 ConfigListRow；加 common.back i18n 键）

P3（打磨）
  ├─ ✅ Plan pros/cons 窄栏纵向堆叠（grid 1fr）
  ├─ ✅ 配色硬编码 → CSS 变量（P0 补变量 + P2 PromptsConfig 重构已做）
  ├─ ✅ 默认开放：DEFAULT_VISIBLE prompts/plan → true（功能已接通）
  └─ ✅ PlanPanel 拆分（阶段A）：抽 Slider/PlanList/LogHistorySection/ConfigSection 到 components/plan/，主文件 1507→1249 行（-258）。阶段B（render 区块 Guide/方案卡片）风险中，可选

✅ 运行时验证发现并修复（prompt-system 数据流缺陷）：原 /api/prompts/modules GET 返回 0 模块。根因：① enhance-modules 零 import（registerModules 永不触发）；② API 不传 cwd（读不到项目 AGENTS.md）。修复：modules route 顶部 `import enhance-modules`（副作用注册）+ GET(req) 读 cwd query + gatherManagedModules(cwd)/findManagedModule(id,cwd) 透传 + 前端 fetch 带 cwd。验证：modules 0→39（5 app enhance + 34 项目 AGENTS.md），tsc 0/test:node 315 pass。
```

---

## 附：本次实施的验证证据

- `tsc --noEmit` exit 0
- `eslint` 0 errors（仅既有 487/488 warning）
- `npm test`（vitest）：17/18 文件、164/169 测试通过；`PinCurrentDirButton.test.tsx` 失败经 `git stash -u` 隔离重跑**依然失败** → 既有失败，非本次改动引入
- git stash pop 已恢复全部改动
