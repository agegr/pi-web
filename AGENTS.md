# Pi Agent Web - Development Notes

## Quick Start

```bash
npm run dev   # port 3030
```

Typecheck: `node_modules/.bin/tsc --noEmit`  
Lint: `node node_modules/next/dist/bin/next lint`  
**Never run `next build` during dev** — pollutes `.next/` and breaks `npm run dev`.

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

**Session browsing** (read-only): reads `.jsonl` files directly via `lib/session-reader.ts` — no AgentSession created.  
**Sending a message**: `startRpcSession()` in `lib/rpc-manager.ts` creates an AgentSession in-process.

---

## File Map

```
app/api/
  sessions/route.ts               GET  list all sessions
  sessions/[id]/route.ts          GET/PATCH/DELETE session
  sessions/[id]/context/route.ts  GET ?leafId= — context for a specific leaf
  sessions/new/route.ts           returns 410 (no longer used)
  agent/new/route.ts              POST { cwd, message, toolNames?, provider?, modelId? }
  agent/[id]/route.ts             GET state | POST any command
  agent/[id]/events/route.ts      GET SSE stream
  files/[...path]/route.ts        GET file contents for viewer
  models/route.ts                 GET { models, modelList, defaultModel }
  models-config/route.ts          GET/POST — read/write ~/.pi/agent/models.json
  git-status/route.ts             POST git operations (status, diff, commit, push, etc.)

lib/
  rpc-manager.ts      AgentSessionWrapper + registry + startRpcSession
  session-reader.ts   parse .jsonl; getModelNameMap/getModelList/getDefaultModel
  types.ts            shared TypeScript types
  normalize.ts        normalizeToolCalls() — field name mismatch between file format and our types
  system-prompt-off.ts  minimal system prompt when all tools are disabled

components/
  AppShell.tsx        layout + URL state + tab management
  SessionSidebar.tsx  session tree + FileExplorer
  ChatWindow.tsx      messages + streaming + SSE + fork/navigate logic
  ChatInput.tsx       input bar + model/thinking/tools/compact controls
  MessageView.tsx     renders one message (user/assistant/toolCall/toolResult)
  BranchNavigator.tsx in-session branch switcher
  ChatMinimap.tsx     scroll minimap alongside the message list
  ToolPanel.tsx       exports PRESET_NONE/DEFAULT/FULL + getPresetFromTools
  ModelsConfig.tsx    modal for editing models.json (opened from sidebar bottom)
  FileExplorer.tsx    file tree inside sidebar
  FileViewer.tsx      file content in a tab
  GitPanel.tsx        Git visualizer panel (changes, branches, history, diff modal)
  TabBar.tsx          tab bar (Chat + open file tabs)
```

---

## Key Design Decisions & Traps

### AgentSession lifecycle (`lib/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id, keyed in `globalThis.__piSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- Idle timeout: 10 minutes. Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)

### Fork must destroy the wrapper immediately
`AgentSession.fork()` **mutates the wrapper's inner state in-place** — after fork, `inner.sessionId` is the *new* session's id. If the wrapper stays alive in the registry under the old id, the next request gets the already-forked state and subsequent forks produce a corrupt `parentSession` chain.

**Fix**: `send("fork")` captures `newSessionId`, then calls `this.destroy()` before returning. The next request for the original session reloads a clean AgentSession from the original file.

