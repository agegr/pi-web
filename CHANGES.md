# What this bundle changes

Against a clean **pi-web v0.8.7** (`07f873c`) checkout: **25 files added, 3 replaced.**

Verified from a pristine checkout with the bundle copied in:

```
git status --short   → 3 modified, 25 new
tsc --noEmit         → 0 errors
npm run lint         → 0 errors, 0 warnings
node --test          → 395 passing, 0 failing
git diff v0.8.7 -- components/ | grep '^-' | grep -v '^---'   → 86 lines, all intended
```

---

## The process timeline

**Before:** each assistant message in a turn rendered its own bordered box, so one request
produced a vertical stack of thinking boxes and tool boxes that pushed the answer off screen.

**After:** one card per turn — `Process · 8 steps · 3 tools · 46s` — with a row per step.
Thinking and notes expand inline; tool rows open the right-hand panel.

- Three display modes: **shown**, **compact**, **hidden**. `Ctrl/Cmd + Shift + H` cycles
  compact ⇄ hidden; the choice persists in `localStorage` under `pi-process-mode`.
- Clicking a turn's header expands just that turn. Changing the global mode clears those
  per-turn overrides, so the shortcut always wins.
- Thinking bodies cap at 240px and scroll — long reasoning cannot bury the answer, and the
  row stops resizing on every streamed token.
- Turns over 20 steps show the most recent 20 with `Load more (n)`, and `Show last 20` to
  collapse back.

## Live turns

**Before:** v0.8.7 routed the entire in-flight turn down a separate per-message path
(`isLiveTail`), so the process looked like unmodified pi-web at exactly the moment you were
watching it, and only became a timeline once the request finished.

**After:** committed messages and the streaming message merge into one card from the first
token. The running row shows the tail of what is being written — the file content, not just
its path — so a long write reads as progress rather than a hang.

The header clock counts the **whole run**, not the current step. It is keyed on a single
"is a run in progress" boolean; `isStreaming` flips off and on between every step and would
otherwise restart the clock each time.

## Tool call panel

Click a tool row to open Request and Response in the right-hand panel, sharing the tab bar
with file tabs. At most one tool tab exists — opening another tool replaces it.

- **Request** shows the one dominant multi-line field (`code`, `command`, `content`,
  `new_str`) as raw text, and pretty JSON otherwise.
- **Response** renders a diff for edit tools instead of raw JSON, and clips at 200 KB.
- A tool opened while still running says `Running…` and fills in when the result lands.

## End-of-turn information

- **Output file cards** list what the turn produced, with `View`, `Download`, `Copy path`.
  Four show by default, then `+n more files` and `Show first 4`.
- Files come from two sources: successful write and edit tool calls, plus a filesystem sweep
  of the session's time window that catches writes made through bash. Bash commands are never
  parsed — guessing at `>` redirects produces more wrong answers than value. Tool-derived
  entries always win on paths they cover, so their action and `+n −m` counts are never
  downgraded by the sweep.
- **A usage line closes every turn** — finished, errored, or aborted. Token counts describe
  the final step; the cost is summed across every step, which is the number that leaves your
  account. v0.8.7 showed nothing at all when a turn ended on a tool call.

## Requests

- `New session` now appears on the **first** request too; v0.8.7 hid it there.
- A request asked more than once shows `1/2`, `2/2` with arrows between versions. The arrows
  do not wrap: `<` only goes back toward the original, `>` only forward, each disabled at its
  end.
- Extension request dialogs cap at 300px and scroll, so a long `select` cannot push its own
  buttons off screen.

## Performance

The derivations behind each turn — timeline steps, output files, cost — used to run inside
`ChatWindow`'s render loop, so every keystroke in the composer re-walked every turn in the
session and produced fresh arrays, which defeated the `memo` on every timeline row.

`lib/turn-cache.ts` caches them per turn, keyed on the `messages` array identity. A changed
conversation is a cache miss by construction, so there is no invalidation to get wrong.
Measured on a 30-turn session over 40 renders: **2.2× faster** on the derivations, and step
objects keep stable identity, which is what actually stops several thousand row re-renders.

The filesystem sweep runs **once per session**, not once per turn, and three further things
keep it off the critical path:

- It resolves symlinks only for entries `readdir` reports *as* symlinks. Resolving every entry
  cost one extra syscall per file for nothing — on a 6,000 file tree, 173ms versus 30ms. The
  security property is identical.
- It runs during browser idle time, so the conversation and the tool-derived cards paint
  first. The sweep only ever *adds* to what is already on screen.
- Results are cached by `cwd|since|until`. A closed time range over a directory cannot change
  its answer, so switching sessions and back never re-walks anything.

A 400ms server-side budget bounds the worst case: a monorepo returns a partial answer quickly
rather than a complete one slowly.

## Known weaknesses

Written down because they are real, not hypothetical.

- **The sweep can attribute files you touched to the agent.** It reports whatever changed on
  disk inside the turn's window. If you edit a file in your own editor, or run a build, while
  the agent is working, those files appear as output. Directory exclusions catch the common
  build outputs; they cannot catch everything.
- **`birthtime` is unreliable on some filesystems.** Where it is not tracked faithfully, a
  file created during the turn is labelled `Changed` rather than `New`. The label stays true,
  but it is less precise than it looks.
- **Partial results are not marked in the UI.** The API returns `truncated: true` when it hits
  a bound, but the cards do not show that yet — on a very large repo the list may be silently
  incomplete.
- **The branch counter (`1/2`) does not appear yet.** `computeBranchPositions` reads the tree
  from `onBranchDataChange`, and that tree appears to be condensed for the Branches panel, so
  per-request entry ids do not match. Needs the real tree shape to fix.
- **The first request cannot be edited into a branch.** pi-web's own edit affordance requires
  a parent entry to navigate back to, and the first request has none. This is structural, not
  a UI gap.
- **Three functions are duplicated from `MessageView.tsx`** — the diff renderer,
  `getToolPreview`, and the usage/time formatters. If upstream changes them, these copies do
  not follow. Each is marked with its source line.
- **A stray lockfile outside the repo breaks the dev server.** If `/root/package-lock.json`
  exists alongside `/root/pi-web/package-lock.json`, Next.js infers `/root` as the workspace
  root and Turbopack anchors its module graph there. The symptom is a hydration mismatch where
  the server renders the new tree and the browser renders the old one. Delete the stray
  lockfile, or set `turbopack.root` in `next.config.ts`.
- **`next build` and `npm run dev` must not be mixed.** A production build leaves artifacts in
  `.next/` that the dev server then serves as a stale client bundle. `AGENTS.md` says the same.
- **The bundle is pinned to v0.8.7.** Copying it onto a newer checkout silently reverts
  whatever landed upstream in `ChatWindow.tsx`, `AppShell.tsx`, or `TabBar.tsx`.

---

## Not changed

`components/MessageView.tsx`, `app/globals.css`, `lib/i18n/messages/*.ts`, `package.json`,
`hooks/useKeyboardShortcuts.ts`, `hooks/useAgentSession.ts`, `lib/message-display.ts`,
`app/api/files/[...path]/route.ts`.

Zero new dependencies.
