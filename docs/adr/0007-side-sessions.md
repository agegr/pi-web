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
   copied entry chained under it.

2. **Relation: `{ kind: "side"; parentSessionId }`, hidden like a subagent.** Hidden
   kinds fold into the parent's family: no sidebar row, counted in the Agents badge,
   following the family's pin and archive, deleted with the parent. It shares the
   family fold with subagents and nothing else: a subagent is a model-dispatched run
   with a run state machine, a side chat is a session the user drives.

3. **Policy: the parent's session minus tools.** A side chat starts through the normal
   path of `startRpcSession()`, or the Chat-only path for a Chat-only parent. Only
   tools change. Its tools are the parent's cut down to `SIDE_TOOLS` (`read`, `bash`,
   `powershell`, `grep`, `find`, `ls`), so it never has more than its parent: a
   Read-only parent stays without a shell, a Chat-only one without any tool. They are
   passed as pi's allow-list, which also leaves out what has no name to list: every
   extension, MCP, Code mode and subagent tool. Extensions, skills and context
   files stay loaded, MCP and Code mode are not started. There is no snapshot:
   reopening reads the same answer from the transcript, and metadata that does not
   parse is refused rather than reopened with the parent's tools.

4. **Prompt: unchanged, plus one sentence.** `SIDE_SYSTEM_PROMPT` says the inherited
   messages are background, not the current task, because a fork taken mid-run can
   end on a prompt nobody answered. A Chat-only side chat goes without it: its head
   is an exact prompt, and with no tools there is nothing to run. pi updates the tool
   and rule sections to match the tools.

5. **Cache.** On a model with native mid-conversation updates (Claude Opus 4.8, 5, 5.5,
   Sonnet 5.5, Haiku 5.5, Fable; GPT-5.4 and later add their tools the same way) the
   request's `tools`, `system` and history stay byte-identical to the parent's, and
   the change is one appended message. Other models fold the change into the head and
   miss. OpenAI's `prompt_cache_key` follows the session id, so it differs from the
   parent's.

6. **Surface: the same as a subagent's.** `/side [prompt]` is a client-side built-in
   available while streaming, so nothing reaches the running model, and it opens a
   right-panel tab: `SessionChatPanel`, a `ChatWindow` for that session, which subagent
   tabs use too. It rewrites no URL, and global shortcuts stay with the main chat. In
   the Agents switcher a row opens the side chat in the main chat, as a subagent's
   does, and its button toggles the tab. That is only a place to look at it: it stays
   hidden with the same tools, and promoting it is another matter. One session has one
   chat: opening it in the main chat closes its tab.

   A line marks where the inherited history ends (`forkedAtEntryId`), since the two
   look alike. The first prompt names the side chat, so rows and tabs tell them apart
   without a model call. Side chats are quiet like subagent runs. Search skips them,
   since they copy their parent's text. Usage counts only entries newer than
   `createdAt`, or the parent's would count again.

7. **Refusals.** `not_found`, `unsaved`, `empty`, `subagent`, `side` (no nesting). A
   side chat cannot be forked: the copy would be read as one.

## Consequences

- Every `/side` copies the parent's branch, whatever its size, and a side chat can
  be deleted only with its parent.
- Extensions' `session_start` and other handlers run in a side chat too, as they do
  in any session. That is what keeps its prompt and models the parent's.
- Viewing a subagent in its tab now opens its event stream, which can start a wrapper
  for a finished run, as opening it in the main chat always could.

## Follow-ups

- Send a side chat's reply back to the parent as a user-triggered custom message.
- Promote a side chat to a visible fork by rewriting its metadata entry out.
