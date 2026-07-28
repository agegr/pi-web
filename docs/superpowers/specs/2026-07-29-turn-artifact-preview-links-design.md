# 聊天回合产物预览链接（Turn Artifact Preview Links）设计

- 日期：2026-07-29
- 状态：已通过头脑风暴，设计已确认
- 分支：`feat/turn-artifact-preview-links`（基于 `feat/chat-file-path-links`）
- 相关前置特性：`docs/superpowers/specs/2026-07-28-chat-file-path-links-design.md`（把回复正文里**已经写出**的裸绝对路径链接化）

## 背景与动机

前置特性让 assistant 回复正文里**已经写出绝对路径**的文件可点击预览。但模型在总结时常常**省略绝对路径**（只说"已生成报告"），导致明明产出了文件、却无法一键预览。

本特性补这个缺口，且**不从正文猜文件名**：每个回合里的 `write`/`edit` 工具调用本身就记录了被生成/修改文件的路径（工具调用真值）。直接用这份真值，零猜测、零模糊匹配。

## 目标

在每个 assistant 回合正文下方，自动列出一行可点击的「产物」chip，点击在右侧 `FileViewer` 预览。纯前端、纯数据驱动，不改正文 markdown，不引入模糊推断。

## 范围

**纳入（In scope）：**
- `write` + `edit`（新建与修改都算）工具调用产生的文件
- 仅**成功**（非 error）结果
- 同一文件被多次写/编，去重后只显示一次
- 按**回合**（每条 assistant 消息）聚合，不跨回合
- 相对路径按会话 `cwd` 解析成绝对路径

**不纳入（YAGNI / 已知缺口）：**
- **bash 间接写入**（`echo > …`、跑构建脚本）：路径埋在命令字符串里，v1 不识别——要可靠就得靠工具调用真值，bash 命令解析会把模糊性请回来
- create vs modify 标记
- 跨回合聚合
- chip 的复制 / 下载等额外操作
- 工具调用块路径就地可点击（头脑风暴中的 option 2，可作后续独立小改）
- 扩展名过滤：默认列出全部 `write`/`edit` 产物（详见"关键规则"）

## 架构与数据流

1. `AssistantMessageView`（`components/MessageView.tsx:341`）已同时持有 `message.content`、`toolResults`（`Map<toolCallId, ToolResultMessage>`）、`cwd`、`onOpenFile`（行 344 / 346 / 347 / 353）——四个依赖全在这一层齐了，无需新增 prop 穿透。
2. 调用纯函数 `extractTurnArtifacts(message.content, toolResults, cwd)` → `TurnArtifact[]`（已去重）。
3. 列表非空则渲染 `<TurnArtifacts>` 组件（chip 行），位于 blocks 列表**之后**（约 `MessageView.tsx:533` 之后）。
4. 每个 chip 点击调 `onOpenFile(filePath)`（绝对路径）→ 复用现有 `handleOpenLinkedFile` → `handleOpenFile`（`AppShell.tsx:417`）→ 右侧 `FileViewer` + `setRightPanelOpen(true)`。

**抽取逻辑（对该回合每个 `toolCall` content 块）：**

1. 工具名属 `write`/`edit` 族 → 否则跳过（`read` / `ls` / `grep` / `bash` 等自然排除）
2. 按 `toolCallId` 在 `toolResults` 查结果，`isError === true` → 跳过
3. 取路径 `input.file_path ?? input.path`（与 agent 自身 write/edit 代码 `write.js` / `edit.js` 一致；`getToolPreview` 同样读取这两个键）；非字符串 / 缺省 → 跳过
4. `resolveLocalFileHref(path, cwd)`（`lib/file-links.ts:77`）解析成绝对路径并做 `isPathInside` 安全校验；返回 `null` → 跳过
5. 收集；按 `filePath` 去重，保出现顺序

## 组件与文件

