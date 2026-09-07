# Undo the first turn (#746)

This is a narrow alternative to **Edit from here**, not a general history editor.
After stopping the original first turn, **Undo and edit** restores its text and
images to the existing composer and permanently removes that turn. It neither
creates a new session nor keeps a hidden history branch.

## Eligibility and safety

The server advertises an action only for an original (not forked) session whose
entire entry graph is linear: initial metadata, one user message, and one aborted
assistant message containing only text/thinking. Completed turns, tool calls
(including read-only tools), additional messages, compaction, branches, and
post-turn extension/configuration entries are not eligible.

The POST endpoint revalidates the persisted file and expected entry/leaf IDs.
Running sessions, pending commands/queued prompts, startup, and active background
work are rejected. A process-global history lock blocks wrapper commands/startup
and conflicting session deletion while the wrapper shuts down. If shutdown hooks
or another writer change the file, the operation fails without replacing it.
Otherwise a same-directory temporary file is atomically renamed over the session.
No backup/history branch is created by this operation.

The header and all initial metadata are retained verbatim, preserving the session
ID, cwd, name, model, thinking level, and persisted tool selection. The next prompt
reopens that same file through the normal session startup path. Undoing chat
history must never be presented as reverting external side effects.

## Composer behavior

The action runs directly without a confirmation dialog, and refuses to overwrite
an existing draft or an image currently being processed. Input is restored before the destructive request,
so it remains editable in the tab even if that request fails or its response is
lost. This uses the application's existing in-memory draft store; it is not a
new durable backup mechanism. Old in-flight history responses are invalidated on
success before the empty session is loaded.

## Tests

- `node --test lib/first-turn-undo.test.mjs`: eligibility, preservation, conflicting
  writes, shutdown failure, and a real SessionManager reopen/undo/resend round-trip.
- `e2e/first-turn-undo.mjs` is integrated into `e2e/run.mjs`: direct undo without dialogs,
  existing-draft protection, restoring text/images, and empty same-session history.
  It uses isolated fixture history and makes no model requests.
