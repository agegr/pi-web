# Pi Agent Web - Development Notes

## Project Overview

A Next.js 15 web interface for the pi coding agent. Lets users browse all pi sessions, switch between them, view chat history with branch support, send new messages, fork sessions, and navigate message trees.

Start dev server: `npm run dev` (runs on port 3030)

---

## Architecture

```
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

**Key change**: Pi is no longer spawned as a subprocess. We use `@mariozechner/pi-coding-agent` (v0.60.0) directly via `createAgentSession()` from the npm package. This gives access to `navigateTree`, `fork`, and all AgentSession methods directly.

---

## Key Design Decisions

### Session browsing vs. agent interaction
- **Browsing**: reads `.jsonl` files directly via `lib/session-reader.ts`, no AgentSession created
- **Sending a message**: `startRpcSession()` creates an AgentSession in-process, `session.prompt()` fires the message

### AgentSession lifecycle (`lib/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id, stored in `globalThis.__piSessions`
- `globalThis` used so Next.js hot-reload doesn't lose the Map
- Auto-removed from registry when `destroy()` is called
- Idle timeout: 10 minutes
- Concurrent `startRpcSession()` calls share a single start Promise (lock in `globalThis.__piStartLocks`)
- `AgentSessionWrapper.send()` dispatches to the appropriate AgentSession method

### New session creation (`POST /api/agent/new`)
- `SessionManager.create(cwd, sessionsDir)` creates new session
- `createAgentSession({ cwd, agentDir, sessionManager })` starts it
- Returns the real `sessionId` from `inner.sessionId`

### Existing session loading
- `SessionManager.open(sessionFile, sessionsDir)` opens existing `.jsonl`
- `createAgentSession(...)` restores context from file

### Fork
- Calls `session.inner.fork(entryId)` directly on AgentSession
- Fork returns `{ newSessionId }` synchronously — no polling needed
- **After fork, wrapper is immediately destroyed** (`this.destroy()` inside `send("fork")`)
  - This is critical: `AgentSession.fork()` mutates inner state (sessionId changes in-place)
  - Keeping the wrapper alive would cause the next fork on the same session to start from the wrong state
  - Destroying forces the next request to reload a clean AgentSession from the original file
- `onSessionForked(newSessionId)` in AppShell triggers sidebar refresh + ChatWindow remount

### Fork session file structure
- Fork creates a completely independent `.jsonl` file
- `parentSession` in the header is **metadata only** — it records where the fork came from, for sidebar tree display
- Chat content in the forked file is a full copy of the path up to the fork point; both files are independent
- Modifying one file's content has no effect on the other

### Deleting a session with children (cascade reparent)
- Session files can be freely rewritten with `writeFileSync` — pi itself does this during migration and `createBranchedSession`
- When deleting a session B that has children C (A→B→C):
  1. Read B's `parentSession` path (A's absolute path)
  2. Scan sibling `.jsonl` files for any with `parentSession === B's path`
  3. Rewrite those files' first-line header with `parentSession = A's path`
  4. Delete B
- After this, C's file directly records A as parent — correct on page refresh with no client-side workarounds

### Navigate Tree (in-session branching)
- Calls `session.inner.navigateTree(targetId, {})` directly
- Pi switches to the target node within the same session file
- After navigate, sending a new prompt creates a branch in the same session

### Branch/tree navigation (display)
- `BranchNavigator` component shows branch points (nodes with >1 child)
- Switching leaf calls `/api/sessions/[id]/context?leafId=`
- Each message has an `entryId` from `context.entryIds[]` (parallel array)

---

## File Structure

```
app/
  page.tsx                      # root → <AppShell> in <Suspense>
  layout.tsx
  globals.css                   # CSS variables (light theme)
  api/
    sessions/
      route.ts                  # GET - list all sessions
      new/route.ts              # returns 410 (no longer used)
      [id]/
        route.ts                # GET/PATCH/DELETE session
        context/route.ts        # GET ?leafId= - context for a specific leaf
    agent/
      new/route.ts              # POST { cwd, message } - create+start new session
      [id]/
        route.ts                # GET state, POST any command (prompt/fork/navigate_tree/set_model/abort)
        events/route.ts         # GET SSE stream via session.onEvent()
    models/route.ts             # GET - returns id→name map from ~/.pi/agent/models.json

