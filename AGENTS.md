# Pi Web - Development Notes

## Quick Start

```bash
npm run dev   # port 30141
```

Typecheck: `node_modules/.bin/tsc --noEmit` · Lint: `npm run lint`

**Never run `next build` during dev**: it pollutes `.next/` and breaks `npm run dev`.

### Dev server troubleshooting

- First run `lsof -nP -iTCP:30141 -sTCP:LISTEN` and reuse a healthy Pi Web process. A second `next dev` on another port is no workaround: both contend for `.next/dev/lock`.
- A browser-only `Module ... factory is not available` overlay usually means that tab has a stale Turbopack/HMR graph, not a broken server or source. Use the browser's explicit reload, then compare the server log and a direct HTTP/API request.
- Restart only when the failure reproduces from a fresh page and the server-side checks fail too: stop that exact dev process gracefully, move `.next` into a `mktemp -d` backup, restart with `npm run dev`.
- Never fall back to `next dev --webpack`: the dev graph can fail on `undici` imports such as `node:console`. Development uses Turbopack.
- `next dev` may append a generated `BEGIN:nextjs-agent-rules` block to `AGENTS.md`. It is tooling output: check `git status` and keep it out of unrelated commits.

### Upgrading pi

The published pi-web ships no lockfile, so its dependencies resolve afresh on install, and pi up to 1.2.0 linked its own packages with `^` ranges. Install every `@earendil-works/*` package the tree holds, the SDK's own dependencies included (`pi-codemode`, `pi-mcp`, `pi-telemetry`, …), with `npm install --save-exact`, so npm reuses those exact versions for the SDK's ranges. `lib/pi-packages.test.mjs` fails on any pi package that is not pinned that way.

---

## Architecture

- **Browsing** (read-only, no AgentSession): `GET /api/sessions` lists `~/.pi/agent/sessions/`; `GET /api/sessions/[id]` reads the `.jsonl` through SDK `SessionManager` helpers and `lib/session-reader.ts`, or an open wrapper's in-memory `SessionManager`. `GET /api/agent/running` snapshots the running ids.
- **Sending**: `POST /api/agent/[id]` → `startRpcSession()` (`lib/rpc-manager.ts`) creates the AgentSession in-process (`createAgentSessionFromServices()`); `session.send(cmd)` → `session.prompt()`.
- **Events**: `GET /api/agent/[id]/events` streams SSE `data: {...}` from `session.onEvent()`, fed by `session.subscribe()`.
- **Product scope**: a light web wrapper around pi, not an IDE or a platform of its own. Before adding a feature, check the out-of-scope list in [CONTRIBUTING.md](CONTRIBUTING.md).
- **Extension compatibility (principle)**: extensions written for the pi CLI must behave the same here. Fix display problems in the web client; never add pi-web-only options or fields to the extension API (`ctx.ui.*` options, `extension_ui_request`). pi's TUI (`node_modules/@earendil-works/pi-tui`) is the reference for what an extension asking for something means.

## UI Copy

Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.

## Bug Fixes

Fix a bug at its cause, reasoning from first principles and established best practice. Do not patch over the symptom.

---

## API Routes

Each route's methods and parameters; code elsewhere is found by name (`ls lib components hooks`) and through the topic notes' file lists.

