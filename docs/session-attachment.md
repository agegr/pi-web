# Session Attachment (design)

Status: stage 1 implemented; stages 2 and 3 proposed. The decision it records
is [ADR 0002](./adr/0002-session-attachment-and-worktree-ownership.md).

Built: the two states, attachment on request, the working-directory ownership
index, the blocked-attach message, and the state indicator. Not built:
take-over, "open in a new worktree", sidebar branch badges, worktree owner
display, and recovery for removed directories.

## The Problem

A session's transcript is portable — you can read it anywhere. A session's
*continuation* is not. The next turn reads and writes files, so it needs the
working directory to be in the state the conversation assumes.

In the `pi` CLI, resuming a session emits `session_start` with reason `resume`,
and extensions use that to reconcile the checkout — for example, checking out
the branch a ticket or PR session belongs to. In Pi Web the same session can be
opened without any of that happening, so the transcript and the file system
disagree, and nothing in the interface says so.

Two things cause this today:

1. **Opening a session creates nothing.** `GET /api/agent/[id]` returns
   `{ running: false }` rather than starting a session, and the chat only loads
   tools when the agent is already running. No `AgentSession` means no
   extensions, so no `session_start` handler can run. The session is created
   lazily on the first prompt.
2. **The lazy start reports the wrong reason.** `startRpcSession()` passes no
   `sessionStartEvent`, so Pi's SDK defaults to
   `{ type: "session_start", reason: "startup" }`. Handlers written against
   `reason === "resume"` return immediately.

Making the lazy start claim `resume` would fix the symptom and create a worse
problem: a click in a list would silently check out a branch, possibly while
another session is running against the same checkout, and background callers
such as `POST /api/sessions/[id]/auto-name` would trigger checkouts of their
own.

## The Proposed Model

Every session is in one of two states.

| State | Meaning |
| --- | --- |
| **Reviewing** | Read-only. The transcript is read from the `.jsonl` file. No `AgentSession`, no extensions, no claim on the file system. |
| **Attached** | The session owns its working directory. An `AgentSession` exists, extensions are loaded, and `session_start` has fired with reason `resume`. |

Opening a session from the sidebar puts it in Reviewing — which is what already
happens, just invisibly. Attachment is always requested.

### What Triggers Attachment

- **The composer.** While reviewing, the message editor is replaced by a button
  reading `Reviewing — click to continue this session`. Clicking it attaches,
  and the editor then appears and takes focus. A button rather than a focus
  handler, because continuing runs the extension hooks that reconcile the
  checkout: that should be an act, not a side effect of the pointer landing
  somewhere. It is a real `<button>`, so Tab and Enter work.
- **An extension** calling `ctx.switchSession()` or `ctx.newSession()`.
- **Creating a session**, which is attached from the start.

Clicking a session in the list never attaches. A click in a list is browsing,
and browsing must not have destructive side effects.

One consequence: you cannot type into a session while reviewing it. Drafts are
keyed by session id, so anything written earlier reappears when the editor
mounts.

### What Ends Attachment

- The state indicator, which doubles as the release action while attached.
  Releasing is refused while the session is running.
- The existing ten-minute idle timeout.
- Another session taking over the working directory (stage 2).

## Working Directory Ownership

Pi Web keeps an ownership index keyed by resolved absolute cwd, next to the
session registry in `lib/rpc-manager.ts`. Attachment consults it; everything
else ignores it.

Ownership follows the claim, not registry membership. Several things start an
`AgentSession` without reconciling anything — a fork, an event-stream
reconnect, title generation — and none of them may report a checkout that never
happened. Only a start marked as an attachment claims the directory, and
attaching over an unclaimed session restarts it, because reusing it would skip
the `session_start` that does the reconciliation.

| Same working directory? | Same working state? | Result |
| --- | --- | --- |
| No | — | Attach. Different worktrees never conflict. |
| Yes | Yes | Attach. Several conversations against one checkout is a supported workflow. |
| Yes | No | Conflict. The attach is blocked and the holding session is named. |

A conflict offers three resolutions:

- **Take over** — detach the holding session, then attach. Offered only when
  the holding session is idle.
- **Open in a new worktree** — create a worktree for this session's branch and
  start a session there, using `addWorktree()` and `POST /api/agent/new`.
- **Keep reviewing** — stay read-only.

### Scope Limit

The index only sees sessions owned by this Pi Web process. A `pi` CLI running
in a terminal against the same checkout is invisible to it. Cross-process
detection would require a lock file with a PID and heartbeat, for example under
`~/.pi/agent/`. That is deliberately deferred: the in-process index covers the
case Pi Web actually creates, which is several browser tabs against one
repository.

