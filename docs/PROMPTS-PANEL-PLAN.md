# 提示词栏（PromptsConfig）：模块化系统提示词接通与重构计划

> 状态：规划完成，待实施
> 关联文件：`components/PromptsConfig.tsx`、`lib/prompt-system/*`、`lib/prompt-modules-state.ts`、`lib/rpc-manager.ts`、`lib/i18n/ours-messages.ts`、`app/globals.css`
> 上游同步约束：见 [`docs/UPSTREAM-SYNC.md`](./UPSTREAM-SYNC.md)

---

## 一、问题诊断

### 1.1 核心问题：整个模块化系统提示词是「已建造、未通电」的死功能

三个独立 grep 交叉验证，结论一致——面板的核心功能从未接入 agent 运行时：

| 证据                                                                | grep 结果                                                                      | 含义                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------ |
| `composeModularAgentsMdSystemPrompt`（AGENTS.md 裁剪注入）          | 全项目仅定义处 1 处，零调用                                                    | 「AGENTS.md 模块化」总闸开了也不生效 |
| `buildEnhanceSystemPrompt` / `buildEnhanceSystemPromptSelected`     | 排除定义文件后零调用                                                           | enhance（提示词改写）同样悬置        |
| `getModuleEnabled` / `getAgentsMdModular` / `getCompressedOverride` | 仅 `app/api/prompts/modules/route.ts` 读写，rpc-manager / agent session 零读取 | 开关/压缩/总闸只存状态，不影响 agent |

**用户体验**：在面板里关模块、压缩、开总闸、跑预览——全部成功、有动画、有数字反馈，但 agent 实际收到的 systemPrompt 一个字都没变。面板是一件精致的摆设。

### 1.2 根因：现有实现与「不妨碍上游更新」根本冲突

`composeModularAgentsMdSystemPrompt`（`lib/prompt-system/agents-md-modules.ts`）用正则匹配上游 `buildSystemPrompt` 输出里的 `<project_instructions path="...agents.md">` 标签并替换。这是上游 pi 的**私有输出格式**，不是公开 API。上游一旦重构 systemPrompt 拼装方式，正则失配，裁剪静默失效。

所以开发者写完了整条管线（registry→compose→compress→select→API→UI），却在最后一步「接入 agent」处停手——不接入就不会被上游破坏。`lib/prompt-system/*` 被列在 UPSTREAM-SYNC.md 的「我们独有文件（merge 零冲突）」，**正因为没接入，它才零冲突**。当前状态不是 bug，是「不妨碍上游」约束的代价。

### 1.3 次要问题（UI/UX，叠加在死功能之上）

- **L1 双栏挤爆**：`ConfigModal` left 240px 固定 + right flex:1，塞进 340px 侧栏（可用 ~324px）后右栏详情仅 ~83px，操作按钮/代码块/标签云全部溢出。
- **L2 盒中盒**：ConfigModal 自带 border+radius+overflow:hidden 外壳，套在 WorkspacePanelsHost padding:8 内容区里，与 TodoPanel 等无外壳面板风格不一致。
- **L3 死按钮 + 重复标题**：`builtin.tsx` 传 `onClose={() => {}}`，footer「关闭」无效；ConfigModal title「提示词」与 tab 行重复；`width={880}` 是死参数（ConfigModal 忽略）。
- **B1 类别标签乱码**：`t(\`promptOpt.category.${m.category}\` as never)`（PromptsConfig.tsx:318），i18n 里 `promptOpt.category.*` 全缺，fallback 显示键名。`as never` 掩盖了类型错误。
- **B2 预览结果信息丢失**：`t("promptOpt.previewResult").replace("{selected}",...)`，但文案值无 `{selected}`/`{saved}` 占位符，replace 空转，只剩「预览结果」四字。
- **B3 死键**：`prompts.*`（apply/optimize/save 等 15 个）是旧版「提示词文件编辑器」的残留译文（UPSTREAM-SYNC.md 确认），新版改用 `promptOpt.*` 后未清理。
- **S1 闪 loading**：`toggleModule`/`compress`/`resetCompression` 成功后调 `load()`，而 `load()` 开头 `setLoading(true)`，每次操作列表塌缩成「…」。
- **S2 零错误反馈**：toggle/compress/preview 失败全部静默吞掉。
- **E1 配色硬编码**：`CATEGORY_COLOR` 全 hex；`#22C55E`/`#ef4444`/`#818cf8` 等不走 CSS 变量，明暗主题适配存疑。

