# 计划栏 + 引擎栏：上游友好的「接入工作」方案

> 状态：方案定稿，待实施
> 目的：在不改动上游 pi、merge 零冲突的前提下，把 Plan（孤岛）接通、Prompt（死功能）接通、Engine（通电但有 bug）修好。
> 前置调研：[`PLAN-ENGINE-PANEL-ANALYSIS.md`](./PLAN-ENGINE-PANEL-ANALYSIS.md)（诊断）、[`PROMPTS-PANEL-PLAN.md`](./PROMPTS-PANEL-PLAN.md)（提示词栏接通+重构）
> 上游约束：见 [`UPSTREAM-SYNC.md`](./UPSTREAM-SYNC.md)——改动只在「我们独有文件」，漂移时加 `// —— 跟随上游适配` 注释。

---

## 一、三栏现状快照（2026 调研结论，代码调用链已验证）

| 面板       | 定性                                    | 证据                                                                                                  |
| ---------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **提示词** | 死功能：UI 能点、状态能存、不影响 agent | `composeModularAgentsMdSystemPrompt`/`buildEnhanceSystemPrompt` 零调用；开关状态仅 modules API 读写   |
| **计划**   | 孤岛：消费端齐全，生产端彻底断裂        | `setPlanMode(true)` 零调用；`orchestrate` 前端零调用；`setOrchestratorId` 唯一设值是从空 history 恢复 |
| **引擎**   | 通电但有 3 bug                          | SSE→store→切片真实数据流；根容器固定尺寸错配、engine.run/stage i18n 缺键、comet 降级缺口              |

---

## 二、Plan 接通方案（重点，最上游友好）

### 2.1 为什么 Plan 最上游友好

Plan 的**整条链都是 pi-web 自建**：

| 环节   | 位置                                                                                | 上游耦合                                                                                 |
| ------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 入口   | `components/ChatInput.tsx` BUILTIN_SLASH_COMMANDS + `onBuiltinCommand`              | 零（pi-web 独有）                                                                        |
| 发起   | POST `/api/plan/orchestrate` `{requirement, cwd?, config?, mock?}` → `{id, status}` | 零（pi-web 独有 route，已完整）                                                          |
| 接管   | `setOrchestratorId(id)` → PlanPanel 自动订阅 SSE                                    | 零（plan-mode-store + PlanPanel 独有）                                                   |
| 编排器 | `lib/agent-orchestrator/*`                                                          | 仅 `ModelRuntime`/`ModelRegistry`/`completeSimple`（**公开 API**，UPSTREAM-SYNC 已登记） |

**核心**：orchestrator 用 `completeSimple`（`@earendil-works/pi-ai/compat`）做 LLM 单轮补全，是**独立于主 agent systemPrompt 的旁路**——完全不碰 systemPrompt，上游怎么改 systemPrompt 都不影响 Plan。这是比 Prompt 接通更上游友好的根本原因。

### 2.2 接通三步（全在 pi-web 独有文件）

```ts
// ① ChatInput.tsx:168 附近，BUILTIN_SLASH_COMMANDS 追加
{ command: "/plan", description: "plan.cmd", source: "builtin" }

// ② AppShell 的 onBuiltinCommand 加 /plan 分支（或抽 lib/plan-starter.ts）
if (msg.startsWith("/plan")) {
  const requirement = msg.replace(/^\/plan\s*/, "").trim();
  const { id } = await fetch("/api/plan/orchestrate", {
    method: "POST",
    body: JSON.stringify({
      requirement,
      cwd: activeCwd,
      config: { controllerMode },   // 可留空，走默认 hybrid
    }),
  }).then(r => r.json());
  setPlanMode(true);       // 进入计划模式（plan-mode-store）
  setOrchestratorId(id);   // PlanPanel 自动接管：SSE/时间线/选方案/确认/导出全部激活
}

// ③（可选）planMode 下底部输入免 /plan 前缀：
//   ChatInput.handleSend 非 slash 分支：if (planMode && !msg.startsWith("/")) → 同上发起
```

- **后端零改动**：`app/api/plan/orchestrate/route.ts` 已完整（createOrchestrator + createRoleAwareRunner + orch.start()）。
- **消费端零改动**：PlanPanel 拿到 orchestratorId 后自动工作（已有 SSE/confirm/select/export/history 逻辑）。

### 2.3 为什么不妨碍上游

1. 改动文件全是 pi-web 独有（ChatInput/AppShell/plan-mode-store/lib/plan-starter），merge 零冲突。
2. 唯一上游依赖是公开 API（ModelRuntime/ModelRegistry/completeSimple），漂移可控。
3. 不碰 systemPrompt（completeSimple 旁路）。
4. 后端零改。

### 2.4 接通必须同步解决的 UI 交接断点（代码复核新确认）

除了 2.2 的三步，Plan→Engine 完整流程还有 3 处 UI 断点（复核 `requestOpenEngine`/`activeId`/`planMode` 消费链后确认）：

