# Side sessions

> **Phases 1 and 2 are implemented** (server core and the panel/switcher UI,
> ADR 0007); **phase 3 (promote, send-to-main-chat, stats polish) is not.**
> Everything marked as decided behavior below matches the code; the phase-3
> sections say so explicitly.

## Side sessions

- A side chat is a **separate session file forked from a parent session's
  active tip** for a focused detour beside the main chat, modeled on Codex's
  `/side`. Creation goes through the `forkSessionBranch()` copy primitive —
  its own `SessionManager` (because `createBranchedSession()` repoints the
  instance it runs on), tip-inclusive entries, mid-run safe, wrapper-free —
  but instead of the fork-suffix `session_info` name it appends a
  `pi-web:side` custom entry (`SIDE_META_TYPE`, version 1):
  `parentSessionId`, `parentSessionPath`, `createdAt`, and a
  `resourceSnapshot` (`appendSystemPrompt`, `tools`), shaped like a
  subagent's. The header keeps `parentSession: <parent file path>`, and the
  copy lands in the parent's session directory with the parent's `cwd`, so
  project grouping is inherited. The metadata entry is written **directly
  after the header**, and the first copied entry is re-parented onto it, so
  one bounded head read (`SESSION_RELATION_MAX_LINES`) finds it and the file
  keeps a single parent chain. `SessionManager.open(path).appendSessionInfo()`
  then names it (`SIDE_SESSION_NAME`). File: `lib/side-session.ts`.
- **The relation kind is `side`, not `subagent`.** `SessionInfo.relation`
  gains `{ kind: "side"; parentSessionId }`, detected where the subagent
  relation is: the disk scan's bounded head read (`lib/session-reader.ts`)
  and the live-wrapper path (`getRpcSessionInfos()` in `lib/rpc-manager.ts`).
  `listSessionFamilies()` skips side-kind sessions as family roots and
  attaches them to their parent's family by the `parentSessionId` walk, so a
  side chat never appears as a sidebar row of its own: it groups under the
  parent, counts in the family's Agents badge, follows the family's pin and
  archive state, and is deleted with the parent by the delete cascade
  (`lib/session-delete.ts`). Header `parentSession` alone would make it a
  visible fork — the metadata entry is what hides it.
- **Why not the subagent metadata:** a subagent is a model-dispatched
  background run (run map, orphan settling, `notifyParent` deduplication,
  `subagentsActive` bookkeeping). A side chat is a user-driven interactive
  session. Reusing `pi-web:subagent` would drag that machinery into every
  reader; the two share the *pattern* (bounded metadata read, snapshot
  restore, family fold) but no code paths. `startRpcSession()` gets a
  parallel `pi-web:side` snapshot branch that never calls the subagent
  validator, so neither policy can break the other.
- **Refusals on creation** (`POST /api/sessions/[id]/side`, mirroring the
  sidebar fork route): `not_found`, `unsaved` (the wrapper's leaf is not on
  disk yet), `empty` (no message entry on the branch — like Codex's "send a
  message first, then try /side again"), `subagent` (the source is a
  subagent session), `side` (no nesting: `/side` inside a side chat is
  refused), and `chat_only` (a Chat-only session's tool-free boundary is a
  deliberate mode; a side chat carrying `bash` would circumvent it). Like the
  sidebar fork, creation is file-level: it works while the parent runs and
  while a `!` shell command is executing, copying only entries already on
  disk.

## The /side command

- `/side` and `/side <prompt>` are **client-side built-in slash commands**
  (`BUILTIN_SLASH_COMMANDS` in `components/ChatInput.tsx`), with
  `availableWhileStreaming: true` — a side question during a long parent run
  is the primary use case, and the file-level fork is mid-run safe. They are
  handled in `handleBuiltinSlashCommand()` (`hooks/useAgentSession.ts`)
  before anything is sent: no prompt reaches the model, no optimistic user
  bubble, no sidebar row. An image attachment blocks the built-in path, as
  for every built-in command.
