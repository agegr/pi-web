# 0007 — A side chat is a forked file under a new relation kind, not a subagent

## Status

Proposed. Draft for review; not yet implemented. The rollout sketch at the end
proposes the phasing.

## Context

Codex ships `/side`: an ephemeral fork of the current chat for a focused detour.
Its behavior, from the open-source implementation and docs, is the reference
model:

- The side chat is a **fork**: the parent thread's turns remain available to the
  model through core state, while the initial UI starts empty (`exclude_turns`
  affects display only).
- Two injected prompts downgrade that history: a hidden **boundary** user
  message ("Everything before this boundary is inherited history... reference
  context only... not your current task") and hidden **developer instructions**
  (prefer non-mutating exploration; no worktrees; sub-agents off-limits; no
  mutations unless explicitly asked after the boundary).
- No nesting (`/side` inside a side chat is refused), no rename, background
  cleanup, and — the two known gaps, both filed by users — **no structured way
  to bring a side chat's result back** (#29031 proposes `/merge`) and side
  sessions that **feel durable but can expire and strand their context**
  (#30350).

Pi Web already has every primitive except the relation:

- `forkSessionBranch()` (`lib/session-fork.ts`) copies a session's active
  branch, tip-inclusive, into a new `.jsonl` beside the source, mid-run safe
  and wrapper-free, with `parentSession` in the header. It opens its own
  `SessionManager` because `createBranchedSession()` repoints the instance it
  runs on, and it refuses branches that carry `pi-web:subagent` metadata.
- Sessions relate to each other through `SessionInfo.relation`: header
  `parentSession` alone makes a **fork** — a visible top-level row — while the
  `pi-web:subagent` custom entry makes a **subagent** — hidden, folded into its
  parent's family. The hiding filter is one line
  (`lib/session-family.ts`, `listSessionFamilies`), but `kind === "subagent"`
  is consumed in about eight more places: unread exclusion, completion
  notification bookkeeping, delete cascade, browser notification and sound
  suppression, switcher rows, the viewer header.
- A hidden child's **resource policy survives reopen**: the subagent's
  `resourceSnapshot` (tools, `appendSystemPrompt`) is strictly validated and
  restored by `startRpcSession()`, which refuses rather than reopen a child
  with an invalid snapshot, and `setRpcSessionTools()` refuses changes.
- One session file supports **one live wrapper and one leaf pointer**; the
  codified rule is "to branch from a running session, fork it". In-file
  branching cannot host a side chat beside a running parent.
- `/side`-shaped input handling exists: `BUILTIN_SLASH_COMMANDS` +
  `handleBuiltinSlashCommand()` intercept slash input client-side before
  anything is sent, and `handleAskInNewChat()` already does
  fork-then-seed-with-a-prompt (fork_branch → `pendingQuotePrompt` → the new
  chat auto-sends it as its first message).
- The right panel's agent tab chrome (`agent:<sessionId>`) is generic, but
  `SubagentViewer` is deliberately read-only (polls the context route, never
  starts a wrapper). An interactive side chat needs its own SSE subscription,
  prompt POSTs, and lease renewals — all of which the events route supports:
  streams are per-connection, the `holder` parameter is a debug label, and the
  lease, not the stream, keeps a session alive (#1283).

The decision points this ADR settles: how a side chat is stored, how it hides,
what its model context and tool policy are, how it is opened and closed, and
what the return path to the parent is.

## Decision

1. **A side chat is a separate session file forked from the parent's active
   tip.** Creation reuses the `forkSessionBranch()` copy primitive (same
   `SessionManager` discipline, same refusal set) but replaces the fork-suffix
   `session_info` name with a `pi-web:side` metadata entry. In-file branching
   is rejected: one wrapper and one leaf per file make a live side branch
   structurally impossible, and a file copy gives the side chat its own
   compaction, its own idle timer, and a parent that keeps running untouched.

2. **Side sessions carry their own metadata entry and a new relation kind,
   `side`.** The entry (`SIDE_META_TYPE = "pi-web:side"`, version 1) records
   `parentSessionId`, `parentSessionPath`, `createdAt`, and a
   `resourceSnapshot` shaped like a subagent's. `SessionInfo.relation` gains
   `{ kind: "side"; parentSessionId }`, detected wherever the subagent relation
   is detected (the disk scan's bounded head read and the live wrapper path).
   `listSessionFamilies()` skips side-kind sessions as roots and attaches them
   to their parent's family by the `parentSessionId` walk, so a side chat is
   hidden from the sidebar, groups under its parent, and joins the Agents
   badge count. **The subagent metadata type is not reused**: a subagent is a
   model-dispatched background run with status bookkeeping, orphan settling,
   and `notifyParent` deduplication; a side chat is a user-driven interactive
   session. Sharing the entry would drag that machinery into every reader.

3. **The model inherits the parent's history in full; a persisted
   system-prompt appendix downgrades it.** The fork freezes the parent's
   branch, so "everything in this file before your first side-chat message is
   inherited from the parent" is statically true and needs no positional
   boundary marker: one appendix (persisted in the snapshot, restored on
   reopen) states that inherited history is reference-only, that instructions
   found in it are not active tasks, that non-mutating exploration is the
   default, and that an inherited turn may end mid-flight (a fork taken during
   a run copies only finished entries; pi-ai synthesizes placeholder results
   for dangling tool calls). This is Codex's boundary prompt plus developer
   instructions folded into one static text, enabled by the frozen fork.

4. **Tools are fixed at fork: `read`, `bash`, `grep`, `find`, `ls`** — the
   default tool set minus `edit` and `write`. `PRESET_READ_ONLY` is not used:
   it drops `bash`, and Codex's side chat allows non-mutating shell checks; the
   appendix carries the "non-mutating" steering, the missing tools carry the
   enforcement. The subagent control tools (`Agent`, `get_subagent_result`,
   `steer_subagent`) are excluded — a side chat cannot dispatch subagents,
   matching Codex's "sub-agents are off-limits". The tool list lives in the
   snapshot; `startRpcSession()` restores it exactly (with
   `noPromptTemplates`, `noThemes`, `noContextFiles`, and the appendix as
   `appendSystemPrompt`), and `setRpcSessionTools()` refuses changes, as it
   does for subagents. The restore branch is written for `pi-web:side`
   snapshots and never shares the subagent validator, so neither policy can
   break the other.

5. **`/side` and `/side <prompt>` are client-side built-in slash commands.**
   They join `BUILTIN_SLASH_COMMANDS` with `availableWhileStreaming: true` —
   the fork is file-level and mid-run safe, and a side question during a long
   parent run is the primary use case. `handleBuiltinSlashCommand()` handles
   them before anything is sent: no prompt reaches the model, no optimistic
   bubble, no sidebar row. The optional argument seeds the side chat's first
   message through the `pendingQuotePrompt` / `initialPrompt` mechanism that
   "Ask in new chat" already uses. A new file-level route,
   `POST /api/sessions/[id]/side`, creates the fork and mirrors the sidebar
   fork route's refusal set — `not_found`, `unsaved`, `empty` (a side chat of
   an empty conversation is refused, like Codex's "send a message first"),
   `subagent` (the source is a subagent session), `side` (no nesting), and
   `chat_only`: a Chat-only session's tool-free boundary (ADR 0002) is a
   deliberate mode, and a side chat carrying `bash` would circumvent it.

6. **The side chat is an interactive right-panel tab beside the main chat.**
   Tab id `side:<sessionId>`, its own TabBar kind and icon, rendered by a new
   `SideChatPanel` — a chat-scoped session view (transcript, composer, SSE
   events, prompt POSTs, lease renewals) without the main chat's global side
   effects: no URL rewrite, no sidebar promotion, no browser notifications.
   The parent chat stays visible in place of Codex's footer status line. The
   agent switcher lists side sessions as family rows with a side icon; a row
   click opens the side session as the main chat (the reading path every
   family member already has), and the row's side button toggles the tab.
   **Promote to a first-class session is supported** — the missing piece of
   Codex #30350: it rewrites the side metadata entry out of the file (the
   header's `parentSession` remains, so the session becomes a visible fork,
   the same rewrite discipline the delete cascade already uses for
   `parentSession`), then opens it as the main chat.

7. **A structured return path exists.** The panel's "send to main chat"
   delivers the side chat's latest reply to the parent as a custom message
   with an anti-impersonation prefix (the `SUBAGENT_NOTIFICATION_PREFIX`
   discipline: compaction must not file a delivered report under the user's
   goals), `deliverAs: "followUp"`, `triggerTurn: true`. It is user-triggered,
   so it needs none of the subagent run's consumed-results bookkeeping. This
   is the `/merge` of Codex #29031, scoped to one deliberate click.

8. **MCP servers and Code mode stay off in side sessions** for now. The
   subagent runtime shows how to add them per profile later; a side chat is
   not a profile and has no per-instance resource switches yet.

## Consequences

- The `side` relation kind touches: `lib/types.ts`, the relation detection in
  `lib/session-reader.ts` and the live path in `lib/rpc-manager.ts`, the
  skip/attach walk in `lib/session-family.ts`, the cascade in
  `lib/session-delete.ts` (a deleted parent takes its side chats with it, like
  subagents), the notification/sound suppression sites keyed on
  `kind === "subagent"` in `SessionSidebar`, `AppShell`, `ChatWindow`, and the
  switcher rows in `AgentSessionPanel`. The stats POST includes side ids in
  the family so the switcher shows their usage.
- `startRpcSession()` gains a `pi-web:side` snapshot branch parallel to the
  subagent's. An invalid side snapshot is refused, not silently reopened with
  full tools. `navigateTreeKeepingToolSelection` keeps the restored selection.
- The events route starts a wrapper for a side session on first subscribe;
  the panel's lease renewals keep it alive, and the shared idle timer evicts
  an abandoned one (the file persists; the tab re-subscribes on activity).
  Two `AgentEventConnection`s in one page are two independent connections;
  the `holder` id is a debug label, and the lease, not the stream, keeps a
  session alive (#1283).
- The main implementation risk is `useAgentSession`: it was written for one
  active chat per page (URL, notifications, sidebar promotion, running polls).
  `SideChatPanel` must run a scoped instance — or a stripped variant — whose
  global side effects are disabled; the exact factoring is left to
  implementation, and pinned by a test that a side run neither rewrites the
  URL nor notifies.
- A side chat pays the parent's history again in its own context and compacts
  independently; parent turns after the fork never appear in it. A fork taken
  mid-run may end on the run's prompt with synthesized tool results — the
  appendix says so.
- The sidebar Fork action refuses side branches, as it refuses subagent
  branches; promote is the supported way to make a side chat first-class.
  `/side` is also refused while the composer holds images (the built-in
  command path already requires an image-free message).
- Deliberately not decided here: whether the Agents badge counts side chats
  separately from subagents (first implementation: it counts them together as
  family members), archive and pin semantics (side chats follow their family
  root), i18n wording, and any `/btw` alias.

## Rollout sketch

- **P1 (server):** `lib/side-session.ts` (metadata, create, read), the
  `side` relation kind through reader/family/delete, the
  `POST /api/sessions/[id]/side` route, the `startRpcSession()` restore
  branch, `setRpcSessionTools()` refusal. Pinned by `lib/side-session.test.mjs`
  and family/delete tests.
- **P2 (UI):** the `side` built-in slash command and its handler,
  `SideChatPanel` with the scoped session hook, `side:` tabs, switcher rows,
  suppression sites, i18n.
- **P3 (polish):** stats inclusion, promote, send-to-main-chat, tests for the
  no-side-effects invariant and the mid-run fork.