### Two kinds of branching — don't confuse them
- **Fork** (Fork button on user message): creates a new independent `.jsonl` file. Shown as a child in the sidebar tree via `parentSession` header field.
- **In-session branch** (Continue button / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

### Session files can be fully rewritten
`parentSession` in the header is **display metadata only** — has zero effect on chat content. Safe to `writeFileSync` the entire file (pi does this itself during migrations). Used when cascade-reparenting children on delete.

### ToolCall field normalization
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called in both `session-reader.ts` (file load) and `ChatWindow.handleAgentEvent()` (streaming).

### New session tool preset
Tool names are passed at session creation (`POST /api/agent/new` → `toolNames[]`). For existing sessions, the active preset is inferred on mount via `get_tools` → `getPresetFromTools()`. When tools are fully disabled (`toolNames = []`), `rpc-manager.ts` injects a minimal system prompt via `system-prompt-off.ts` + `DefaultResourceLoader`.

### Model defaults for new sessions
`GET /api/models` returns `defaultModel` read from `~/.pi/agent/settings.json`. `ChatWindow` pre-selects this on mount for new sessions.

### SSE reconnect on page refresh mid-stream
On `ChatWindow` mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from this response.

### Compaction SSE events
Newer pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled until the response returns.

### Orphaned sessions
Sessions whose first line can't be parsed as a valid header are marked `orphaned: true` in the API response — displayed with an "incomplete" badge in the sidebar and not clickable.

---

## Git Panel (`components/GitPanel.tsx`)

A full-featured Git visualizer docked as a right-side tab via virtual file path `"git"`.

### Architecture
- **Activation**: `FileViewer.tsx` intercepts `filePath === "git"` and renders `<GitPanel cwd={cwd} />` instead of a file viewer.
- **Navigation**: `AppShell.tsx` adds a "Git" button in the global header that pushes a virtual tab `{ id: "file:git", label: "Git", filePath: "git" }` and opens the right panel.
- **API bridge**: All git operations go through `POST /api/git-status` with action field.
- **cwd resolution**: `FileViewer` receives `currentCwd` (not `activeCwd`) from `AppShell` — this includes session cwd, ensuring the Git panel follows project switches.

### Tab layout (three tabs, not stacked sections)
1. **CHANGES (变更清单)**: File tree with parent-child checkbox cascading, stage/commit workflow, diff on double-click.
2. **BRANCHES (分支管理)**: Local/Remote branch list with checkout/merge/delete. Current branch highlighted with blue left border + `HEAD` badge.
3. **HISTORY (提交日志)**: Commit log with resizable file detail panel (drag handle at top).

### File tree (`buildFileTree`)
Uses `ensureFolder(path)` recursive insert with `Map<string, FileTreeNode>` for dedup. Each file path is normalized (backslash → forward slash, strip quotes) before processing. **Do NOT use `Record<string, FileTreeNode>` + `parent.find()` — causes same-name folder conflicts at different depths.**

The tree renderer (`renderNode`) mirrors `FileExplorer.tsx`:
- Folder row: `<span onClick={toggle}>` (chevron) + `<input type=checkbox>` (cascading) + `<FolderIcon>` + name
- File row: `<span width=10>` (spacer) + `<input type=checkbox>` + `<FileIcon>` + name
- Indent: `paddingLeft: 8 + depth * 14` for all rows

### Diff modal (side-by-side)
- Myers diff algorithm computes aligned `DiffSegment[]` (equal/del/add/replace)
- Segments grouped into hunks; equal hunks auto-collapse with 3 lines context
- Per-hunk rollback buttons ("回滚此段") + whole-file rollback in header
- Synchronized scrolling between left/right panels
- `write-file` API action for partial file writes (hunk rollback)

### Key design rules
- **No emojis** — all visual indicators use SVG icons (`IconGitBranch`, `Chevi`, `IconRefresh`) matching the rest of the app.
- **No nested `<button>`** — section headers use `<div>` wrapper to avoid React hydration errors.
- **Folder count badge** — right-aligned number on folder rows (count = recursive leaf files).
- **All tooltips in Chinese** (`title="双击查看 Diff"`).

### Input draft persistence
Chat input text is saved to `localStorage` per project (`pi-web:draft:{cwd}`) so it survives project switches. Cleared on send.

### Common pitfalls
- **CJK filenames (中文路径)**: `git status -s` quotes non-ASCII paths with octal escapes (`\346\216\245...`). **Always use `git -c core.quotePath=false`** on all commands that output file paths (`status`, `log`, `show --name-status`, `show HEAD:"path"`). Without this, Chinese filenames become unreadable and the file tree breaks.
- **Status label**: `git status -s` first 2 chars are the status prefix (` M`, `??`). **Do not `.trim()` before slicing** — truncates filenames by 1 char.
- **Binary files**: The API route detects `.png/.jpg/.webp/.gif/.mp3/.mp4` extensions and returns `{ binary: true }` instead of attempting to diff.
- **checkedFiles staleness**: `fetchGitStatus` must rebuild `checkedFiles` from scratch (only keeping files still in `modifiedFiles`), not append. Otherwise old entries accumulate and the count drifts.
- **Section flex**: When a section is collapsed (secOpen.* = false), set its container to `flex: "0 0 auto"` to avoid leaving empty space.
- **History panel height**: Fixed `height: 160` causes cramped view. Use `minHeight: 60` + drag handle instead.

---

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and navigate_tree calls.

---

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```