```
app/api/
  sessions/route.ts                GET list all sessions
  sessions/[id]/route.ts           GET/PATCH/DELETE a session
  sessions/[id]/context/route.ts   GET ?leafId=&tail=&before= a page of a leaf's context (tail defaults to 50; before pages upward; leafId defaults to pi's leaf, named in the reply)
  sessions/[id]/export/route.ts    GET exported HTML
  sessions/[id]/fork/route.ts      POST copy the session's current branch into a new session, or { side: true } a side chat (never starts an AgentSession)
  sessions/delete/route.ts         POST { ids } delete sessions and their subagents (a project's Delete all sessions); running ones kept
  sessions/stats/route.ts          POST { ids } each session's tokens, cost, tool calls, active time (the agent switcher's rows)
  sessions/[id]/state/route.ts     GET live wrapper state while running
  sessions/ui-state/route.ts       GET/POST sidebar pins, archive, project order and names, read times (set, restore, pin-project, add-projects, move-project, rename-project, read)
  sessions/[id]/auto-name/route.ts POST generate a session title
  sessions/search/route.ts         GET session search
  agent/new/route.ts               POST { cwd, type: prompt|ensure_session (start only), message?, toolNames?, provider?, modelId?, thinkingLevel? }
  agent/[id]/route.ts              GET state (?systemPrompt=0: without the prompt) | POST any command
  agent/[id]/events/route.ts       GET SSE stream
  agent/[id]/lease/route.ts        POST reset the selected session's idle timer (with or without its stream; never starts one); reply: running, awaitingInput, subagentsActive
  agent/running/route.ts           GET running + awaiting-input session ids, sidebar pins/archive revision, the server's clock
  agent/debug/route.ts             GET ?session= the Debug panel's read-only snapshot: wrappers, streams, subagents, MCP, terminals, file watches
  auth/api-key/[provider]/route.ts POST/DELETE stored provider API key
  auth/login/[provider]/route.ts   GET OAuth/device-code SSE | POST manual code
  auth/logout/[provider]/route.ts  POST OAuth logout
  auth/providers/route.ts          GET OAuth and API-key provider lists
  cwd/validate/route.ts            POST validate/select a cwd
  cwd/browse/route.ts              GET browse any readable directory for the cwd picker | POST create child directory
  default-cwd/route.ts             POST create ~/pi-cwd/YYYYMMDD (local date)
  home/route.ts                    GET user home directory
  open-in-explorer/route.ts        GET availability | POST open a cwd in the OS file manager (loopback only)
  files/[...path]/route.ts         GET ?type=list|read|download|meta|preview|watch | POST ?type=upload|upload-check|allow-link
  file-index/route.ts              GET file list for @-mentions
  git/status/route.ts              GET changed files for a cwd
  git/diff/route.ts                GET diff of one changed file
  worktrees/route.ts               GET/POST/DELETE git worktrees
  terminal/route.ts                POST create a terminal session
  terminal/[id]/route.ts           GET { id, cwd } (404 once closed; stream at [id]/events) | POST input/resize | DELETE kill
  mcp/route.ts                     GET [?cwd=] Settings › MCP overview, files only | POST add/enable/disable/remove/undo/set-enabled/set-exposure/set-in-project/sign-out
  mcp/test/route.ts                POST { scope, name, cwd? } test one server once (entry read from its file)
  mcp/sign-in/route.ts             POST { scope, name, cwd? } start or join an OAuth sign-in
  mcp/sign-in/[flowId]/route.ts    GET flow state (polled) | POST { redirectUrl } | DELETE cancel
  project-trust/route.ts           GET trust status + project .pi/mcp.json servers (files only) | POST trust, rebuild the cwd's wrappers
  tools/settings/route.ts          GET/PUT defaultTools switches: PowerShell (Windows), Code mode automatic/always; codemode.mode, codemode.inlineBudget
  cache-miss-notices/route.ts      GET/PUT pi's global showCacheMissNotices (Settings › General)
  models/route.ts                  GET ?cwd= { models, modelList, defaultModel, … }
  models/enabled/route.ts          GET/PUT enabledModels switches
  models/default/route.ts          PUT default model / reasoning level for new sessions
  models/refresh/route.ts          POST fetch provider catalogs from pi.dev on demand
  models-config/route.ts           GET/PUT ~/.pi/agent/models.json
  models-config/catalog/route.ts   GET models.dev pricing presets
  models-config/discover/route.ts  POST fetch a configured provider's upstream model list
  models-config/test/route.ts      POST test a configured model/provider
  plugins/route.ts                 GET/POST package plugin management
  plugins/check/route.ts           POST check plugin package updates
  skills/route.ts                  GET/PATCH loaded skills, disable-model-invocation
  skills/content/route.ts          GET one loaded skill's bounded Markdown source, or ?document= a Markdown file in its folder
  skills/install/route.ts          POST install skills via npx skills add
  skills/search/route.ts           POST skills.sh search
  subagents/settings/route.ts      GET/PUT built-in subagent switch and maxConcurrent
  web-auth/route.ts                GET status | POST login | DELETE logout (browser password)
  provider-usage/query/route.ts    POST provider usage quotas
  push/config/route.ts             GET VAPID public key
  push/subscribe/route.ts          POST register a push subscription
  app-update/route.ts              GET current vs latest published pi-web version
```

