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

**Session browsing** (read-only): reads `.jsonl` files directly via `lib/session/session-reader.ts` — no AgentSession created.  
**Sending a message**: `startRpcSession()` in `lib/agent/rpc-manager.ts` creates an AgentSession in-process.

---

## File Map

```
src/
  app/api/
    sessions/route.ts               GET  list all sessions
    sessions/[id]/route.ts          GET/PATCH/DELETE session
    sessions/[id]/context/route.ts  GET ?leafId= — context for a specific leaf
    sessions/[id]/export/route.ts   GET — export session as markdown
    sessions/archive-batch/route.ts POST — batch archive sessions
    sessions/delete-batch/route.ts  POST — batch delete sessions
    sessions/unarchive-batch/route.ts POST — batch unarchive sessions
    sessions/archived/route.ts      GET — list archived sessions
    agent/new/route.ts              POST { cwd, message, toolNames?, provider?, modelId? }
    agent/[id]/route.ts             GET state | POST any command
    agent/[id]/events/route.ts      GET SSE stream
    files/[...path]/route.ts        GET file contents for viewer
    models/route.ts                 GET { models, modelList, defaultModel }
    models-config/route.ts          GET/POST — read/write ~/.pi/agent/models.json
    skills/search/route.ts          GET — search installable skills
    skills/install/route.ts         POST — install a skill

  lib/
    agent/
      rpc-manager.ts      AgentSessionWrapper + registry + startRpcSession
      agent-client.ts     sendAgentCommand() — client-side helper for agent API
      pi-types.ts         type shims for @earendil-works/pi-coding-agent
    session/
      session-reader.ts   parse .jsonl; getModelNameMap/getModelList/getDefaultModel
      session-utils.ts    deleteSession, archiveSession, unarchiveSession, renameSession
      normalize.ts        normalizeToolCalls() — field name mismatch between file format and our types
      file-paths.ts       encodeFilePathForApi, getFileName, getRelativeFilePath
    shared/
      types.ts            shared TypeScript types
      npx.ts              runNpx() — spawn npx with output streaming

  components/
    layout/
      AppShell.tsx        layout + URL state + tab management
    chat/
      ChatWindow.tsx      messages + streaming + SSE + fork/navigate logic
      ChatInput.tsx       input bar + model/thinking/tools/compact controls
      MessageView.tsx     renders one message (user/assistant/toolCall/toolResult)
      BranchNavigator.tsx in-session branch switcher
      ChatMinimap.tsx     scroll minimap alongside the message list
    session/
      SessionSidebar.tsx  session tree + FileExplorer + batch actions
      FileExplorer.tsx    file tree inside sidebar
      FileViewer.tsx      file content in a tab
      TabBar.tsx          tab bar (Chat + open file tabs)
      FileIcons.tsx       file-type icon mapping
    settings/
      ToolPanel.tsx       exports PRESET_NONE/DEFAULT/FULL + getPresetFromTools
      ModelsConfig.tsx    modal for editing models.json (opened from sidebar bottom)
      SkillsConfig.tsx    skill search & install modal
    shared/
      MarkdownBody.tsx    markdown renderer with syntax highlighting

  hooks/
    useAgentSession.ts    session state, SSE streaming, tool presets
    useAudio.ts           notification sound on agent response
    useDragDrop.ts        drag-and-drop file upload
    useTheme.ts           theme toggle (light/dark)
```

---

## Key Design Decisions & Traps

### AgentSession lifecycle (`lib/agent/rpc-manager.ts`)
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
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/session/normalize.ts` handles this — called in both `session-reader.ts` (file load) and `ChatWindow.handleAgentEvent()` (streaming).

### New session tool preset
Tool names are passed at session creation (`POST /api/agent/new` → `toolNames[]`). For existing sessions, the active preset is inferred on mount via `get_tools` → `getPresetFromTools()`. When tools are fully disabled (`toolNames = []`), `rpc-manager.ts` injects a minimal system prompt via `DefaultResourceLoader`.

### Model defaults for new sessions
`GET /api/models` returns `defaultModel` read from `~/.pi/agent/settings.json`. `ChatWindow` pre-selects this on mount for new sessions.

### SSE reconnect on page refresh mid-stream
On `ChatWindow` mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from this response.

### Compaction SSE events
Newer pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled until the response returns.

### Orphaned sessions
Sessions whose first line can't be parsed as a valid header are marked `orphaned: true` in the API response — displayed with an "incomplete" badge in the sidebar and not clickable.

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

## CSS Variables (`src/app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```
