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

> **实现期架构修正（2026-07-29）：** 本节最初假设 assistant 回答消息的 `message.content`
> 里就带着本回合的 `toolCall` 块。**这是错的。** pi-web 的会话预处理会把原始 assistant
> 消息**按工具调用拆成多条独立消息条目**：每个 `toolCall`（+ 其 `toolResult`）各自一条
> assistant / toolResult 条目，最终回答（纯 text）单独一条。因此渲染时一个"回合"在
> `messages[]` 里横跨多条条目，而最终回答条目（`finalAssistant`）的 `content` 只有
> `[text]`——`extractTurnArtifacts(message.content)` 只看得到文本，永远返回空，chip 不出。
> 单测没抓住这点，因为它们直接喂了包含 `toolCall` 的合成 `content`。修正后的数据流如下。

1. **回合边界由 `ChatWindow` 掌握**（`components/ChatWindow.tsx`）：渲染时按 user 锚点把
   消息分组，组内 `[userIdx+1, finalAssistantIdx]` 即一个回合。回合的工具调用散落在该区间
   的多条 assistant 条目里，最终回答是 `finalAssistant`（text-only）。
2. **在 `ChatWindow` 聚合整回合的工具调用**：遍历 `[userIdx+1, finalAssistantIdx]` 所有
   `role==="assistant"` 条目，把它们的 content 块拼成一个数组，传入
   `extractTurnArtifacts(turnContent, toolResultsMap, cwd)` → `TurnArtifact[]`（已去重）。
   `extractTurnArtifacts` 内部只挑 `write`/`edit` 的 `toolCall` 块，跳过 text/thinking。
3. **把结果作为 `turnArtifacts` prop 穿下去**：`renderMessage(..., { messageOverride:
   finalAnswerMessage, turnArtifacts })` → `MessageView`（新增可选 prop）→
   `AssistantMessageView`（新增可选 prop）。`AssistantMessageView` 的 `useMemo` 优先用该 prop：
   `turnArtifacts ?? extractTurnArtifacts(message.content, ...)`。
4. **chip 渲染**：`AssistantMessageView` 在 blocks 列表之后渲染 `<TurnArtifacts artifacts=
   {artifacts} onOpenFile={onOpenFile}>`（`MessageView.tsx` 约 543 行）。
5. **流式回退**：未拆分的流式 bubble（`ChatWindow` 直接渲染 `streamingMessage` 那条，
   未传 `turnArtifacts`）走 `?? extractTurnArtifacts(message.content)`——流式消息此时
   `content` 仍含 `toolCall`，故也能实时出 chip。
6. **抑制 Process Details 内重复**：回合的 process 条目（折叠的"Process details"）渲染时
   显式传 `turnArtifacts: []`，避免展开后 fallback 在过程区也冒 chip。
7. 每个 chip 点击调 `onOpenFile(filePath)`（绝对路径）→ 复用现有 `handleOpenLinkedFile` →
   `handleOpenFile`（`AppShell.tsx`）→ 右侧 `FileViewer` + `setRightPanelOpen(true)`。

**抽取逻辑（对聚合后内容里每个 `toolCall` 块）：**

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

- 路径解析复用 `resolveLocalFileHref`：它只对**相对**候选项做 `isPathInside` 校验（落在 `cwd` 之外的相对路径被拒绝，不渲染死链 / 越界链接）。**绝对**路径会直接放行——真正的越界访问门禁在预览后端（见下条）。
- 真正的访问门禁是预览后端 `isFilePathAllowed`（`app/api/files/[...path]/route.ts`）：落在允许根之外的路径在后端被拒绝、不会被读取或渲染。列出的路径都来自本会话工具调用（session-referenced）；与现有 bare-path 链接特性走**同一套后端门禁**，不新增攻击面。
- chip 点击只调 `onOpenFile`（现有受信路径），不引入新的外部跳转。

## 边界与已知缺口

- **bash 间接写入**：不识别（见"范围"）。该类文件不会出现在 chip 行。
- 相对路径落在 `cwd` 之外：`resolveLocalFileHref` 跳过，不渲染死链。（绝对路径越界则由后端 `isFilePathAllowed` 拦截，见"安全"。）
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
