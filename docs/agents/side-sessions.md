# Side sessions

Why it is built this way: [ADR 0007](../adr/0007-side-sessions.md).

## Creation

- `/side` and `/side <prompt>` are client-side built-ins (`BUILTIN_SLASH_COMMANDS`, `case "side"` in `hooks/useAgentSession.ts`) with `availableWhileStreaming`: nothing reaches the model, no bubble. They post `{ side: true }` to `POST /api/sessions/[id]/fork`. The prompt is stashed per session id (`sideChatPrompts` in `AppShell`) and sent by the tab's `ChatWindow` as `initialPrompt`, once. `pendingQuotePrompt` cannot carry it: that one follows the selected session, and a side chat is never selected.
- `createSideSession()` (`lib/session-fork.ts`) is `forkSessionBranch()`'s copy with another name and one more step: the `pi-web:side` entry is written as the file's second line and the first copied entry is chained under it, because `readSessionRelationEntries()` reads only the first lines, and the boundary message is written last, as the leaf. A shell-only branch works as it does for Fork. Refusals are `SessionForkError`'s; the client maps the codes to notices.
- A copy taken mid-run holds what is on disk: finished entries, so it can end on an unanswered prompt or on tool calls with no result (pi-ai sends "No result provided"). The parent's later turns never appear.

## Tools and prompt

- `startRpcSession()` treats a side chat as a normal session, or as Chat only when the parent's pin is empty. `sideToolNames()` gives its tools: the pin, else the loadout recorded in the transcript's system messages, else `read` and `bash`, cut down to `SIDE_TOOLS`. **That result is pi's `tools` allow-list, not `SIDE_TOOLS` itself**: `tools` overrides what pi restores from the transcript and registers and activates every listed tool, so a wider list gave a Read-only parent `bash` and showed tools the parent never had in the Tools panel. It also keeps extension, MCP, Code mode and subagent tools out of the registry. `resolveShellTools()` applies the PowerShell switch to it.
- pi-web's built-in extensions are not created, so no MCP server connects. Other extensions, skills and context files load as usual, so the extension's prompt additions and provider models stay.
- `navigateTree()` and `set_tools` cannot bring a tool back: the allow-list holds for the session's life, and `setRpcSessionTools()` refuses by metadata. Metadata that does not parse is refused by `startRpcSession()`.
- The prompt is the parent's. pi turns the tool change into one `role: "system"` message in the transcript before the first side message; Anthropic's request places it after that message (a system message must follow a user turn), OpenAI's before.
- **The boundary is a message, not a prompt section.** `SIDE_BOUNDARY_TEXT` is a `custom_message` with `display: false`: pi's `convertToLlm` sends it as a user turn, in place, on every provider, so it says it is not the user speaking. An addendum in the prompt told the model about "the first side-chat message" with nothing marking it: on models without mid-conversation updates it folds into the head, and a fork taken mid-run reads as two user messages in a row. Compaction serializes it like any user message (`[User]: [Side chat] …`), and "Edit from here" above it leaves a branch without it.

## Panel and switcher

- `components/SessionChatPanel.tsx` renders a side chat's or subagent's tab, tab id `agent:<sessionId>`: `ChatWindow` with `panel`, which leaves the global Esc to the main chat. Only the active tab is mounted. Side tabs are not restored by a reload; the Agents switcher reopens them.
- Rows work as subagent rows do: a click opens the side chat in the main chat (the URL holds it, a reload keeps it, the sidebar highlights the parent's row, the "Main agent" row goes back), the button toggles the tab. Search skips side chats. `isHiddenRelation()` is the one test for "a family member, not a sidebar row": unread, notifications, the sound and the tool preset control follow it.
- One session, one chat: two windows would share a draft key and stream the same run twice. An effect in `AppShell` closes the tab of whatever the main chat shows, and that row offers no tab button.
- `renderMessage()` in `ChatWindow` draws the boundary message as the line (`SIDE_BOUNDARY_MESSAGE_TYPE`, client-safe in `lib/session-family.ts`). If it is not loaded (an older page) or compacted away, there is no line.
- Names: `createSideSession()` starts with `SIDE_SESSION_NAME`, and the first prompt replaces it with its first line (`sideChatNameFrom()`, the wrapper's `prompt` command; commands name nothing), which `/name` can change. Rows and tabs show it through `sideChatTitle()`, which falls back to translated words for the default name. `AppShell` rereads the list when a run in an open side tab starts or ends. A tab with no name yet is numbered, the lowest number no open tab shows.
- `POST /api/sessions/stats` and the toolbar's totals (`GET /api/sessions/[id]`) count `sideOwnEntries()`, what a side chat added after `createdAt`. `/session` shows pi's own `getSessionStats()`, the whole file.
