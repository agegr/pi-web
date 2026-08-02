# 上游同步与本地专属层约定

> 适用分支：`feat/merge-upstream-v086`（已对齐 `agegr/main` v0.8.6 / SDK `0.83.0`）。
> 本文档定义"如何低成本跟随上游更新"，避免每次上游发布都做大规模冲突迁移。

## 核心原则

**不要把本地独有功能写进上游会重写的共享核心文件。**
跟随上游的成本，取决于我们的改动落在哪些文件：

| 落点                                                                                          | 跟随上游成本                   |
| --------------------------------------------------------------------------------------------- | ------------------------------ |
| `app/components`、`hooks/useAgentSession`、`lib/rpc-manager`、`lib/session-reader` 等共享核心 | 高（必然冲突，需整批语义调和） |
| `ours/`（专属层）+ 上游已有扩展挂载点（`lib/extensions`、`lib/i18n/registry`）                | 低（几乎零冲突）               |

因此：本地增强一律走 **专属层 + 上游扩展接口**，不直接改共享核心。

## 专属层 `ours/`

`tsconfig.json` 已将 `ours` 排除出编译（不参与应用构建）。该目录用于**暂存尚未适配上游的本地功能源码**，是"解耦改造"的过渡收容所。

当前收容：

- `ours/api-legacy/`：`token-usage`、`agents-md/optimize` 两个路由，依赖 SDK `0.83.0` 已移除的
  `AuthStorage` / `ModelRegistry.create`，待"中文 i18n 外挂化 / 面板扩展化"阶段适配后，
  要么改写为扩展面板 + 独立 api（移回 `app/api`），要么删除。

> 注意：`ours/` 下的文件**不会**被 tsc / Next 编译，仅保留源码供后续接回，请勿在此直接写会被路由或组件引用的代码。

## 中文 / 本地增强翻译键（i18n 外挂化）

上游 i18n 采用 `registry.ts` + `messages/{en,zh-CN}.ts` 的 `LocalePlugin` 架构，**不允许同一 `id` 重复注册**，
因此无法在不改上游文件的前提下补充同语言键。我们的处理：

- 运行时注入：新建 `~lib/i18n/ours-messages.ts`，从旧译文目录恢复出本地增强键
  （`settings.*`、`inspector.*`、`prompts.*`、`webSearch.*`、`extensions.*`、`mcp.*`、
  `subagents.*`、`todo.*`、`error.*`、`tokenUsage.*`、`sidebar.*` 等共 ~143 个），
  在 `app/layout.tsx` 顶部 `import "@/lib/i18n/ours-messages";` 触发，通过
  `Object.assign(plugin.messages, extra)` 注入到上游已注册的 `enLocale` / `zhCNLocale`。
- 直接补键：少量被测试覆盖的 `sidebar.*` 键直接写入上游 `messages/en.ts` / `messages/zh-CN.ts`
  （带 `// —— 本地增强补充键` 注释标记），便于 grep。

**跟随上游时**：若上游更新了 `messages/*`，只需重新挑出"本地增强键"缺失项补回
`ours-messages.ts`（或直接补到 messages 文件），无需改动其它核心。

## 面板 / 命令类增强（已扩展化）

`InspectorPanel`、`TodoPanel`、`PlanPanel`、`EngineDashboard`、`PromptsConfig` 等纯 UI 增强，
**已挂载到上游 `lib/extensions` 的 `workspacePanels` / `actions` 贡献点**（见 commit `79a47a3` 挂载缝 +
三个接回提交）:

- 挂载缝：`lib/extensions/builtin.tsx` 注册内置面板为 extension（workspacePanels）；
  `components/WorkspacePanelsHost.tsx` 消费 `getWorkspacePanels()` 渲染独立可收起面板列；
  `AppShell` 仅一处引入 `WorkspacePanelsHost`，保持近乎 100% 上游。
- `PromptsConfig` 同时注册为 Cmd+K `actions`（`open-prompts`）。
- **`getWorkspacePanels()` 上游本身不被 UI 消费（空壳），该缝是我们补的**，上游 merge 不会触碰。

> 注意：这些面板文件均为我们独有文件，上游 `8c51f77` 删除过但 `agegr/main` 从未合入——
> 跟随上游 merge 时它们不会被上游改写，冲突≈零，仅 SDK/API 接口漂移需在我们独有文件内适配。

## 接回面板跟随上游（接口依赖清单）

接回的三块功能（Prompts / Plan / Engine）均从旧提交 `4a21feb` 取回源码、按 HEAD 基础层重接线。
**每次 `git merge agegr/main` 后必须跑 `npm run ci`**，若因 SDK/上游 lib 接口漂移编译失败，
仅在我们独有文件内适配（加 `// —— 跟随上游 X 适配` 注释），不修改上游共享核心。

