# Pi Web

[中文文档](./README.zh-CN.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

Local web UI for the [pi coding agent](https://github.com/badlogic/pi-mono). Pi Web reads your local pi session files and gives you a browser workspace for session browsing, real-time chat, model configuration, skill management, and project file preview.

![Pi Web shows the same pi session with structured Markdown, tool calls, and project navigation beside the CLI](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

The same pi session in CLI and Pi Web: structured tool calls, readable Markdown, session browsing, and cleaner results.

## Quick Start

Pi Web requires Node.js 22.19.0 or newer. Check your version with `node --version`.

**Run without installing:**

```bash
npx @agegr/pi-web@latest
```

**Or install globally:**

```bash
# Install or upgrade
npm install -g @agegr/pi-web@latest
pi-web
```

**Uninstall a global installation:**

```bash
npm uninstall -g @agegr/pi-web
```

Then open [http://127.0.0.1:30141](http://127.0.0.1:30141). The CLI will try to open the browser automatically after the server is ready. Pi Web listens on `127.0.0.1` by default.

**Options:**

```bash
pi-web --port 8080              # custom port
pi-web --hostname 0.0.0.0       # expose on a trusted network
pi-web -p 8080 -H 0.0.0.0       # combine options
pi-web --no-open                # do not open the browser automatically

PORT=8080 pi-web                # environment variable is also supported
PI_WEB_HOSTNAME=0.0.0.0 pi-web  # explicit network exposure
PI_WEB_ALLOWED_HOSTS=pi-web.internal pi-web  # allow an exact proxy/custom hostname
PI_WEB_PASSWORD='a-long-random-password' pi-web  # require Basic Auth (username: pi)
PI_WEB_NO_OPEN=1 pi-web         # useful when running as a background service
```

Set `PI_WEB_PASSWORD` to protect the web interface and every API endpoint with HTTP Basic Auth. The username is always `pi`. Leaving the variable unset or empty disables authentication.

Pi Web can invoke a high-privilege agent. Basic Auth does not encrypt the password in transit, so do not expose plain HTTP to the internet. Use HTTPS through a trusted reverse proxy or a trusted VPN for remote access.
API requests accept loopback names, IP literals, the selected bind hostname, and exact comma-separated names in `PI_WEB_ALLOWED_HOSTS`. Configure that variable when a trusted reverse proxy uses a different external hostname.

## HTTP Proxy

Pi Web reads the standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables for server-side model and API requests.

On macOS or Linux:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

On Windows PowerShell:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## Features

- **Pick work back up**: browse previous pi conversations by project without digging through terminal history or session paths.
- **Try different directions safely**: continue from an earlier message or fork a session into a separate route.
- **Work across branches**: switch Git worktrees from the sidebar so new sessions and the Explorer follow the checkout you choose.
- **Chat beside the project**: browse files on the left and preview source, docs, images, audio, and PDFs on the right while the agent works.
- **See session state clearly**: context usage, cost, compaction state, and system prompt details are visible from the top bar.
- **Configure less from the terminal**: manage models, login/API keys, model tests, and skill switches from the web UI.
- **Use the interface in your language**: switch between the supported UI languages from the top bar.

## Notes

- **Data directory**: Pi Web reads `~/.pi/agent/sessions` by default. Set `PI_CODING_AGENT_DIR` to point at another pi agent directory.
- **Session files**: files are stored as `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`.
- **Runtime environment**: run Pi Web in the same OS or container as pi so session working directories remain available.
- **Model config**: the Models panel reads and writes `models.json` in the pi agent directory. Model lists and defaults come from pi's config.
- **File access**: file browsing and preview are scoped to the selected project directory and working directories that appear in sessions.
- **Git worktrees**: see [Worktrees in Pi Web](./docs/worktrees.md) for when the switcher appears, how new worktrees are created, and what removal does.
- **Forks vs in-session branches**: Fork creates a new `.jsonl` file. "Edit from here" creates another branch inside the same session file.
- **Internationalization**: see [Internationalization](./docs/i18n.md) for using translations and adding languages or UI text.

## Development

```bash
npm install
npm run dev
```

The local dev server runs at [http://127.0.0.1:30141](http://127.0.0.1:30141).

Common checks:

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

Avoid running `next build` / `npm run build` during local development. It writes to `.next/` and can interfere with the dev server; leave builds for release work.

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
  useDragDrop.ts      # image drag/drop
  useTheme.ts         # theme switching
bin/
  pi-web.js           # npm CLI entrypoint
instrumentation.ts    # initializes the server HTTP dispatcher
```
