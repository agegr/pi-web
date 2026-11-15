# 0007 — A side chat is a normal session with fewer tools, hidden in its parent's family

## Status

Accepted. Implemented, except the two follow-ups at the end.

## Context

Codex's `/side` forks the current chat for a detour: its history stays available
to the model, a hidden boundary says that history is not the current task, and
nesting is refused. Pi Web needs the same during a long run, without steering the
task or losing the parent's context.

- One session file has one live wrapper and one leaf, so a side chat beside a
  running parent cannot be a branch of the same file.
- `createBranchedSession()` already copies a branch to a new file, mid-run safe
  and wrapper-free: that is the sidebar's Fork.
- pi records the system prompt and tools in the transcript and sends later changes
  as appended updates to models that support them, so changing tools after a fork
  does not have to change the cached prefix.

## Decision

1. **Storage: the sidebar's Fork.** `createSideSession()` and `forkSessionBranch()`
   share one copy (`lib/session-fork.ts`) and one route
   (`POST /api/sessions/[id]/fork`, `{ side: true }`). The copy carries one
   `pi-web:side` custom entry (`version`, `parentSessionId`, `createdAt`) directly
   after the header, where the list's bounded head read finds it, with the first
   copied entry chained under it, and ends on a hidden boundary message.

2. **Relation: `{ kind: "side"; parentSessionId }`, hidden like a subagent.** Hidden
   kinds fold into the parent's family: no sidebar row, counted in the Agents badge,
   following the family's pin and archive, deleted with the parent. It shares the
   family fold with subagents and nothing else: a subagent is a model-dispatched run
   with a run state machine, a side chat is a session the user drives.

3. **Policy: the parent's session minus tools.** A side chat starts through the normal
   path of `startRpcSession()`, or the Chat-only path for a Chat-only parent. Only
   tools change. Its tools are the parent's cut down to `SIDE_TOOLS` (`read`, `bash`,
   `powershell`, `grep`, `find`, `ls`), so it never has more than its parent: a
   Read-only parent stays without a shell, a Chat-only one without any tool. A parent
   reads its pin from the whole file, so the copy of one branch gets the pin written
   again, or going back behind a pin would widen the tools. They are
   passed as pi's allow-list, which also leaves out what has no name to list: every
   extension, MCP, Code mode and subagent tool. Extensions, skills and context
   files stay loaded, MCP and Code mode are not started. There is no snapshot:
   reopening reads the same answer from the transcript, and metadata that does not
   parse is refused rather than reopened with the parent's tools.

4. **Boundary: a hidden message, the prompt untouched.** A fork can end on a prompt
   nobody answered, so the model must be told where the side chat starts, and it must
   be told at that place. A system prompt addendum cannot do it: on models without
   mid-conversation updates it folds into the head, with nothing marking the place. So
   the copy ends on a `custom_message` with `display: false`, which pi sends as a user
   turn on every provider, worded as a note from the app. This is Codex's boundary. The
   prompt stays the parent's, apart from pi updating the tool and rule sections to
   match the tools, and a Chat-only side chat keeps its exact prompt.

5. **Cache.** On a model with native mid-conversation updates (Claude Opus 4.8, 5, 5.5,
   Sonnet 5.5, Haiku 5.5, Fable; GPT-5.4 and later add their tools the same way) the
   request's `tools`, `system` and history stay byte-identical to the parent's, and
   the change is one appended message. Other models fold the change into the head and
   miss. OpenAI's `prompt_cache_key` follows the session id, so it differs from the
   parent's.

6. **Surface: the same as a subagent's.** `/side [prompt]` is a client-side built-in
   available while streaming, so nothing reaches the running model. The selected-text
   popover's "Ask in side chat" is the same thing with a quote, and replaces its "Ask
   in new chat": two ways to ask something aside were one too many. The composer's
   Side chat button during a run and New side chat on the main agent's switcher row
   are the same again. All open a right-panel tab: `SessionChatPanel`, a `ChatWindow` for that session, which subagent
   tabs use too. It rewrites no URL, and global shortcuts stay with the main chat. In
   the Agents switcher a row opens the side chat in the main chat, as a subagent's
   does, its button toggles the tab, and its Delete removes that one side chat after the
   sidebar's confirmation (a run stops; a main chat showing it goes back to the parent). That is only
   a place to look at it: it stays hidden with the same tools, and promoting it is
   another matter. One session has one chat: opening it in the main chat closes its tab.

   The boundary message draws a line in the chat, since the two histories look alike. The first prompt names the side chat, so rows and tabs tell them apart
   without a model call. Side chats are quiet like subagent runs. Search reads only
   what they added after the boundary, since the rest copies their parent's text, and a hit opens
   the parent with the side chat's tab (#1638). Usage counts only entries newer than
   `createdAt`, or the parent's would count again.

7. **Refusals.** `not_found`, `unsaved`, `empty`, `subagent`, `side` (no nesting). A
   side chat cannot be forked: the copy would be read as one.

## Consequences

- Every `/side` copies the parent's branch, whatever its size. A side chat can be
  deleted on its own from the Agents switcher, or with its parent.
- Extensions' `session_start` and other handlers run in a side chat too, as they do
  in any session. That is what keeps its prompt and models the parent's.
- Viewing a subagent in its tab now opens its event stream, which can start a wrapper
  for a finished run, as opening it in the main chat always could.

## Follow-ups

- Send a side chat's reply back to the parent as a user-triggered custom message.
- Promote a side chat to a visible fork by rewriting its metadata entry out.
- Do not persist a side chat that never received a message: a promptless `/side`
  currently copies the parent before anyone types in it.