| 面板    | 我们独有文件（merge 零冲突）                                                                                                                                                                                                                                       | 依赖的上游接口（漂移风险点）                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompts | `lib/prompt-system/*`、`lib/prompt-modules-state.ts`、`lib/pi-model-creds.ts`、`app/api/prompts/*`、`components/PromptsConfig.tsx`                                                                                                                                 | `validateCsrf`（`@/lib/csrf`）、`api-utils` 的 `errorResponse`/`safeJsonBody`；`getAgentsMdModular`                                                                           |
| Plan    | `lib/agent-orchestrator/*`（18 文件）、`lib/plan-mode-store.ts`、`app/api/plan/*`（10 路由）、`components/PlanPanel.tsx`                                                                                                                                           | `ModelRegistry` / `ModelRuntime` / `SettingsManager` / `getAgentDir`（`@earendil-works/pi-coding-agent`）；`completeSimple`（`@earendil-works/pi-ai/compat`）                 |
| Engine  | `lib/unified-engine/*`（33 文件）、`lib/engine-logger.ts`、`lib/engine-runtime-store.ts`、`lib/constraints/engine.ts`、`lib/allowed-commands.ts`、`lib/id.ts`、`lib/constraints/types.ts`、`app/api/engine/*`（7 路由）、`components/EngineDashboard.tsx` + 子组件 | `node-pty`（**不进依赖，pty-runner 已内置优雅降级**）、`vendor/comet`（`comet-adapter` 经 `existsSync` 探测，仍在 `vendor/`）、`validateCsrf`/`api-utils`/`NextResponse.json` |

关键适配历史（已在落地提交中体现）：

- Plan/Engine 的 `lib/*` 相对 import **去 `.ts` 后缀**（HEAD 的 `tsconfig` 未启用 `allowImportingTsExtensions`）。
- 客户端 `csrfFetchJson`（已删 `@/lib/csrf-fetch`）改为本地原生 `fetch` 封装（`planFetchJson` / `engineFetchJson`），
  HEAD 已移除 csrf header，统一失败兜底不抛异常。
- `lib/types.ts`、`lib/api-utils.ts` **不可覆盖**——它们属于上游共享核心，被上游改写；
  接回文件如需类型，仅取回其独有依赖（`lib/constraints/types.ts`、`lib/id.ts`），绝不整文件覆盖 `lib/types.ts`。

## 标准同步流程（每次上游发布）

```bash
# 1. 取上游
git fetch agegr

# 2. 在干净 main 上重置融合分支
git checkout -B feat/merge-upstream-v086 main

# 3. 合并上游（冲突应极少，因核心文件未被我们直接改）
git merge agegr/main --no-edit
#    - 若仍有冲突：共享核心一律取上游版（--theirs）；
#    - 文档（AGENTS.md / README*）取我们版（--ours）；
#    - 我们的独有功能文件通常已自动合并保留。

# 4. 验证 CI 闸门（必须全绿才允许合 main）
npm run format:check && npm run lint && npm run type-check && npm run test:node && npm run test:coverage

# 5. 提交 merge，开 PR 合入 main（main 受 CI 分支保护）
```

## 当前基线已验证状态（2026-08-02，三个面板接回后）

| 闸门                      | 结果                              |
| ------------------------- | --------------------------------- |
| `type-check`              | 0 错误                            |
| `lint`                    | 0 错误（历史 warning 非阻塞）     |
| `format:check`            | 通过                              |
| `test:node`               | 288 通过（含 `allowed-commands`） |
| `test:coverage`（vitest） | 169 通过                          |

## 已知待解耦项（后续任务，非阻塞）

1. 中文 i18n 外挂化：把 `ours-messages.ts` 注入改为更干净的"补充 locale 插件"机制。
2. 面板扩展化：`InspectorPanel` / `TodoPanel` / `PlanPanel` / `EngineDashboard` / `PromptsConfig`
   改为上游 `extensions` 挂载。
3. `ours/api-legacy/` 两个路由适配 SDK `0.83.0` 后移回 `app/api` 或删除。
4. `vendor/comet` 当前仍被 `lib/unified-engine/comet-adapter.ts` 经 `existsSync` 探测使用，
   **不可删除**；`autoplan` 后端已迁移为纯 TS（`lib/unified-engine/autoplan-adapter.ts`），
   Go sidecar 已弃用。`.prettierignore` 已加 `vendor` 避免 format:check 阻塞。