### 1.4 横切发现（影响多个面板）

`--git-added` / `--git-modified` / `--git-deleted` / `--git-untracked` / `--accent-text` / `--color-warning` / `--color-error-soft` 在 `app/globals.css` **全部未定义**（只有 `.zcode/plans/` 一份计划文档写过要加但没落地）。影响 InspectorPanel、PlanPanel、EngineDashboard、PromptsConfig 的颜色——`var(--未定义)` 回退为空，相关着色失效。

---

## 二、转机：上游公开注入点

之前「接通必然耦合上游」的判断是针对 pi-web **现有 parse 实现**，不是「接入」本身。上游 pi 暴露了多个公开稳定的注入点（均在 d.ts 导出）：

| 注入点                                                    | 位置                         | 语义                                                                                |
| --------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| `BuildSystemPromptOptions.contextFiles`                   | `core/system-prompt.d.ts`    | AGENTS.md 等项目上下文的**源头**（path+content 数组）                               |
| `DefaultResourceLoaderOptions.agentsFilesOverride`        | `core/resource-loader.d.ts`  | `(base) => agentsFiles`，文件级 override                                            |
| `DefaultResourceLoaderOptions.appendSystemPromptOverride` | 同上                         | `(base: string[]) => string[]`，追加自定义片段                                      |
| `DefaultResourceLoaderOptions.systemPromptOverride`       | 同上                         | `(base) => string`，完全覆盖                                                        |
| `BeforeAgentStartEvent` / `BeforeAgentStartEventResult`   | `core/extensions/types.d.ts` | event 带 `systemPromptOptions`，result 可返回 `systemPrompt` 替换本轮，多扩展可链式 |
| 公开函数 `buildSystemPrompt(options)`                     | `core/system-prompt.d.ts`    | 可自行重建                                                                          |

**核心思路转变**：不要改上游的「输出」（systemPrompt 字符串），而改上游的「输入」（文件内容 / options）。

---

## 三、落地方案：源头注入

### 3.1 关键透传口

`CreateAgentSessionServicesOptions`（`core/agent-session-services.d.ts`）有：

```ts
resourceLoaderOptions?: Omit<DefaultResourceLoaderOptions, "cwd" | "agentDir" | "settingsManager">;
```

pi-web 经 `createAgentSessionServices` 创建 inner（`lib/rpc-manager.ts:1321`），**现在没传 `resourceLoaderOptions`**。补上即可注入上述全部 override。

### 3.2 功能 → override 映射

| 面板功能                      | 用哪个公开 override                       | 复用现有代码                                             |
| ----------------------------- | ----------------------------------------- | -------------------------------------------------------- |
| ① 模块开关 / 裁剪 AGENTS.md   | `agentsFilesOverride`                     | ✅ `composeAgentsMd(content, {开关})`                    |
| ② 自定义提示词片段（子视图②） | `appendSystemPromptOverride`              | 新建文件读取                                             |
| ③ 按任务动态精筛（可选增强）  | `extensionFactories` + `BeforeAgentStart` | ✅ `selectModules(userInput)` + 公开 `buildSystemPrompt` |

`agentsFilesOverride` 与现有代码高度贴合：

```ts
agentsFilesOverride: (base) => ({
  agentsFiles: base.agentsFiles.map((f) =>
    /agents\.md$/i.test(f.path)
      ? { ...f, content: composeAgentsMd(f.content, {}) } // pi-web 已有的裁剪函数
      : f,
  ),
});
```

### 3.3 rpc-manager 改动（极小）

```ts
// lib/rpc-manager.ts 约 1321 行
const services = await createAgentSessionServices({
  cwd: sessionCwd,
  agentDir,
  ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
  resourceLoaderOptions: getPromptModuleLoaderOptions(sessionCwd), // ← 新增一行
});
```

`getPromptModuleLoaderOptions(cwd)`（新建）：总闸关 → `return {}`（行为同现状，零风险）；总闸开 → 返回 `{ agentsFilesOverride }`。