## Branch and Worktree Are Not Symmetric

A branch is a *mutation* of a fixed directory. A worktree is the *identity* of
the directory.

| | Branch | Worktree |
| --- | --- | --- |
| What changes | Contents of a fixed directory | Which directory is used |
| Stored in | Extension metadata in the session file | The session file header `cwd` |
| Fixed at | Never — reconciled on every attach | Session creation |
| Changed by | The extension's `session_start` handler | Nothing, after creation |

`session_start` can reconcile a branch because `ctx.cwd` does not move; the
handler runs Git inside it. It cannot change the worktree, because the cwd is
frozen before the handler exists:

```text
SessionManager.getCwd()                  from the session file header
  -> createAgentSessionServices({ cwd })  settings, resource loader, project trust
  -> createAgentSessionFromServices()     tools bound to that cwd
  -> session_start emitted                the handler runs here
```

So the branch-or-worktree question is answered when a session is **created**,
not when it is resumed:

- **Branch mode** — create the session in the current directory and record the
  branch. Every later attach reconciles it. This is how ticket and PR sessions
  work today.
- **Worktree mode** — create the worktree first and create the session inside
  it. The directory is already on the right branch permanently, so no checkout,
  no dirty-tree prompt, and no ownership conflict ever occurs for that session.

Worktree mode is not currently expressible from an extension: neither
`ctx.newSession()` nor `ctx.switchSession()` accepts a cwd, and the SDK's
`newSession()` uses the current session's cwd. Pi Web can do it, because
`POST /api/agent/new` takes a cwd and `lib/worktree.ts` can create the
worktree. Supporting it from an extension needs a cwd option upstream.

## Missing Working Directories

A session whose recorded cwd was removed with `git worktree remove` cannot
attach. Pi Web already keeps such sessions visible under their project instead
of dropping them, but there is no way to bring one back to life. Attachment
should offer to recreate the worktree, or to rebind the session to the main
checkout using the SDK's existing `SessionManager.open(path, sessionDir,
cwdOverride)` recovery path.

## What Extensions See

Nothing in an extension needs to change.

| Extension hook | When it runs | Who decides |
| --- | --- | --- |
| `session_before_switch` | Before an attach or switch. Returning `{ cancel: true }` stops it. | Extension |
| `session_start` (`reason: "resume"`) | After the working directory is claimed. | Extension |
| Ownership check | Between the two, before teardown. | Pi Web |

Both layers are enforced in `finishSessionReplacement()` in
`lib/rpc-manager.ts`, so sidebar attachment and extension-driven switching
cannot drift apart.

One consequence is worth planning for: attaching an existing session and *then*
running a command such as `/pr` causes two checkouts — the attach reconciles
that session's branch, and the command switches again. Starting such commands
from a new session avoids it, because a new session reports
`reason: "new"` and has no branch to reconcile.

## Interface Surfaces

- **Session state indicator** in the top bar: `Reviewing` or
  `Attached` with the working state it claimed. Today nothing reports whether
  opening a session affected the disk.
- **Attach bar** above the composer in Reviewing mode. Silent when the
  directory is free; the decision point when it is not.
- **Session rows** in the sidebar: the recorded branch, dimmed when it differs
  from the directory's current branch, so expectations are set before the
  click.
- **Worktree rows**: current branch and the attached session, making the
  working directory a visible resource with a visible owner.

The related troubleshooting entry in [Worktrees in Pi Web](./worktrees.md) —
"The Explorer shows a different branch than the open chat" — describes the same
confusion from the file-explorer side.

## Delivery Stages

1. **Attachment** — done. `POST`/`DELETE /api/sessions/[id]/attach`, the
   ownership index, the state indicator, and the Reviewing composer.
   Extensions that reconcile a checkout work in Pi Web from this point.
2. **Conflicts.** Take-over of an idle holder, and resolutions offered inline
   rather than as a refusal.
3. **Remedies.** "Open in a new worktree", sidebar branch badges, worktree
   owner display, and recovery for removed directories.

## Open Questions

- Should taking over a working directory be offered when the holding session is
  streaming, or only when idle? The stricter rule is proposed.
- Should attachment be remembered per session, so returning to a session that
  was attached re-attaches without asking?
- Is a cwd option on `ctx.newSession()` worth requesting upstream, so ticket
  and PR commands can choose worktree mode themselves?
