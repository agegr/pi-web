# Pi Web demo

A static, backend-free copy of the Pi Web UI for GitHub Pages. It uses the
real Pi Web components, and an in-browser mock answers every `/api/*` request
the UI makes, so visitors can click through sessions, files, models and
settings without installing anything.

## What visitors see

- **Sessions**: a set of tutorial conversations (English or Simplified Chinese,
  following the UI language) that explain the layout, files and `@` mentions,
  models and reasoning levels, branching, tool calls, skills/plugins/subagents
  and composer shortcuts. A second project shows project switching and a
  *Chat only* session.
- **Files**: the explorer browses a snapshot of this repository. The Welcome
  session opens `README.md` as a rendered preview on the right, and the
  tutorial edits show up as Git changes with diffs.
- **Models**: a signed-in ChatGPT Plus/Pro (Codex) account, a DeepSeek API key
  and a custom "Claude Gateway" provider from `models.json`, with Codex, Claude
  and DeepSeek models in the picker.
- **Interaction**: sending a message streams a canned reply (with a real `read`
  or `ls` tool call when it fits), and `!command`, the terminal panel, forks,
  branches, renames and titles all work in memory. Anything that needs a real
  server (sign-in, installs, uploads) explains that this is a demo.

## How it works

```text
app/DemoRoot.tsx        imports mock/install.ts, then renders Pi Web's AppShell
mock/install.ts         replaces window.fetch (for /api/*) and EventSource
mock/router.ts          the API routes: sessions, agent, files, git, models, …
mock/agent.ts           streams replies with pi's SSE event sequence
mock/sessions/          tutorial scripts, expanded into pi session entries
mock/captured/          responses recorded from a real Pi Web + pi SDK setup
scripts/prepare-demo-files.mjs
                        snapshots the repository into public/demo-files
```

`components/`, `hooks/` and `lib/` are copies of the main project. These files
differ from their originals:

| File | Why |
| --- | --- |
| `app/layout.tsx`, `app/page.tsx`, `app/DemoRoot.tsx` | Load the mock, no service worker or manifest |
| `components/AppShell.tsx` | Open the README preview by default, base-path-safe `router.replace`, in-browser "Full history" |
| `components/ChatWindow.tsx`, `FileIcons.tsx`, `ProviderIcon.tsx` | Prefix static assets with the Pages base path |
| `components/FileViewer.tsx`, `FileExplorer.tsx`, `MarkdownBody.tsx` | Load images, media and downloads from the static snapshot |
| `lib/subagent-extension.ts`, `lib/terminal-manager.ts` | Types only; the originals are server code |

To pick up UI changes from the main project, copy the updated files over and
re-apply the changes above (search for `demo` / `@/mock` in those files).

## Isolation from Pi Web

The demo never ends up in the app or its npm package:

- **Not published.** The root `package.json` publishes only the paths in its
  `files` whitelist, so `npm pack` contains nothing from `demo/`.
- **Not compiled into the app.** Pi Web imports nothing from `demo/`; the root
  `tsconfig.json` excludes it and `eslint.config.mjs` ignores it.
- **Kept out of the app's CSS.** Tailwind scans every file that isn't
  gitignored, so `app/globals.css` has `@source not "../demo";`. The demo's copy
  of `globals.css` keeps the same line, where it points at nothing.
- **Its own CI.** Only `.github/workflows/demo-pages.yml` installs and builds
  `demo/`.

## Commands

```bash
cd demo
npm install
npm run dev      # http://127.0.0.1:30142
npm run lint
npm run build    # static export in out/
```

`npm run dev` and `npm run build` first run `scripts/prepare-demo-files.mjs`.
To preview the build under a sub-path the way GitHub Pages serves it, set
`PAGES_BASE_PATH=/pi-web` before `npm run build`.

## Deployment

`.github/workflows/demo-pages.yml` builds the demo on every push to `main` and
deploys `out/` to GitHub Pages. Enable Pages once under **Settings → Pages →
Source: GitHub Actions**; the site is then served at
`https://<owner>.github.io/<repo>/`.