components/
  AppShell.tsx                  # layout: sidebar + chat area; manages session state + URL
  SessionSidebar.tsx            # cwd dropdown, session tree (parent/child via parentSessionId), actions
  ChatWindow.tsx                # message list, streaming, branch nav, input, fork handler
  MessageView.tsx               # renders user/assistant/toolCall+toolResult messages + markdown
  ChatInput.tsx                 # textarea, send/stop buttons, model selector dropdown
  BranchNavigator.tsx           # shows branch points, lets user switch active leaf

lib/
  types.ts                      # TypeScript types (SessionInfo has parentSessionId)
  session-reader.ts             # reads .jsonl files; getModelNameMap() for models.json
  rpc-manager.ts                # AgentSessionWrapper + registry + startRpcSession
```

---

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"...","timestamp":1234567890},...}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],"provider":"zenmux","model":"claude-sonnet-4-6","usage":{...},"stopReason":"stop","timestamp":N},...}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","toolName":"bash","content":[{"type":"text","text":"..."}],"isError":false,"timestamp":N},...}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

### ToolCall field normalization
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but our `ToolCallContent` type uses `{toolCallId, toolName, input}`. Normalization happens in:
- `session-reader.ts` `normalizeMessage()` — when loading from file
- `ChatWindow.tsx` `handleAgentEvent()` — when receiving streaming events

### parentSession
Session header has `parentSession` field (path to parent `.jsonl`) when created via fork. `extractSessionIdFromPath()` extracts the UUID from the filename. Used in `SessionSidebar` to build parent-child tree.

---

## CSS Variables (light theme, `globals.css`)

```css
--bg: #ffffff        --bg-panel: #f5f5f5    --bg-hover: #eeeeee
--bg-selected: #e8e8e8  --border: #e0e0e0
--text: #1a1a1a      --text-muted: #6b7280  --text-dim: #9ca3af
--accent: #2563eb    --user-bg: #eff6ff     --tool-bg: #f9fafb
--font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace
```

---

## Component Props Summary

### AppShell
- Manages: `selectedSession`, `newSessionCwd`, `refreshKey`, `sessionKey`
- `sessionKey` increments on real session switches → remounts ChatWindow
- `handleSessionForked(newSessionId)` → refresh sidebar + sessionKey++

### SessionSidebar
- `buildSessionTree(sessions)` groups sessions by `parentSessionId` into tree
  - `resolveAncestor()` walks up the `parentSessionId` chain to find the nearest existing ancestor
  - Handles missing intermediate nodes (e.g. deleted sessions) by skipping to the next live ancestor
- `SessionTreeItem` renders recursive tree with indent lines + fork icon
- Sessions with children show collapse/expand chevron
- Item height fixed at 54px (rename input + delete confirm stay same height)
- On delete: server rewrites children's `parentSession` field before deleting, then client calls `loadSessions()`

### ChatWindow
- `session: SessionInfo | null` + `newSessionCwd: string | null`
- `entryIds: string[]` parallel to `messages[]` for fork/navigate buttons
- `handleFork(entryId)` — POST fork, reads `newSessionId` from response directly (no polling)
- `handleNavigate(entryId)` — calls `navigate_tree` + `loadContext` to switch active leaf in same session
- `handleLeafChange(leafId)` — BranchNavigator callback: `navigate_tree` + `loadContext`
- On mount: checks if agent isStreaming → reconnects SSE automatically
- `message_end` event: appends completed message to `messages[]`, clears streaming state
- `agent_end` event: reloads session from file (gets toolResult pairing)

### MessageView
- `toolResults: Map<string, ToolResultMessage>` — paired by toolCallId, rendered inline under toolCall
- `entryId?: string` + `onFork?` — Fork button shown on hover of user messages
- `prevAssistantEntryId?: string` + `onNavigate?` — "Continue" button on hover of user messages
  - Calls `navigate_tree(prevAssistantEntryId)` to set leaf to the preceding assistant message
  - User then types a new message → branches from that point within the same session file
- ToolCall: green border/background, play icon, expandable args
- ToolResult: indented 18px, return arrow icon, expandable output
- User message timestamp shown below bubble (today: HH:MM, older: Mon DD HH:MM)

### ChatInput
- Model selector dropdown (bottom-left, opens upward)
- `onModelChange(provider, modelId)` → POST `set_model` to agent
- Queue input bar (visible during streaming): Steer / Follow-up toggle + textarea + Send
  - **Steer** tab (yellow): calls `inner.steer()` — interrupts agent mid-run
  - **Follow-up** tab (indigo): calls `inner.followUp()` — queues for after agent finishes
- **Tools** button (bottom-right): opens `ToolPanel` to toggle active tools
- **Compact** button doubles as abort: shows "Compacting…" + red stop icon while `isCompacting`, clicking it calls `abort_compaction`

### ToolPanel (`components/ToolPanel.tsx`)
- Opens above the input bar (absolute positioned relative to the wrapper div)
- Loads tools via `get_tools` command on open (fresh each time)
- Toggle switches: optimistic UI update + `set_tools` with full active name list
- Reverts on API error
- Closes on outside click
- Footer: "N of M active · takes effect on next turn"

---

## AgentSessionWrapper (`lib/rpc-manager.ts`)

```typescript
class AgentSessionWrapper {
  inner: AgentSession        // the actual AgentSession from @mariozechner/pi-coding-agent
  sessionId: string          // delegates to inner.sessionId
  sessionFile: string        // delegates to inner.sessionFile
  isAlive(): boolean
  start(): void              // subscribes to inner events, starts idle timer
  onEvent(listener): () => void   // returns unsubscribe fn
  onDestroy(cb): void
  send(command): Promise<unknown>  // dispatches to inner methods
  destroy(): void
}
```

`send()` supported commands: `prompt`, `abort`, `get_state`, `set_model`, `fork`, `navigate_tree`, `steer`, `follow_up`, `compact`, `abort_compaction`, `set_auto_compaction`, `set_auto_retry`, `set_thinking_level`, `get_tools`, `set_tools`

---

## Known Behaviours / Notes

- `@mariozechner/pi-coding-agent` v0.60.0 must be installed in pi-web (`npm install @mariozechner/pi-coding-agent`)
- Models loaded from `~/.pi/agent/models.json` via `getModelNameMap()` (cached in memory)
- Session sidebar shows top 5 cwds by most-recent modified; auto-selects on load
- Fork produces a new session file with `parentSession` pointing to the original; wrapper is destroyed immediately after
- `navigate_tree` stays in same session file, creates a branch on next prompt
- New fork sessions don't appear in sidebar until the first message is sent (pi defers file write until first assistant response)
- SSE reconnect: on ChatWindow mount, checks `GET /api/agent/[id]` for `isStreaming: true` → reconnects SSE
- URL `?session=<id>` persists selected session across refresh
- Sessions without a valid header (orphaned fork artifacts) are shown as `orphaned: true`, displayed with "incomplete" badge and not clickable

---

## Lessons Learned

### AgentSession.fork() 是为 TUI 设计的，不适合直接在 web 中长期持有

`fork()` 会**原地修改** AgentSession 的内部状态（sessionId 在调用后立即变成新 session 的 id）。TUI 是单进程单用户，fork 完直接继续用同一个对象没有问题。Web 场景下 AgentSession 以 sessionId 为 key 存在 registry 中，fork 后：

- registry key 还是旧 id，但 wrapper 内部已经是新 session 状态
- 下次用旧 id 请求时拿到的是"已经 fork 出去的" wrapper
- 再 fork 就从错误的状态出发，产生意外的中间 session，parentSession 链错乱

**正确做法**：fork 完立即 `destroy()` wrapper，强制下次请求从原始文件重新加载干净的 AgentSession。

### 不要在 web 端用轮询检测 AgentSession 内部状态变化

最初 fork 用轮询 `get_state` 20 次来检测 sessionId 变化，这本质上是在补偿"fork 会改变内部状态"这个设计问题。正确做法是让 fork 同步返回 newSessionId，客户端直接用。

### Session 文件不是 append-only，可以安全地整体重写

pi 自己在版本迁移和 `createBranchedSession` 时都会用 `writeFileSync` 覆写整个文件。修改 header 字段（如 `parentSession`）直接重写第一行即可，不会破坏任何约束。

### parentSession 只是显示用的元数据，与聊天内容完全解耦

fork 出来的 session 文件内容是独立的完整副本，`parentSession` 仅用于 sidebar 构建树状结构。修改 `parentSession`（比如删除中间节点时的 cascade reparent）对聊天内容零影响。

### BranchNavigator 的两种分支场景要区分清楚

- **跨 session 的 fork 树**：sidebar 里按 `parentSessionId` 展示，每个节点是独立文件
- **session 内部分支**：同一个 `.jsonl` 文件里，多条 entry 有相同的 `parentId`，`BranchNavigator` 展示，用 `navigate_tree` 切换

"Continue from here" 按钮触发的是 in-session 分支（`navigate_tree`），Fork 按钮触发的是跨 session 分支（新文件）。两者用途不同，不要混淆。

---

## Compact Feature: Current Status and Known Bugs

### What works
- Compact button appears in ChatInput for active sessions
- `POST /api/agent/[id]` with `{ type: "compact" }` calls `AgentSession.compact()`
- On success, `loadSession()` is called to reload the chat with the compaction summary injected at the top
- `isCompacting` state disables the button while compaction is in progress
- `compactError` state shows an inline error message on failure
- `session-reader.ts` renders compaction correctly: injects a virtual "user" message with the summary, then skips entries before `firstKeptEntryId`, then continues from `compactionIdx + 1`

### Bug 1: `isCompacting` state is never set back to `false` on success

**Location**: `ChatWindow.tsx` `handleCompact()` (lines 372–394)

```typescript
const handleCompact = useCallback(async () => {
  ...
  setIsCompacting(true);
  try {
    const res = await fetch(...);
    const data = await res.json();
    if (!res.ok || data.error) {
      setCompactError(data.error ?? `HTTP ${res.status}`);
      return;   // <-- returns without setIsCompacting(false) — BUG: button stays disabled forever
    }
    await loadSession(sid, true);
  } catch (e) {
    setCompactError(String(e));
  } finally {
    setIsCompacting(false);
  }
}, [isCompacting, loadSession]);
```

The early `return` on error path bypasses `finally` — except it doesn't, because `finally` always runs. **Wait: this is actually fine** — `finally` executes even after `return` in a try/catch/finally. So `setIsCompacting(false)` always runs.

However, there is a subtler issue: **`compactError` is never cleared on a subsequent successful compact call** unless the user explicitly retries. But `setCompactError(null)` is called at the top of `handleCompact`, so that is also fine.

**Actual root issue with `isCompacting`**: `isCompacting` in `handleCompact`'s dependency array means the callback is recreated when `isCompacting` changes, but this is a stale closure risk: if `handleCompact` is called while a stale version of the callback is referenced (e.g., via `onCompact` prop not re-rendered), the guard `if (!sid || isCompacting) return` could use a stale `false` value. In practice the prop passes through React re-render so this is low risk.

### Bug 2: Redundant pre-check in `rpc-manager.ts` that duplicates `AgentSession.compact()` logic

**Location**: `rpc-manager.ts` `send("compact")` (lines 129–144)

```typescript
case "compact": {
  const pathEntries = this.inner.sessionManager.getBranch();
  const lastEntry = pathEntries[pathEntries.length - 1];
  if (lastEntry?.type === "compaction") {
    throw new Error("Already compacted");
  }
  const messageCount = pathEntries.filter((e) => e.type === "message").length;
  if (messageCount < 4) {
    throw new Error("Not enough messages to compact");
  }
  const result = await this.inner.compact(...);
  if (!result?.summary) {
    throw new Error("Session is too small to compact — add more messages first");
  }
  return result;
}
```

Problems:
1. **`this.inner.sessionManager` is a private field in `AgentSession`** — accessing it via `this.inner.sessionManager` works because `inner` is typed as `any`, but it bypasses encapsulation. If the pi library changes the field name, this silently breaks.
2. **The `messageCount < 4` threshold is arbitrary and not aligned with `AgentSession.compact()`'s own `prepareCompaction()` logic**, which uses token-count-based cut points, not message counts. A session with 3 very long messages might be compactable; a session with 4 tiny messages might not be. The pre-check gives misleading errors.
3. **Double-checking `!result?.summary`**: `AgentSession.compact()` always returns a `CompactionResult` with a `summary`, or throws. Checking `result?.summary` for falsiness is unnecessary and the error message differs from what the library throws.
4. **The pre-check "Already compacted"** is correct in intent but uses `lastEntry.type === "compaction"` — this only catches the case where the very last entry is a compaction. A compaction entry mid-branch (followed by new messages) would pass this check. However, `AgentSession.compact()` handles this correctly internally.

### Bug 3: `AgentSession.compact()` calls `this.abort()` first — destroys active streaming state

**Location**: `agent-session.js` `compact()` implementation

```javascript
async compact(customInstructions) {
  this._disconnectFromAgent();
  await this.abort();          // <-- aborts current prompt if streaming
  ...
}
```

In the web context, if the user clicks "Compact" while the agent is streaming (which is prevented by the `disabled={isStreaming}` check), the abort would cancel the current run. The UI correctly disables the compact button during streaming (`disabled={isStreaming || isCompacting}`), so this is not currently exposed. But if `agentRunning` state gets out of sync with actual agent state, a compact call could silently abort an ongoing turn.

### Bug 4: No SSE events emitted for manual compact — UI doesn't update `isCompacting` during long compactions

`AgentSession.compact()` does NOT emit `auto_compaction_start` / `auto_compaction_end` events for **manual** compaction. Those events are only emitted in `_runAutoCompaction()`. The `isCompacting` getter returns `true` while the `_compactionAbortController` is set, but:

- The web UI sets `isCompacting = true` client-side before the fetch
- The fetch is blocking (awaited) — the button stays disabled until the POST returns
- No SSE event pushes `isCompacting` state updates during the LLM summarization call

**Consequence**: If the LLM call inside `compact()` takes 30+ seconds, the UI shows "Compacting…" for the entire duration. This is tolerable but there is no progress indication. More critically: if the user refreshes the page mid-compact, the `isCompacting` state is lost. On remount, `GET /api/agent/[id]` returns `isCompacting: true` from `inner.isCompacting`, and `setIsCompacting(true)` is called — but there is no SSE event to set it back to `false` when compaction finishes, because:

```typescript
// ChatWindow.tsx mount effect:
if (d.state.isCompacting !== undefined) setIsCompacting(d.state.isCompacting);
// handleAgentEvent does NOT handle auto_compaction_end or any compact-done signal
```

After refresh mid-compact, the compact button would remain disabled even after compaction completes, until the user switches to another session and back (which remounts ChatWindow).

**Fix needed**: Either (a) handle `auto_compaction_start`/`auto_compaction_end` SSE events in `handleAgentEvent` to sync `isCompacting`, or (b) after compact POST returns, always reset `isCompacting` and reload (already done), or (c) poll `get_state` after returning from a compact while `isCompacting` is true.

For auto-compaction specifically, the events ARE emitted over SSE (`auto_compaction_start`, `auto_compaction_end`) but `handleAgentEvent` has no cases for them — so `isCompacting` is never set to `true` during auto-compaction triggered server-side, and the UI shows no indication.

### Bug 5: `compactError` persists across session switches

`compactError` state lives in `ChatWindow`. When the user switches sessions, `ChatWindow` is remounted (due to `sessionKey` increment in `AppShell`), so the error is cleared. This is correct. **No bug here.**

### Bug 6: `loadContext` in `handleCompact` is missing — `entryIds` goes stale

After compaction, `handleCompact` calls `loadSession(sid, true)`. `loadSession` updates `messages` and `entryIds`. However, `loadContext` is NOT called, which is correct since `loadSession` already replaces the full session data including `entryIds`. **No bug here either**, assuming `loadSession` sets `entryIds` from `d.context.entryIds ?? []`.

### Bug 7: `compaction` rendering in `session-reader.ts` — entries before `firstKeptEntryId` are included if it's not found

**Location**: `session-reader.ts` `buildSessionContext()` (lines 287–296)

```typescript
const compactionIdx = path.findIndex(e => e.type === "compaction" && e.id === compaction!.id);
let foundFirstKept = false;
for (let i = 0; i < compactionIdx; i++) {
  const entry = path[i];
  if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
  if (foundFirstKept) appendMessage(entry);
}
for (let i = compactionIdx + 1; i < path.length; i++) {
  appendMessage(path[i]);
}
```

If `firstKeptEntryId` is not found in the path before the compaction entry (malformed session data), `foundFirstKept` stays `false` and **zero messages** from before the compaction are rendered — the summary is injected but no "kept" pre-compaction messages appear. This is a silent failure with no error.

More practically: `firstKeptEntryId` should always be present in the path by construction (pi sets it when creating the compaction entry). But if the `.jsonl` file is manually edited or a migration bug occurs, this could silently hide messages.

### Bug 8: `sid` dependency missing in `handleCompact`

```typescript
const handleCompact = useCallback(async () => {
  const sid = sessionIdRef.current;
  if (!sid || isCompacting) return;
  ...
}, [isCompacting, loadSession]);  // <-- sid is read from ref, not state, so not in deps
```

`sessionIdRef.current` is a mutable ref, not tracked by React deps. This is intentional (same pattern used in `handleSend`, `handleFork`, etc.) and correct — refs don't need to be in deps. **No bug.**

### Summary Table

| # | Location | Severity | Status | Description |
|---|----------|----------|--------|-------------|
| 1 | `rpc-manager.ts` `send("compact")` | Medium | **Fixed** | Removed redundant pre-check using private `sessionManager` field; `messageCount < 4` threshold mismatched library's actual compaction logic. Now delegates entirely to `AgentSession.compact()` which throws the proper error itself. |
| 2 | `ChatWindow.tsx` `handleAgentEvent` | Medium | **Fixed** | Added `auto_compaction_start`/`auto_compaction_end` cases — `isCompacting` is now set/cleared via SSE during auto-compaction; on `auto_compaction_end` without error, `loadSession` is called to refresh the view. |
| 3 | `ChatWindow.tsx` mount effect | Low | **Fixed** (via Bug 2 fix) | With `auto_compaction_end` handled, the button will clear when compaction finishes even if triggered during SSE reconnect on mount. |
| 4 | `session-reader.ts` `buildSessionContext` | Low | **Fixed** | If `firstKeptEntryId` is not found in path (malformed data), now skips all pre-compaction entries cleanly instead of silently rendering zero messages. |
| 5 | `agent-session.js` (library) | Info | Accepted | Manual compact does not emit `auto_compaction_start`/`end` events, only auto-compaction does; web UI has no per-event progress for manual compact. The blocking POST + "Compacting…" label is the correct UX. |

### Compact flow (post-fix)

1. User clicks **Compact** → `isCompacting = true`, button shows "Compacting…" (disabled)
2. `POST /api/agent/[id]` with `{ type: "compact" }` → `AgentSession.compact()` runs (LLM call)
3. On success → `loadSession(sid, true)` refreshes messages (summary injected at top of list, scroll goes to bottom)
4. On error (already compacted, too small, no API key) → `compactError` shows inline in red; button re-enables immediately
5. **Auto-compaction** (triggered server-side during streaming): `auto_compaction_start` SSE → `isCompacting = true`; `auto_compaction_end` SSE → `isCompacting = false` + reload if successful

---

## Development Rules

1. **Test every code change.** Run `node_modules/.bin/tsc --noEmit` and `node node_modules/next/dist/bin/next lint`. **Never run `next build` during development** — it pollutes `.next/` and causes `Cannot find module './xxx.js'` on next `npm run dev`.

2. **Keep AGENTS.md in sync.** Update when adding/changing features, API routes, component props, or design decisions.