- **新增 `lib/turn-artifacts.ts`**：纯函数 `extractTurnArtifacts(content, toolResults, cwd)` + `TurnArtifact` 类型。自包含 `write`/`edit` 工具名判定（不从组件文件反依赖）。复用 `resolveLocalFileHref`。**无新依赖**。
- **新增 `lib/turn-artifacts.test.mjs`**：`node:test` + `jiti`（沿用 `lib/file-path-scan.test.mjs` 约定）。
- **改 `components/MessageView.tsx`**：新增轻量 `TurnArtifacts` 组件，**内联定义**（参照同文件 `CompactionFileMetadata` 行 1113 的 per-message footer 写法）；在 `AssistantMessageView` 的 blocks 列表之后渲染。chip = `<button>` 调 `onOpenFile(filePath)`，标签取 basename、`title` 给绝对路径，配一个文件类型小图标。列表为空则**不渲染任何东西**。

## 数据契约

```ts
// lib/turn-artifacts.ts
export interface TurnArtifact {
  filePath: string; // 已解析的绝对路径
}

export function extractTurnArtifacts(
  content: AssistantContentBlock[],
  toolResults: Map<string, ToolResultMessage> | undefined,
  cwd?: string,
): TurnArtifact[];
```

**`write`/`edit` 工具名判定（自包含于 `lib/turn-artifacts.ts`，不 import 组件）：**
- `write` 族：`toolName === "write"`（小写；agent 包用此名）
- `edit` 族：与 `isEditToolName`（`MessageView.tsx:1012`）同样的模式——`edit` / `edit_*` / `*.edit` / `*_edit` / `*str_replace*` / `*replace_editor*`（在 lib 内重新声明）

**路径读取顺序：** `input.file_path ?? input.path`（与 agent write/edit 代码 `write.js` / `edit.js` 一致；`getToolPreview` `MessageView.tsx:1357` 同样读取这两个键，但顺序以 agent 代码为准）。

## 关键规则

- 范围：`write` + `edit`（新建与修改都算）。
- 仅成功结果；同文件去重；按回合（每条 assistant 消息）聚合，不跨回合。
- **不做扩展名过滤**：`write`/`edit` 产物基本都是代码 / 文本 / HTML / 图片，`FileViewer` 都能渲染；列出全部更贴近"看本回合产出了什么"。若日后想只列可预览的，可加 `isPreviewableExtension` 过滤——留作可选项，不在 v1。

## 安全

- 路径解析复用 `resolveLocalFileHref`，内含 `isPathInside` 校验：落在 `cwd` / 允许根之外的路径被拒绝（不渲染死链 / 越界链接）。
- 列出的路径都来自本会话工具调用（session-referenced），预览后端 `isFilePathAllowed` 会放行；与现有 bare-path 链接特性走**同一套门禁**，不新增攻击面。
- chip 点击只调 `onOpenFile`（现有受信路径），不引入新的外部跳转。

## 边界与已知缺口

- **bash 间接写入**：不识别（见"范围"）。该类文件不会出现在 chip 行。
- 路径无法解析成绝对 / 落在允许根之外：跳过，不渲染死链。
- **流式**：随工具调用到达实时重算（每次 render 从 `message.content` 派生）；结果未回时不显示该文件。
- **Windows 盘符路径**：本特性读的是工具调用 `input` 里的路径，`resolveLocalFileHref` 支持盘符解析；预览后端按所在平台处理。它不在"正文链接化"层面，**不受前置特性 Windows 盘符限制的影响**。

## 测试策略

**单测（`lib/turn-artifacts.test.mjs`）：**
- `write` 出产物
- `edit` 出产物
- `errored` 结果跳过
- 同文件多次写 / 编去重
- 相对路径按 `cwd` 解析成绝对
- 非产物工具（`read` / `bash`）跳过
- 缺 `file_path` / `path` 跳过
- 空回合返回空数组

**组件测试（`components/`，新增或扩展现有 `*.test.mjs`）：**
- 有产物 → 渲染 chip，点击触发 `onOpenFile(absPath)`
- 无产物 → 不渲染任何东西

## 与前置特性的关系

**互补、不冲突。** 前置特性（remark 插件）处理**正文里已写的裸绝对路径**；本特性处理**工具调用产出、但正文没提的产物**。两者可同时存在：一个文件若既在正文里被写成绝对路径、又被工具调用产出，会分别以"正文链接"和"chip"两种形式出现，互不干扰。
