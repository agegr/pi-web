# Sessions, branching and live events

## AgentSession lifecycle (`lib/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id in `globalThis.__piSessions` (`globalThis` survives Next.js hot reload; a module-level Map does not). Concurrent `startRpcSession()` calls share one start Promise (`globalThis.__piStartLocks`). Idle timeout: 10 minutes (`PI_WEB_IDLE_TIMEOUT_MS`, `0` disables).
- Stop cannot cancel a run awaiting a promise that ignores the abort signal (a third-party extension handler or tool): `inner.abort()` never returns. So Stop (`abort`, `abort_bash`) sets `forceShutdownOnIdle` and arms the idle timer, shutting the wrapper down one idle timeout after the first Stop even while it runs. Later commands (a reload's `get_tools`, Stop again) must not push that deadline back; with `PI_WEB_IDLE_TIMEOUT_MS=0` it still arms, at 10 minutes.
- **A wrapper is closing from the moment `shutdown()` or `destroy()` starts**: `isAlive()` turns false at once, so routes stop sending it commands, but `startRpcSession()` builds the replacement only once it has disposed (`closingRpcSessionWait()`, at most the shutdown deadline plus 1 s). Until then it owns the session: an extension's `session_shutdown` may append to the file, and `dispose()` releases provider resources (a Codex websocket) by session id. `setRpcSessionTools()` waits likewise for a closing wrapper or a start under way, then applies the selection to the resulting wrapper, never through a second `SessionManager`. A stuck run counts as busy (`isRunning()`) until disposal.
- The closing wrapper stays in `__piSessions` until disposed or replaced; its `onDestroy` removes the entry only while it still points at that wrapper, or a late cleanup would unregister the replacement. `registerRpcWrapper()` clears the callback of the entry it replaces (a pre-hot-reload wrapper still deletes by id).
- Extensions get `PI_WEB_SHUTDOWN_DEADLINE_MS` (5 s; `0` or invalid keeps the default) for `session_shutdown`, then the wrapper logs once and disposes anyway: closing an MCP connection has no upper bound. Extension binding is awaited first, without a deadline.

## Fork never touches the running AgentSession
Never fork through `AgentSession.fork()` / `AgentSessionRuntime.fork()`: they replace the session in place (`inner.sessionId` becomes the new id; the current run is aborted first), so a wrapper registered under the old id would serve the forked state and corrupt the `parentSession` chain.

`send("fork")` / `send("fork_branch")` open a separate `SessionManager` on the source file and `createBranchedSession()` from it. So forking works **while the source runs** (only a running `!` shell command refuses): pi appends each finished entry synchronously in this process, and the in-flight assistant message lands after the fork point. A source with no file yet is refused with the upstream "has not been saved yet" wording. After a `fork` (never `fork_branch`) an idle source is shut down, since the browser moves to the child; a running one keeps its run and its running row. `clone` refuses a running session: it copies the current branch, which is the run in progress.

## In-session branching waits for the run
pi's `navigateTree()` refuses while streaming or compacting: the file has one leaf pointer that the run appends under, and navigating swaps the agent's context. So "Edit from here" is hidden while busy, the BranchNavigator renders read-only (`locked`) with a note, and `handleLeafChange` refuses (switching only the view would show the live run under another branch). To branch from a running session, fork it.

## Two kinds of branching — don't confuse them
- **Fork** ("New session" on a user message): a new `.jsonl` file, shown as a child in the sidebar via the `parentSession` header field.
- **In-session branch** ("Edit from here" / BranchNavigator): `navigate_tree` within one file; entries share a `parentId`. Switching calls `/api/sessions/[id]/context?leafId=`.

## Session files can be fully rewritten
`parentSession` in the header is **display metadata only**, so rewriting the whole file with `writeFileSync` is safe (pi does it in migrations); cascade-reparenting children on delete relies on this.

## ToolCall field normalization
Pi stores `{type:"toolCall", id, name, arguments}`; `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` (`lib/normalize.ts`) converts in both `session-reader.ts` (file load) and `handleAgentEvent` (`hooks/useAgentSession.ts`, streaming).

## SSE reconnect on page refresh mid-stream
On mount `useAgentSession` loads the history, then `GET /api/sessions/[id]/state` (`loadSession(…, includeState)`): `state.isStreaming` or `state.isPromptRunning` resumes the run in the UI, and `thinkingLevel` / `isCompacting` sync from it. No reconnect is needed: the selected session's stream stays open whether or not it runs (`maintainEventsConnected()`, warm-session effect), and its `connected` event carries `isStreaming`.

## Compaction SSE events
`handleAgentEvent` accepts `compaction_start` / `compaction_end` and the older `auto_compaction_*` pair to keep `isCompacting` in sync. Manual compact is a blocking POST: `isCompacting` holds until it returns, the button meanwhile Stop compaction (`abort_compaction`).

## Tool execution events on the SSE stream
- Calls made through `ctx.executeTool()` (a codemode script's) emit `tool_execution_*` with `parentToolCallId` and ids `<parent>/<n>`. `toClientAgentEvent()` sends their start and end slim and drops their updates; test for nesting *before* rebuilding an update, which keeps only `toolCallId`, `toolName` and `partialResult` (a nested update would reach the browser as a top-level tool). `handleAgentEvent` keeps them out of the running-tools phase; `AgentSessionWrapper` never records them for replay, a parent's end forgets every id under `<parent>/`, and `agent_end` clears the replay set.
- `tool_execution_end` never carries `result` (up to 1 MiB of bash output): the browser renders the tool result message that follows. `entry_appended` is omitted. A codemode update's `details.calls` keeps the newest 200, `omittedCalls` counting the rest.
- `createAgentEventStream()` coalesces `tool_execution_update` per `toolCallId` (latest wins, `TOOL_UPDATE_COALESCE_MS`) and discards that id's pending update before forwarding its `tool_execution_end` (`agent_end` discards all), or the tool would read as running again. Everything else goes at once, so a pending update can arrive after unrelated events.
- A codemode card shows the script in the box any tool's input uses (plain text) and its `details.calls` as rows, never as cards: those calls never reach the model as tool calls. `handleAgentEvent` keeps a running script's progress snapshot in `activeToolResults`, as for shell output, so calls list while they run.

## Transcript system messages, usage entries and context edits (pi >= 0.86)
- A new session's first request persists a `message` entry with `role: "system"` (prompt sections, tool declarations); prompt or tool changes append more, announced with `message_start` / `message_end`. They are provider input, never conversation: `toClientAgentEvent()` drops them (they carry every tool schema), `handleAgentEvent` skips strays, `entryToUiMessage()` returns null, and `BranchNavigator` / `lib/project-tree.ts` never label or preview a branch with one. They still count toward `messageCount` and `totalMessages`, as in the SDK.
- `usage` entries (`kind: "cache_warm"`): billed prompt-cache warming outside model context; `computeSessionStats()` adds them like compaction usage so counters match the TUI's `/session`.
- `context_edit` entries omit or replace an earlier entry's model context without changing raw history; the UI ignores them. A retain-none compaction stores its own id in `firstKeptEntryId`.
- `listSessionsIncremental()` must keep `SessionManager.listAll()`'s order: newest mtime first, then reverse filename, stable for equal activity time.

## Running state polling + reconciliation
- The sidebar polls `/api/agent/running` every 2.5 s while the tab is visible; the session-list response is the initial fallback.
- `invalidateSessionListCache()` bumps the generation but **keeps** the previous scan, fresh only while its generation matches. Callers needing only metadata (search hits to sidebar rows) pass `listAllSessions({ allowStale: true })` to read it while it rebuilds in the background, accepting that a seconds-old session is missing.
- `useAgentSession` treats per-session SSE as primary and opens it before each prompt. `prompt_done` completes the UI stage and notification at once, but the stream stays open for the next prompt: the selected session's while selected (`scheduleEventStreamClose()` skips it), any other's for a 30-second grace window. `agent_start` cancels the close timer; `agent_settled` finishes extension-injected runs that have no wrapper-level `prompt_done` and starts a fresh grace window. Never close on the first `agent_end`: retries, compaction and extension-queued messages continue the same logical prompt.
- While a run is active, `useAgentSession` polls `GET /api/agent/[id]` and reconciles on `visibilitychange` / `online`, for terminal events missed by background tabs or half-open connections.
- Prompt runs carry a monotonic run id; late SSE or reconciliation answers from an old run must be ignored, or they resurrect stale streaming bubbles.
- Every SSE (re)connection is gated on `sessionHookMountedRef`. Under React Strict Mode (`next dev`) the mount-only effect's cleanup clears it and restores it only after the warm-session effect re-runs, so that effect must re-assert it before `maintainEventsConnected()`, or a dev tab never opens its stream.

## Exported session HTML
- `/api/sessions/[id]/export` delegates to pi's export helper, then makes the generated HTML's recursive tree helpers iterative, so very deep linear sessions do not overflow the browser call stack.

## Deleting the selected session outlives the delete click (`components/AppShell.tsx`)
- `SessionItem.performDelete` captures `onDeleted` at the delete click, and `handleSessionDeleted` is a `useCallback` whose `selectedSession` closure is from that same render. The DELETE request can complete **after** the user has switched sessions, so the captured selection still names the session being deleted.
- The empty-composer fallback therefore guards on the latest selection read from a render-synced ref (`selectedSessionRef.current`), not the captured state, and takes the fallback cwd from that ref too: a user who navigated away stays on their new chat, and a user who lands on the deleting session in flight still gets a fresh composer in its cwd.
- `setRefreshKey()` and `invalidateWorkspaceRestore()` run unconditionally, so the sidebar list and any pending workspace restore never resurrect the deleted session.