---

## Topic Notes

Design decisions and traps live in `docs/agents/`, one note per area. Read every note whose files a change touches before making it. Add new notes to the area's file, not here.

- [sessions.md](docs/agents/sessions.md): AgentSession lifecycle, session file reads and rewrites, SSE and running state, the chat transcript's rendering (messages, tool cards, Markdown, code, notices), the session sidebar and new-session bar, the Debug panel. Files: `lib/rpc-manager.ts`, `lib/startup-issues.ts`, `lib/session-reader.ts`, `lib/session-fork*.ts`, `lib/session-delete.ts`, `lib/normalize.ts`, `lib/message-keys.ts`, `lib/idle-message-read.ts`, `lib/session-tree.ts`, `lib/session-ui-state*.ts`, `lib/unread-markers.ts`, `lib/user-attention.ts`, `lib/sidebar-prefs.ts`, `lib/sidebar-actions.ts`, `lib/session-links.ts`, `lib/session-search*.ts`, `lib/favicon-badge.ts`, `lib/new-session-context.ts`, `hooks/useAgentSession.ts`, `hooks/useSessionUiState.ts`, `hooks/useSidebarMotion.ts`, `hooks/useGroupDrag.ts`, `hooks/useFilesPlacement.ts`, `hooks/useResizablePanel.ts`, `app/api/agent/**`, `app/api/sessions/**`, `components/SessionSidebar.tsx`, `components/PiWebTitle.tsx`, `components/SessionTree.tsx`, `components/SidebarMenu.tsx`, `components/SidebarToast.tsx`, `components/SidebarIcons.tsx`, `components/ProjectWorktreePicker.tsx`, `components/NewSessionContextBar.tsx`, `components/WorktreeCreateForm.tsx`, `handleNewSession`, `handleSelectSession` and the bar's handlers in `components/AppShell.tsx`, `components/BranchNavigator.tsx`, `components/MessageView.tsx`, `lib/message-display.ts`, `lib/patch.ts`, `components/FileViewer.tsx`, `components/MarkdownBody.tsx`, `lib/markdown.ts`, `lib/markdown-blocks.ts`, `lib/streaming-message.ts`, `hooks/useStreamingSelector.ts`, `lib/turn-duration.ts`, `lib/tool-clock.ts`, `components/MermaidBlock.tsx`, `components/SvgBlock.tsx`, `lib/highlight-queue.ts`, `lib/prism-languages.ts`, `hooks/usePrismLanguages.ts`, `lib/session-view-cache.ts`, `components/CodemodeToolView.tsx`, `components/ExtensionStatusBar.tsx`, `components/ExtensionWidgets.tsx`, `lib/extension-ui-theme.ts`, `components/AnsiText.tsx`, `lib/transcript-notices*.ts`, `components/TranscriptNotices.tsx`, `app/api/cache-miss-notices/**`, `lib/tool-fields.ts`, `lib/debug-*.ts`, `lib/stream-client.ts`, `lib/page-stream-registry.ts`, `lib/page-debug.ts`, `lib/file-watch-registry.ts`, `components/DebugPanel.tsx`, `components/debug-panel-state.ts`.
- [tools.md](docs/agents/tools.md): tool presets and Chat only, exact system prompts, tool exposure, the codemode / tool-search / mcp built-ins, the read-only MCP policy, the Code mode and PowerShell switches. Files: `lib/tool-presets.ts`, `lib/tool-preset-preference.ts`, `lib/chat-only.ts`, `lib/exact-system-prompt.ts`, `lib/builtin-extensions.ts`, `lib/mcp-read-only-policy.ts`, `lib/codemode-settings.ts`, `lib/powershell-settings.ts`, `lib/global-settings-file.ts`, `app/api/agent/new/route.ts`, `app/api/tools/settings/route.ts`, tool selection in `lib/rpc-manager.ts`.
- [mcp-runtime.md](docs/agents/mcp-runtime.md): the per-session MCP host and `/mcp` in the composer. Files: `lib/mcp-host.ts`, `lib/mcp-transport.ts`, `lib/mcp-status.ts`, `lib/mcp-command.ts`, `lib/mcp-config-key.ts`, MCP wiring in `lib/rpc-manager.ts` and `lib/builtin-extensions.ts`, `/mcp` handling in `hooks/useAgentSession.ts`.
- [mcp-settings.md](docs/agents/mcp-settings.md): Settings › MCP: reads that run nothing, masking, row states and notices, the Code mode choice, trust, every `mcp.json` write and undo. Files: `app/api/mcp/route.ts`, `app/api/project-trust/route.ts`, `lib/mcp-config-read.ts`, `lib/mcp-config-file.ts`, `lib/mcp-override.ts`, `lib/mcp-undo.ts`, `lib/mcp-secrets.ts`, `lib/mcp-server-display.ts`, `lib/mcp-json-error.ts`, `lib/project-trust.ts`, `lib/regular-file.ts`, `lib/stacked-dialog.ts`, `lib/settings-navigation.ts`, `components/McpConfig.tsx`, `components/mcp-config-helpers.ts`, `components/ProjectTrustDialog.tsx`, `components/SettingsPanel.tsx`.
- [mcp-test-sign-in.md](docs/agents/mcp-test-sign-in.md): Settings › MCP Test and OAuth sign-in / sign-out. Files: `app/api/mcp/test/**`, `app/api/mcp/sign-in/**`, `lib/mcp-test.ts`, `lib/mcp-entry-request.ts`, `lib/mcp-status.ts`, `lib/mcp-sign-in.ts`, `lib/mcp-sign-out.ts`, `components/McpSignIn.tsx`, `components/mcp-sign-in-helpers.ts`, `components/OAuthPastePanel.tsx`.
- [mcp-add.md](docs/agents/mcp-add.md): Settings › MCP add pane and the paste importer. Files: `lib/mcp-add.ts`, `lib/mcp-import*.ts`, `lib/shell-words.ts`, fresh-folder trust in `lib/project-trust.ts`, `components/McpAddServer.tsx`, `components/mcp-add-helpers.ts`, the `add` action of `app/api/mcp/route.ts`.
- [models.md](docs/agents/models.md): default model and reasoning level, provider catalogs and credentials, `enabledModels`, the models.json editor. Files: `app/api/models/**`, `app/api/models-config/**`, `app/api/auth/**`, `lib/model-runtime.ts`, `lib/default-preferences.ts`, `lib/model-scope.ts`, `lib/enabled-models*.ts`, `lib/model-context.ts`, `lib/model-image-limits.ts`, `lib/model-provider-check.ts`, `lib/model-catalog-refresh.ts`, `lib/deferred-provider-models.ts`, `lib/provider-listing*.ts`, `components/ModelsConfig.tsx`, `components/EnabledModelsSection.tsx`, `components/ModelContextWindow.tsx`, `components/ModelSelector.tsx`, `components/SelectorRow.tsx`.
- [files-and-access.md](docs/agents/files-and-access.md): the `/api/files` allow-list (the security boundary), worktrees and project grouping, the file tree, uploads and chat drops, file previews, web password throttling. Files: `app/api/files/**`, `app/api/cwd/**`, `app/api/worktrees/**`, `app/api/file-index/**`, `app/api/web-auth/**`, `proxy.ts`, `lib/path-security.ts`, `lib/file-access.ts`, `lib/linked-directory.ts`, `lib/session-file-references*.ts`, `lib/file-tree-visibility.ts`, `lib/file-tree-expansion.ts`, `lib/file-upload-client.ts`, `lib/file-version.ts`, `lib/html-sandbox-polyfill.ts`, `lib/worktree.ts`, `lib/paths.ts`, `lib/auth-throttle.ts`, `components/ProjectWorktreePicker.tsx`, `components/NewSessionContextBar.tsx`, `components/FileExplorer.tsx`, `lib/delimited-table.ts`, `components/DelimitedTable.tsx`, the table branch of `components/FileViewer.tsx`, `hooks/useDragDrop.ts`, `components/DirectoryPicker.tsx`.
- [settings-ui.md](docs/agents/settings-ui.md): General settings, the Plugins and Skills routes, sidebar group switches, the shared `SettingsUi` blocks. Files: `app/api/plugins/**`, `app/api/skills/**`, `lib/skills-service.ts`, `components/SettingsUi.tsx`, `components/settings-ui-helpers.ts`, `components/SkillsConfig.tsx`, `components/PluginsConfig.tsx`, `hooks/useFilesPlacement.ts`; also before adding a settings section or add pane.
- [side-sessions.md](docs/agents/side-sessions.md): side chats (ADR 0007): the fork copy, the tool allow-list, the hidden boundary message, the shared tab, usage. Files: `lib/side-session.ts`, `lib/session-fork.ts`, `lib/session-family.ts`, `lib/session-delete.ts`, `lib/session-reader.ts`, side handling in `lib/rpc-manager.ts`, `app/api/sessions/[id]/fork/route.ts`, `app/api/sessions/stats/route.ts`, `components/SessionChatPanel.tsx`, `components/TabBar.tsx`, `components/AgentSessionPanel.tsx`, `components/ChatInput.tsx`, `hooks/useAgentSession.ts`, `lib/side-chat-client.ts`, side handling in `components/AppShell.tsx`.
- [subagents.md](docs/agents/subagents.md): the built-in subagent setting, profiles, run status, completion notifications, the subagent tab, the Agents strip. Files: `lib/subagent*.ts`, `app/api/subagents/**`, `components/AgentsConfig.tsx`, `components/SessionChatPanel.tsx`, `components/AgentMiniStrip.tsx`, `lib/agent-strip-lock.ts`, `components/LockToggle.tsx`.
- [client-platform.md](docs/agents/client-platform.md): global shortcuts, the mobile keyboard and viewport, the terminal (shell, keys, theme, font size), the completion sound, the launcher. Files: `hooks/useKeyboardShortcuts.ts`, `hooks/useViewportHeight.ts`, `hooks/useAudio.ts`, `lib/done-chime.ts`, `terminalShell()` in `lib/terminal-manager.ts`, `components/TerminalExtraKeys.tsx`, `lib/terminal-extra-keys.ts`, `lib/terminal-theme.ts`, `hooks/useTerminalTheme.ts`, `terminalFontSize()` in `hooks/useChatAppearance.ts`, the keyboard-open CSS, `bin/browser-opener.js`, the browser opening in `bin/pi-web.js`.

---

## Old Safari (iOS 16.2)

- `/` renders entirely on the client, so one script chunk the browser cannot parse is a blank page. Next 16 targets Safari 16.4+; the `browserslist` in `package.json` lowers Safari and iOS to 16.2 so SWC turns class `static {}` blocks into private static fields. That covers Next's client runtime; other node_modules keep their syntax unless listed in `transpilePackages` (mermaid and `@mermaid-js/parser` are, for their lazy diagram chunks). Keep the other browserslist entries at Next's defaults.
- Never write a RegExp lookbehind (`(?<=`, `(?<!`) in client code: SWC cannot downlevel it and Safari parses it only from 16.4. `lib/markdown.ts` emulates its leading lookbehinds with `replaceNotPrecededBy()`. A lookbehind built at runtime (`new RegExp("(?<=…)")` in `try`) fails only when run; that is how `lib/gfm-autolink-email-loader.cjs` fixes `mdast-util-gfm-autolink-literal`'s email regex. The loader is registered for webpack and Turbopack in `next.config.ts` and fails the build if that regex changes upstream.

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

`SessionContext.entryIds[]` parallels `messages[]`: each displayed message's `.jsonl` entry id, used for fork and navigate_tree.

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