---

## 四、实施阶段

### 阶段 0　接通（让功能真正生效）—— 最小、可独立上线

- 0.1 新建 `getPromptModuleLoaderOptions(cwd)`：读 `prompt-modules-state`，总闸关返回 `{}`，开返回 `{ agentsFilesOverride }`
- 0.2 `rpc-manager` 的 `createAgentSessionServices` 调用处加 `resourceLoaderOptions`
- 0.3 删除从未接通的 `composeModularAgentsMdSystemPrompt`（正则 parse 那套，已被源头注入取代）
- 0.4 验证：开关模块 → 发消息 → 确认 `agent.state.systemPrompt` 里 AGENTS.md 段已裁剪

### 阶段 1　面板 UI/UX 重构（接通之后才有意义）

- 1.1 `ConfigModal` 双栏 → 单栏主从切换（列表 ↔ 详情）
- 1.2 修 B1（补 `promptOpt.category.*` 翻译键）、B2（`previewResult` 改标准 `{var}` 插值）
- 1.3 去 死按钮 / 重复标题；`toggle`/`compress` 静默刷新不闪 loading；失败给反馈
- 1.4 配色硬编码 → CSS 变量；**顺带补 `globals.css` 缺失的 `--git-*` 等**（横切，多面板受益）
- 1.5 顶部加「模块 / 文件」分段控件（文件 = 占位）
- 1.6 清理 `prompts.*` 死键（或留待阶段 2 复用）

### 阶段 2　子视图② 自定义提示词文件（后续，需先定存储）

- `appendSystemPromptOverride` + 文件存储（`~/.pi/agent/prompts/*.md` 用户级 / `.pi/prompts/*.md` 项目级）+ 编辑器 UI
- 待定：一文件一模块（frontmatter 记 category/tags）？

---

## 五、上游同步评估（为何不妨碍上游更新）

1. **零字符串 parse**——操作「文件内容/数组」语义，非上游 systemPrompt 输出格式；上游重构 `<project_instructions>` 拼装方式与本方案无关。
2. **全部走公开契约**——`resourceLoaderOptions` / `agentsFilesOverride` / `BeforeAgentStart` 均为 d.ts 导出的稳定 API，与 pi-web 已依赖的 `validateCsrf`、`createAgentSessionServices` 同性质。
3. **改动只在 pi-web 独有文件**——rpc-manager 加一行 + 新建 options 构造函数；不动 SDK、不动上游共享核心。符合 UPSTREAM-SYNC.md「merge 零冲突」。
4. **漂移点可控**——唯一需跟上游的是 `agentsFilesOverride` 等签名；万一上游改，加 `// —— 跟随上游适配` 注释即可，正是现有同步流程设计。
5. **渐进可关**——总闸关时 `getPromptModuleLoaderOptions` 返回 `{}`，行为与现状完全一致，零风险上线。

---

## 六、待决策

1. **动态精筛（③）是否纳入**：按每条消息相关性临时裁剪，更省 token 但要装 `BeforeAgentStart` 扩展。MVP 可先不做（静态开关已让面板生效）。
2. **子视图② 存储格式**：一文件一模块 + frontmatter？还是 Markdown 分段？位置确认 `~/.pi/agent/prompts/` + `.pi/prompts/`。
3. **实施节奏**：先阶段 0 接通，还是阶段 0+1 一起。

---

## 附：调研关键事实索引

- 死功能证据：`composeModularAgentsMdSystemPrompt` / `buildEnhanceSystemPrompt` 零调用；`getModuleEnabled` 等仅 API 读写。
- 上游注入点：`core/system-prompt.d.ts`（BuildSystemPromptOptions.contextFiles）、`core/resource-loader.d.ts`（agentsFilesOverride 等）、`core/extensions/types.d.ts:524/800`（BeforeAgentStart 事件）、`core/agent-session-services.d.ts`（resourceLoaderOptions 透传口）。
- pi-web 创建链：`rpc-manager.ts:1321` createAgentSessionServices → :1344 createAgentSessionFromServices → inner。
- CSS 变量缺失：`app/globals.css` :root/html.dark 仅 15 个变量，无 `--git-*` / `--accent-text` / `--color-warning` / `--color-error-soft`。
