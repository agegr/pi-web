# Side sessions

Why it is built this way: [ADR 0007](../adr/0007-side-sessions.md).

## Creation

- `/side` and `/side <prompt>` are client-side built-ins (`BUILTIN_SLASH_COMMANDS`, `case "side"` in `hooks/useAgentSession.ts`) with `availableWhileStreaming`: nothing reaches the model, no bubble. They post `{ side: true }` to `POST /api/sessions/[id]/fork`. The prompt is stashed per session id (`sideChatPrompts` in `AppShell`) and sent by the tab's `ChatWindow` as `initialPrompt`, once. `pendingQuotePrompt` cannot carry it: that one follows the selected session, and a side chat is never selected.
- `createSideSession()` (`lib/session-fork.ts`) is `forkSessionBranch()`'s copy with another name and one more step: the `pi-web:side` entry is written as the file's second line and the first copied entry is chained under it, because `readSessionRelationEntries()` reads only the first lines. A shell-only branch works as it does for Fork. Refusals are `SessionForkError`'s; the client maps the codes to notices.
- A copy taken mid-run holds what is on disk: finished entries, so it can end on an unanswered prompt or on tool calls with no result (pi-ai sends "No result provided"). The parent's later turns never appear.

## Tools and prompt

- `startRpcSession()` treats a side chat as a normal session, or as Chat only when the parent's pin is empty. `sideToolNames()` gives the active tools: the pin, else the loadout recorded in the transcript's system messages, else `read` and `bash`, cut down to `SIDE_TOOLS`. `SIDE_TOOLS` is passed as pi's `tools` allow-list, which keeps extension, MCP, Code mode and subagent tools out of the registry. **The allow-list alone is not enough**: `tools` overrides what pi restores from the transcript and activates every listed tool (a Read-only parent got `bash` and `powershell`), so the active set must be cut too.
- pi-web's built-in extensions are not created, so no MCP server connects. Other extensions, skills and context files load as usual, so the extension's prompt additions and provider models stay.
- `navigateTree()` and `set_tools` cannot bring a tool back: the allow-list holds for the session's life, and `setRpcSessionTools()` refuses by metadata. Metadata that does not parse is refused by `startRpcSession()`.
- `SIDE_SYSTEM_PROMPT` joins through `appendSystemPromptOverride`, after any `APPEND_SYSTEM.md`, never instead of it. pi turns the difference into one `role: "system"` message in the transcript before the first side message. Anthropic's request places it after that message (a system message must follow a user turn); OpenAI's before.

## Panel and switcher

- `components/SessionChatPanel.tsx` renders a side chat's or subagent's tab, tab id `agent:<sessionId>`: `ChatWindow` with `panel`, which leaves the global Esc to the main chat. Only the active tab is mounted. Side tabs are not restored by a reload; the Agents switcher reopens them.
- A side chat's switcher row opens its tab; it never becomes the main chat, and search skips it. `isHiddenRelation()` is the one test for "a family member, not a sidebar row": unread, notifications, the sound and the tool preset control follow it.
- Tab labels are the lowest number no open tab shows, since every side chat has the same name.
- `POST /api/sessions/stats` counts `sideOwnEntries()`, what a side chat added after `createdAt`.