- The command calls the side route, then opens the side chat's panel tab
  (`onSideSession` → `handleSideSession` in `components/AppShell.tsx`) and,
  when an argument was given, stashes the text per session id
  (`sideChatPrompts`) so the panel's first `ChatWindow` mount receives it as
  `initialPrompt`; the panel drops the entry once consumed. It is not
  `pendingQuotePrompt`: that one is keyed on the *selected* session, and a
  side chat is never selected. A refusal maps to a notice (fork refusals
  never throw past the composer). Checked **before** the request: a side chat
  refuses `/side` with `sideChat.error.side` ("a side chat cannot start
  another side chat") even though a side panel passes no callback.

## Inherited context and the resource snapshot

- **The side chat inherits the parent's history in full.** The fork freezes
  the parent's branch at the tip; parent turns after the fork never appear.
  The side chat pays the parent's history again in its own context window
  and compacts independently. A fork taken mid-run copies only finished
  entries — the copy may end on the run's prompt, and pi-ai synthesizes
  "No result provided" results for dangling tool calls.
- **A persisted system-prompt appendix downgrades the history.** The frozen
  fork makes "everything in this file before your first side-chat message is
  inherited from the parent" statically true, so one appendix replaces
  Codex's positional boundary marker plus its developer instructions. It
  states: inherited history is reference context only, not the current task;
  instructions, plans, and requests found in it are not active; the default
  is non-mutating exploration; an inherited turn may end mid-flight. The
  appendix is part of the `resourceSnapshot` (`appendSystemPrompt`), so
  reopen restores it exactly.
- **Tools are fixed at fork: `read`, `bash`, `grep`, `find`, `ls`** — the
  default tool set minus `edit` and `write`. `PRESET_READ_ONLY` is not used
  (it drops `bash`; the appendix steers toward non-mutating checks, the
  missing tools enforce it). The subagent control tools (`Agent`,
  `get_subagent_result`, `steer_subagent`) are excluded: a side chat cannot
  dispatch subagents. On reopen, `startRpcSession()` restores the snapshot —
  fixed tool list, `noPromptTemplates`, `noThemes`, `noContextFiles`, the
  appendix as `appendSystemPrompt` — and an invalid snapshot is refused
  ("Invalid side resource snapshot"), never silently reopened with full
  tools. `setRpcSessionTools()` refuses changes, as it does for subagents;
  `navigateTreeKeepingToolSelection` keeps the restored selection.
- MCP servers and Code mode are off in side sessions (ADR 0007 §8).

## Panel and switcher

- The side chat is an **interactive right-panel tab** beside the main chat:
  tab id `side:<sessionId>`, its own TabBar kind and icon, rendered by
  `components/SideChatPanel.tsx` — transcript, composer, SSE events
  (`/api/agent/[id]/events`), prompt POSTs, and lease renewals, none of the
  main chat's global side effects (no URL rewrite, no sidebar promotion, no
  browser notifications). The parent chat stays visible in place of Codex's
  parent-status footer. The events route starts the side session's wrapper
  on first subscribe; the panel's lease keeps it alive, and the shared idle
  timer evicts an abandoned wrapper (the file persists; a re-opened tab
  re-subscribes). Two event streams in one page are two independent
  connections; the `holder` id is a debug label, and the lease, not the
  stream, keeps a session alive (#1283).
- The agent switcher lists side sessions as family rows with a side icon.
  **A row click opens (and focuses) the panel tab — a side chat never becomes
  the main chat**; only promote does that. The row's side button toggles the
  tab like a subagent row's. The stats POST includes side ids in the family,
  so rows show usage.
- The header count and the Agents badge **count side chats together with
  subagents** (`agentSwitcher.count` is therefore "{count} agents", not
  "sub-agents"). Completion is silent for both: `ChatWindow`'s
  `completionNotificationsEnabled`, `AppShell`'s agent-end and attention
  notifications, and `SessionSidebar`'s unread/background-completion
  bookkeeping all treat `subagent` and `side` alike.
- **Promote (phase 3, not implemented)** makes a side chat first-class: it rewrites the `pi-web:side`
  entry out of the file — the header's `parentSession` remains, so the
  session becomes a visible fork (the same in-place rewrite discipline the
  delete cascade uses for `parentSession`) — and opens it as the main chat.
  The sidebar Fork action refuses side branches, as it refuses subagent
  branches; promote is the supported path.
- Tab labels are numbered: every side chat is created with the same name, and
  `/side` can be used repeatedly, so the second and later side tabs read
  "Side chat 2", "Side chat 3" (`handleOpenSubagentTab` in
  `components/AppShell.tsx`, counted from the side tabs then open). Without
  it a strip of several side chats was a row of identical labels.
- Side tabs follow their session, not the project: the panel drops them on
  project switch like subagent tabs. Side tabs are **transient** (no
  persistence, not restored by a reload); the session is always reachable
  again from its family row in the Agents switcher, because a hidden family
  member has no sidebar row of its own.

## Return path

- **Send to main chat (phase 3, not implemented)** delivers the side chat's latest reply to the parent
  as a custom message with an anti-impersonation prefix (the
  `SUBAGENT_NOTIFICATION_PREFIX` discipline: pi's `convertToLlm` replays
  custom messages as user turns, and compaction must not file a delivered
  reply under the user's goals), `deliverAs: "followUp"`,
  `triggerTurn: true`. It is user-triggered, so it needs none of the
  subagent run's consumed-results bookkeeping. This is the deliberate-click
  `/merge` that Codex #29031 asks for.

## Implementation map (phases 1–2)

| Area | Files |
| --- | --- |
| Fork + metadata + snapshot readers | `lib/side-session.ts` |
| Creation route | `app/api/sessions/[id]/side/route.ts` |
| Relation kind, both directions | `lib/types.ts`, `lib/session-reader.ts`, `app/api/sessions/[id]/route.ts`, `getRpcSessionInfos()` in `lib/rpc-manager.ts` |
| Family fold, delete cascade, fork refusal | `lib/session-family.ts` (`isHiddenRelation`), `lib/session-delete.ts`, `lib/session-fork.ts`, and the `fork` / `fork_branch` / `clone` RPC cases in `lib/rpc-manager.ts` |
| Snapshot restore, fixed tools | `startRpcSession()`, `setRpcSessionTools()`, `navigateTreeKeepingToolSelection()` in `lib/rpc-manager.ts` |
| `/side` command | `BUILTIN_SLASH_COMMANDS` in `components/ChatInput.tsx`, `case "side"` in `hooks/useAgentSession.ts`, `handleSideSession` in `components/AppShell.tsx` |
| Panel, tab, switcher row | `components/SideChatPanel.tsx`, `components/TabBar.tsx` (kind `side`), `components/AgentSessionPanel.tsx`, `components/AppShell.tsx` |
| Tests | `lib/side-session.test.mjs`, the side cases in `lib/rpc-manager.test.mjs`, the streaming case in `components/ChatInput.test.mjs` |

Verified in a real browser (dev server on a scratch `PI_CODING_AGENT_DIR`):
`/side <question>` during a parent run forked, opened the panel, seeded the
composer and answered from inherited context; the sidebar kept only the
parent row while the switcher listed the side chat and its badge counted it;
the running wrapper reported exactly `read, bash, grep, find, ls`; the system
prompt carried the appendix; a nested `/side` was refused with its own
message; and deleting the parent removed the side file in the same cascade.

## Open questions (phase 3)

- Promote's rewrite must renumber nothing but the metadata entry: confirm
  against a session that already went through the delete cascade's
  `parentSession` rewrite.
- Send to main chat while the parent runs: `deliverAs: "followUp"` queues it
  — check the anti-impersonation prefix survives compaction.
- Whether a side chat should also be reachable from the file explorer's
  changed-file jumps (it shares the parent's `cwd`).
