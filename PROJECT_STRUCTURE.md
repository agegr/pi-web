# Project Structure

Where this bundle's files sit inside **pi-web v0.8.7** (`07f873c`), and what each one does.

The repo layout is Next.js App Router. This bundle adds to `components/`, `hooks/`, `lib/`,
and `app/api/`, and replaces three files in `components/`. It touches nothing else.

Legend: **`+`** added by this bundle · **`~`** replaced by this bundle · no mark = untouched.

```
pi-web/
├── app/                          Next.js App Router — pages and API routes
│   ├── api/
│   │   ├── files/[...path]/      read, list, download, upload, watch  (untouched)
│   │   ├── sessions/             session CRUD, entries, thinking, export
│   │   └── output-files/         +  mtime sweep for end-of-turn file cards
│   ├── globals.css               1,077 lines of CSS variables  (untouched)
│   ├── layout.tsx
│   └── page.tsx
│
├── components/                   All UI
│   ├── AppShell.tsx              ~  top bar, sidebar, right panel, tabs
│   ├── ChatWindow.tsx            ~  conversation, scroll, streaming, turn grouping
│   ├── TabBar.tsx                ~  right-panel tabs
│   ├── MessageView.tsx              message rendering  (untouched — see note below)
│   ├── ChatInput.tsx                composer
│   ├── ChatMinimap.tsx              scroll minimap
│   ├── FileViewer.tsx               file preview pane
│   ├── FileExplorer.tsx             file tree
│   ├── BranchNavigator.tsx          session tree dropdown
│   ├── ProcessTimeline.tsx       +  the single per-turn process card
│   ├── ProcessIcons.tsx          +  verb icons for timeline rows
│   ├── ToolCallPanel.tsx         +  Request / Response panel for one tool call
│   ├── DiffView.tsx              +  diff renderer, copied verbatim from MessageView
│   ├── OutputFileCards.tsx       +  files a turn produced
│   ├── TurnFooter.tsx            +  tokens, cost and time for a turn
│   └── UserTurnActions.tsx       +  branch switcher under a request
│
├── hooks/
│   ├── useAgentSession.ts           SSE, session state machine  (untouched)
│   ├── useI18n.tsx                  locale context
│   ├── useKeyboardShortcuts.ts      global shortcuts  (untouched)
│   └── useProcessMode.tsx        +  compact / hidden, persisted, Ctrl+Shift+H
│
├── lib/                          Pure logic — no React, no DOM
│   ├── types.ts                     message and session types
│   ├── message-display.ts           block splitting helpers  (untouched, reused)
│   ├── patch.ts                     unified diff parsing
│   ├── file-paths.ts                path normalising helpers
│   ├── i18n/                        locale registry and messages  (untouched)
│   ├── process-steps.ts          +  messages → flat timeline steps
│   ├── tool-display.ts           +  tool name → label, icon, preview, meta
│   ├── output-files.ts           +  which files a turn wrote
│   ├── process-ui-text.ts        +  strings for the new UI, en + zh-CN
│   ├── branch-positions.ts       +  session tree → per-request `1/2`
│   └── turn-cache.ts             +  per-turn derivation cache
│
├── docs/                         project documentation
├── bin/pi-web.js                 CLI entry point
└── AGENTS.md                     repo conventions — read before contributing
```

---

## The three replaced files

Whole-file replacement has no merge step, so anything not reproduced disappears silently.
Each of these was seeded with `git show v0.8.7:<path>` and then edited — never rewritten from
scratch. Verify with:

```bash
git diff v0.8.7 -- components/ | grep '^-' | grep -v '^---'
```

| File | Lines | What changed |
|---|---|---|
| `ChatWindow.tsx` | 1,301 | timeline replaces `ProcessDetailsGroup`; live turn no longer bypasses it; run clock; turn footer; output cards; session sweep |
| `AppShell.tsx` | 1,662 | process-mode control in the top bar; tool-call panel state; panel branches on tab kind |
| `TabBar.tsx` | 115 | `Tab` becomes a union so a tool tab can sit beside file tabs |

Everything else in those files — the two scroll `useLayoutEffect`s from commit `3a37c04`,
`promptAnchorActive`, `handleEditContent`, the `messageRefs` wiring that feeds `ChatMinimap`,
`getVisibleRenderWindow`, the resize handles, drag-to-close tabs — is byte-for-byte intact.

## Why `MessageView.tsx` is never touched

It is 1,579 lines and owns the streaming render path. Replacing it would put the riskiest file
in the repo inside a bundle with no merge safety net. The cost of that decision is two
deliberate copies, both marked in their source:

- `components/DiffView.tsx` — six functions copied verbatim from `MessageView.tsx:918-1143`
- `getToolPreview` in `lib/tool-display.ts` — copied from `MessageView.tsx:1468`
- `formatUsage` and `formatTime` in `components/TurnFooter.tsx` — copied from `MessageView.tsx`

If `MessageView.tsx` is ever made to export these, delete the copies and import them instead.

## Layering

```
app/api  ──►  lib/  ◄──  hooks/  ◄──  components/
```

`lib/` is pure: no React import, no DOM access, no fetch. That is what makes it testable with
plain `node --test`, and what keeps the same logic usable from a server route. `components/`
may import from `lib/` and `hooks/`; nothing in `lib/` imports upward.
