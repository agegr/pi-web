# Pi Web

[简体中文](./README.zh-CN.md) · [日本語](https://github.com/agegr/pi-web/blob/main/README.ja.md) · [Русский](https://github.com/agegr/pi-web/blob/main/README.ru.md)

Local browser workspace for the [pi coding agent](https://github.com/earendil-works/pi). Projects, sessions, live agent work, files, and Git worktrees stay in one place, using the same `~/.pi/agent` config and JSONL session files as the pi TUI.

Published installs come from [`@agegr/pi-web`](https://www.npmjs.com/package/@agegr/pi-web). This tree follows [agegr/pi-web](https://github.com/agegr/pi-web).

```bash
npx @agegr/pi-web@latest
```

Requires Node.js 22.19.0 or newer. Pi Web opens the browser when ready and listens only on `127.0.0.1` by default.

![Pi Web desktop workspace: project sidebar, conversation with tool activity, and context card](./docs/pi-web-workspace.png)

## Features

- **Projects and sessions** — search, pin, archive, rename, export, or delete in the sidebar. Storage stays pi-compatible JSONL under `~/.pi/agent`.
- **Live agent work** — streamed thinking and tool calls, folded process details, a conversation plan that stays after the turn settles, and completion feedback when a run finishes in another project.
- **Queue and interject** — while the agent is running, Enter queues a follow-up; the filled send control steers the current turn. Stop stays a separate outlined control.
- **Two ways to branch** — **Fork** writes an independent session file from a message; **Edit from here** branches inside the current session.
- **Subagent visualization** — a live recursive tree of delegated runs, read-only child transcripts in the same workspace, and steer / pause-and-resume routed through the owning root. Needs a `pi-subagents` build with `runStatus`; older builds keep full read-only history.
- **Files beside the chat** — browse and upload, inspect Git diffs, and preview source, Markdown, images, audio, PDFs, and DOCX with automatic refresh.
- **Git worktrees** — create, switch, and remove linked checkouts; sessions from the same repo stay grouped.
- **Settings in the browser** — providers, OAuth, API keys, models, skills, plugins, appearance, project trust, and **Remote access**. Changes use pi's local storage and apply to both UIs.

## Install

```bash
npx @agegr/pi-web@latest
```

If the browser does not open, visit [http://127.0.0.1:30141](http://127.0.0.1:30141). Open **Settings → Models** to sign in or add an API key.

```bash
npm install -g @agegr/pi-web@latest
pi-web
```

To update, stop the process with `Ctrl+C` and run the same install command. To uninstall: `npm uninstall -g @agegr/pi-web`.

## Configuration

Command-line options override the matching environment variables.

| Option or environment variable | Purpose | Default |
| --- | --- | --- |
| `--port` / `-p` / `PORT` | Port | `30141` |
| `--hostname` / `-H` / `PI_WEB_HOSTNAME` | Bind address | `127.0.0.1` |
| `--no-open` / `PI_WEB_NO_OPEN=1` | Skip opening a browser | Opens |
| `PI_WEB_ALLOWED_HOSTS` | Extra exact proxy hostnames | Unset |
| `PI_WEB_PASSWORD` | HTTP Basic Auth (user `pi`) | Off |
| `PI_CODING_AGENT_DIR` | Pi data directory | `~/.pi/agent` |

```bash
pi-web -p 8080 -H 0.0.0.0 --no-open
```

### Remote access

Prefer **Settings → Remote access** on loopback first: add the public hostname your reverse proxy will send in `Host`, and set a password (at least 12 characters). Keep Pi Web on loopback and terminate HTTPS on the proxy. Preserve `Host` and disable response buffering so the event stream stays live.

Binding a non-loopback address exposes an agent that can run tools on your machine. Pi Web **refuses** `--hostname 0.0.0.0` unless a password is configured. Username is always `pi`.

```bash
PI_WEB_PASSWORD='a-long-random-password' pi-web --hostname 0.0.0.0
```

Basic Auth is not encryption. Do not put Pi Web on the public internet over plain HTTP. Use HTTPS behind a trusted proxy or a VPN. `PI_WEB_PASSWORD` overrides a password saved in Settings. Extra hostnames in `PI_WEB_ALLOWED_HOSTS` are merged with the Settings list.

### HTTP proxy

Server-side model and API requests honor `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`.

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## Data and safety

- Same local data as pi. Model changes apply to both UIs.
- File access is limited to known project and session roots, not the whole disk.
- Project-local extensions stay restricted until the project is trusted.
- Worktrees: [docs/worktrees.md](./docs/worktrees.md).

### Downstream session context menu

Electron wrappers can replace a session-row context menu without patching the sidebar. Listen for the cancelable `pi-web:session-row-contextmenu` event and call `preventDefault()` synchronously when you will handle it:

```js
window.addEventListener("pi-web:session-row-contextmenu", (event) => {
  event.preventDefault();
  const { id, path, cwd, name, clientX, clientY, refresh } = event.detail;
  void openSessionMenu({ id, path, cwd, name, clientX, clientY }).then((changed) => {
    if (changed) refresh();
  });
});
```

If no listener cancels the event, Pi Web keeps the browser's native menu.

## Tech stack

React 19 + Vite + [TanStack Start](https://tanstack.com/start) (Router + Nitro Node server). The UI originally ran on Next.js App Router; routing, SSR, and the release pipeline now run on TanStack. See [docs/release.md](./docs/release.md) for the `pack:tanstack` gate.

## Development

```bash
npm install
npm run dev    # http://127.0.0.1:30141
npm test && npx tsc --noEmit && npm run lint
```

Do not run `npm run build` or `npm run pack:tanstack` during ordinary development — production output is written outside the repo and can interfere with `npm run dev`. Release gate: `npm run pack:tanstack`.

Notes: [docs/i18n.md](./docs/i18n.md), [docs/release.md](./docs/release.md), [AGENTS.md](./AGENTS.md).

```text
app/api/         Framework-neutral API handlers (Request / Response)
src/routes/      TanStack pages and thin API adapters
components/      Workspace, conversation, settings, files
hooks/           Client session and UI state
lib/             Sessions, agent RPC, models, Git, security
bin/             CLI entry
docs/            User and contributor guides
```

## License

[MIT](./LICENSE)
