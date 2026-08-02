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

## 面板 / 命令类增强（扩展化，待做）

`InspectorPanel`、`TodoPanel`、`PlanPanel`、`EngineDashboard`、`PromptsConfig` 等纯 UI 增强，
应改为挂载到上游 `lib/extensions` 的 `workspacePanels` / `actions` 贡献点，而非侵入 `AppShell`。
（本基线中它们仍以组件形式存在并编译通过，但属于后续"面板扩展化"改造对象。）

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

## 当前基线已验证状态（2026-08-02）

| 闸门                      | 结果                              |
| ------------------------- | --------------------------------- |
| `type-check`              | 0 错误                            |
| `lint`                    | 0 错误（99 历史 warning，非阻塞） |
| `format:check`            | 通过                              |
| `test:node`               | 283 通过                          |
| `test:coverage`（vitest） | 169 通过                          |

## 已知待解耦项（后续任务，非阻塞）

1. 中文 i18n 外挂化：把 `ours-messages.ts` 注入改为更干净的"补充 locale 插件"机制。
2. 面板扩展化：`InspectorPanel` / `TodoPanel` / `PlanPanel` / `EngineDashboard` / `PromptsConfig`
   改为上游 `extensions` 挂载。
3. `ours/api-legacy/` 两个路由适配 SDK `0.83.0` 后移回 `app/api` 或删除。
4. 删除已弃用的 `vendor/`（autoplan / comet）独立代码，统一从 tsc / prettier 排除。