| #   | 环节                      | 证据                                                                              | 修复                                   |
| --- | ------------------------- | --------------------------------------------------------------------------------- | -------------------------------------- |
| 3   | 发起后切到 Plan tab       | `WorkspacePanelsHost.activeId` 是内部 `useState`，外部无法切换                    | 见下方「面板控制层」                   |
| 4   | 讨论中底部输入补充需求    | `planMode` 在 useAgentSession/ChatWindow 零感知；`orchestrate` 无「追加需求」接口 | 设计决策：讨论中禁用底部输入或明确提示 |
| 5   | confirm 后交接 Engine tab | `setRequestOpenEngine(true)` 设信号但**零消费点**（全项目无组件读取）             | 见下方「面板控制层」                   |

**根因**：`WorkspacePanelsHost` 是封闭组件——`activeId` 不外露、可见性无条件、无通知通道。「增加开关」是更大主题「**面板控制层**」的切片。

**架构建议（三合一）**：新建 `lib/panel-controller.ts`（globalThis store，仿 agent-runtime-store）：

- `navigate(panelId)`：切 tab（/plan 发起→plan；confirm→engine），WorkspacePanelsHost 的 activeId 提权到 controller 并监听
- `visibility`：开关偏好 + comet 降级（builtin 注册时读）
- 通知：讨论结束/引擎执行完 → 侧栏徽标
- `requestOpenEngine` 死信号由 `navigate("engine")` 取代
- 全在 pi-web 独有文件，零上游冲突

---

## 三、Prompt 接通方案（简引，详见 PROMPTS-PANEL-PLAN.md）

- 关键透传口：`CreateAgentSessionServicesOptions.resourceLoaderOptions`（`core/agent-session-services.d.ts`）。
- `rpc-manager.ts:1321` createAgentSessionServices 调用处加 `resourceLoaderOptions: getPromptModuleLoaderOptions(cwd)`。
- `getPromptModuleLoaderOptions`：总闸关返回 `{}`；开返回 `{ agentsFilesOverride }`（AGENTS.md 按开关裁剪，复用 `composeAgentsMd`）。
- 上游友好：全部公开契约，零 parse systemPrompt 字符串。

---

## 四、Engine 修 bug 清单（已通电，无需「接入」）

| bug                                       | 修复                                                                                                                                     | 文件                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 根容器固定尺寸错配                        | `width:min(1120px,94vw);height:min(78vh,760px)` → `width:100%;height:100%;minHeight:0`；三栏 grid 常驻单栏（侧栏恒窄，去 isMobile 分支） | `EngineDashboard.tsx:400`                       |
| `engine.run.*`/`engine.stage.*` i18n 缺键 | 补 `lib/i18n/ours-messages.ts`（中英各一）                                                                                               | 动态键 `t(\`engine.run.${status}\`)` 在 112/196 |
| 错误信息硬编码中文                        | `创建失败`/`操作失败` → i18n                                                                                                             | 347/365                                         |
| comet 降级缺口                            | `builtin.tsx` 注册 engine 前 `existsSync(comet-guard.mjs)` 探测，缺失不注册                                                              | `builtin.tsx` + `guards/comet-cli.ts:115`       |

---

## 五、实施顺序（P0 → P1 → P2）

```
P0 零风险打底（可合并，与提示词栏阶段 1.4 重合）
  ├─ globals.css 补 --git-added/--git-modified/--git-deleted/--git-untracked/--accent-text/--color-warning/--color-error-soft
  ├─ 补 engine.run.*/engine.stage.*/promptOpt.category.* 动态 i18n 键
  └─ Engine 根容器嵌入式改造

P1 接通 + 开关
  ├─ Plan 接通三步（2.2）
  ├─ 面板开关机制：usePanelPrefs（localStorage+useSyncExternalStore，仿 useTheme）
  │     builtin.tsx 注册时读偏好过滤 + comet 探测降级
  │     Plan/Prompt 接通前默认关（孤岛/死功能不暴露）·Engine 默认开
  └─ 运行时验证 Plan 断裂（可选 double-check：进 Plan tab 发消息看是否走 /api/plan/orchestrate）

P2 Prompt 接通（方案已就绪，3.2）+ 打磨
  ├─ resourceLoaderOptions 注入（rpc-manager）
  └─ P3 打磨：Plan pros/cons 窄栏、巨型组件拆分、配色统一
```

---

## 六、未决事项 / 交接给下一个 LLM 的检查点

1. **onBuiltinCommand 当前分发需确认**：AppShell 里 onBuiltinCommand 怎么处理 builtin 命令（/plan 挂载点是否干净，是否抽独立 lib/plan-starter.ts 更稳）。
2. **ChatInput.handleSend 分流**：③ 的 planMode 分流是否本轮做（不做则每次 /plan 前缀）。
3. **Plan/Prompt 接通前默认关 vs 先接通**：决策点——建议 Plan 直接接通（三步太轻），Prompt 接通前默认关。
4. **运行时 double-check**：Plan 孤岛结论代码层已闭环，运行时验证可选。
5. **PlanPanel 1497 行拆分**（P3 维护性，`docs/component-splitting-strategy.md` 已列为待拆）。
