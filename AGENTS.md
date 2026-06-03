# Pi Agent Web - 开发笔记

## 快速开始

```bash
npm run dev   # 端口 3030
```

类型检查：`node_modules/.bin/tsc --noEmit`  
代码检查：`node node_modules/next/dist/bin/next lint`  
**开发期间切勿执行 `next build`** — 会污染 `.next/` 目录并导致 `npm run dev` 失效。

---

## 架构

```
浏览器                    Next.js 服务器              AgentSession（进程内）
  │                            │                              │
  ├─ GET /api/sessions ────────▶ 读取 ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id]    直接读取 .jsonl 文件           │
  │                            │                              │
  ├─ 发送消息 ─────────────────▶ POST /api/agent/[id]         │
  │                            │ startRpcSession() ──────────▶│ createAgentSession()
  │                            │ session.send(cmd) ──────────▶│ session.prompt()
  │                            │                              │
  ├─ SSE 连接 ─────────────────▶ GET /api/agent/[id]/events   │
  │                            │ session.onEvent() ◀──────────│ session.subscribe()
  │◀── data: {...} ────────────│                              │
```

**会话浏览（只读）**：通过 `lib/session-reader.ts` 直接读取 `.jsonl` 文件 — 不创建 AgentSession。  
**发送消息**：`lib/rpc-manager.ts` 中的 `startRpcSession()` 会创建一个进程内的 AgentSession。

---

## 文件地图

```
app/api/
  sessions/route.ts               GET 列出所有会话
  sessions/[id]/route.ts          GET/PATCH/DELETE 会话
  sessions/[id]/context/route.ts  GET ?leafId= — 指定叶节点的上下文
  sessions/new/route.ts           返回 410（不再使用）
  agent/new/route.ts              POST { cwd, message, toolNames?, provider?, modelId? }
  agent/[id]/route.ts             GET 状态 | POST 任意命令
  agent/[id]/events/route.ts      GET SSE 流
  files/[...path]/route.ts        GET 文件内容（用于文件查看器）
  models/route.ts                 GET { models, modelList, defaultModel }
  models-config/route.ts          GET/POST — 读写 ~/.pi/agent/models.json

lib/
  rpc-manager.ts      AgentSessionWrapper + 注册表 + startRpcSession
  session-reader.ts   解析 .jsonl；getModelNameMap/getModelList/getDefaultModel
  types.ts            共享的 TypeScript 类型
  normalize.ts        normalizeToolCalls() — 处理文件格式与类型之间的字段名不一致问题
  system-prompt-off.ts  所有工具禁用时的最小系统提示词

components/
  AppShell.tsx        布局 + URL 状态 + 标签页管理
  SessionSidebar.tsx  会话树 + FileExplorer
  ChatWindow.tsx      消息 + 流式输出 + SSE + fork/导航逻辑
  ChatInput.tsx       输入栏 + 模型/思考/工具/紧凑模式控制
  MessageView.tsx     渲染单条消息（用户/助手/toolCall/toolResult）
  BranchNavigator.tsx 会话内分支切换器
  ChatMinimap.tsx     消息列表旁滚动缩略图
  ToolPanel.tsx       导出 PRESET_NONE/DEFAULT/FULL + getPresetFromTools
  ModelsConfig.tsx    编辑 models.json 的弹窗（从侧边栏底部打开）
  FileExplorer.tsx    侧边栏中的文件树
  FileViewer.tsx      标签页中的文件内容
  TabBar.tsx          标签栏（聊天 + 已打开的文件标签）
```

---

## 关键设计决策与陷阱

### AgentSession 生命周期（`lib/rpc-manager.ts`）
- 每个会话 ID 对应一个 `AgentSessionWrapper`，存储在 `globalThis.__piSessions` 中
- `globalThis` 在 Next.js 热重载后仍然存活；普通的模块级 Map 则不会
- 空闲超时：10 分钟。并发的 `startRpcSession()` 调用共享同一个启动 Promise（`globalThis.__piStartLocks`）

### Fork 后必须立即销毁 wrapper
`AgentSession.fork()` **会就地修改 wrapper 的内部状态** — fork 之后，`inner.sessionId` 变为了*新*会话的 ID。如果 wrapper 仍以旧 ID 留在注册表中，下一次请求会拿到已 fork 后的状态，后续 fork 会产生一个损坏的 `parentSession` 链。

**解决方法**：`send("fork")` 捕获 `newSessionId`，然后在返回前调用 `this.destroy()`。下一次对原会话的请求会从原始文件重新加载一个干净的 AgentSession。

### 两种分支方式 — 不要混淆
- **Fork**（用户消息上的 Fork 按钮）：创建一个新的独立 `.jsonl` 文件。通过 `parentSession` 头部字段在侧边栏树中显示为子节点。
- **会话内分支**（继续按钮 / BranchNavigator）：在同一文件内调用 `navigate_tree`。多个条目共享同一个 `parentId`。在它们之间切换时会调用 `/api/sessions/[id]/context?leafId=`。

### 会话文件可以完全重写
头部中的 `parentSession` **仅用于展示元数据** — 对聊天内容没有任何影响。可以安全地使用 `writeFileSync` 重写整个文件（pi 自己在迁移时也会这样做）。删除时会用于级联重设子节点的父节点。

### ToolCall 字段规范化
Pi 将 toolCall 块存储为 `{type:"toolCall", id, name, arguments}`，但 `ToolCallContent` 使用 `{toolCallId, toolName, input}`。`lib/normalize.ts` 中的 `normalizeToolCalls()` 处理这个转换 — 在 `session-reader.ts`（文件加载）和 `ChatWindow.handleAgentEvent()`（流式输出）中都会调用。

### 新会话的工具预设
工具名称在会话创建时传入（`POST /api/agent/new` → `toolNames[]`）。对于已有会话，挂载时通过 `get_tools` → `getPresetFromTools()` 推断当前预设。当工具完全禁用时（`toolNames = []`），`rpc-manager.ts` 通过 `system-prompt-off.ts` + `DefaultResourceLoader` 注入一个最小的系统提示词。

### 新会话的模型默认值
`GET /api/models` 返回从 `~/.pi/agent/settings.json` 读取的 `defaultModel`。`ChatWindow` 在挂载时会为新会话预选这个模型。

### 页面刷新且流式传输未完成时的 SSE 重连
`ChatWindow` 挂载时，会调用 `GET /api/agent/[id]`。如果 `state.isStreaming === true`，SSE 会自动重连。`thinkingLevel` 和 `isCompacting` 也会从该响应中同步。

### Compaction SSE 事件
较新版本的 pi 发送 `compaction_start` / `compaction_end`；旧版本发送 `auto_compaction_start` / `auto_compaction_end`。`handleAgentEvent` 同时接受这两组事件，以保持 `isCompacting` 同步。手动 compact 是一个阻塞的 POST 请求 — 按钮会保持禁用状态直到响应返回。

### 孤立会话
第一行无法被解析为有效头部的会话，在 API 响应中被标记为 `orphaned: true` — 在侧边栏中显示为"不完整"徽章，并且不可点击。

---

## Pi 会话文件格式

位置：`~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`SessionContext` 中的 `entryIds[]` 是与 `messages[]` 并行的数组 — 将每条显示的消息映射回对应的 `.jsonl` 条目 ID，用于 fork 和 navigate_tree 调用。

---

## CSS 变量（`app/globals.css`）

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```
