# Pi Web

[简体中文](./README.zh-CN.md)

A local browser workspace for the [pi coding agent](https://github.com/earendil-works/pi). Projects, sessions, live agent work, and Git worktrees stay in one place, using the same `~/.pi/agent` config and JSONL session files as the pi TUI.

```bash
npx @agegr/pi-web@latest
```

Requires Node.js 22.19.0 or newer. Pi Web opens the browser when ready and listens only on `127.0.0.1` by default.

![Pi Web desktop workspace: project sidebar, conversation with tool activity, and context card](./docs/pi-web-workspace.png)

- **Projects and sessions** — search, pin, archive, rename, export, or delete without leaving the sidebar.
- **Live agent work** — streamed thinking and tool calls, plus completion feedback when a run finishes in another project.
- **Models and skills in the browser** — providers, OAuth, API keys, skills, and plugins share pi's local storage.
- **Git worktrees** — create, switch, and remove linked checkouts while sessions from the same repo stay grouped.

## Install

```bash
npx @agegr/pi-web@latest
```

If the browser does not open, visit [http://127.0.0.1:30141](http://127.0.0.1:30141). Open **Settings → Models** to sign in or add an API key.

```bash
npm install -g @agegr/pi-web@latest
pi-web
```

## Remote access

Binding a non-loopback address exposes an agent that can run tools on your machine. Pi Web **refuses** `--hostname 0.0.0.0` unless `PI_WEB_PASSWORD` is set. Username is always `pi`.

```bash
PI_WEB_PASSWORD='a-long-random-password' pi-web --hostname 0.0.0.0
```

Basic Auth is not encryption. Do not put Pi Web on the public internet over plain HTTP. Use HTTPS behind a trusted proxy or a VPN. Extra hostnames go in `PI_WEB_ALLOWED_HOSTS`.

| Option | Purpose | Default |
| --- | --- | --- |
| `-p` / `PORT` | Port | `30141` |
| `-H` / `PI_WEB_HOSTNAME` | Bind address | `127.0.0.1` |
| `--no-open` / `PI_WEB_NO_OPEN=1` | Skip opening a browser | Opens |
| `PI_WEB_ALLOWED_HOSTS` | Extra exact hostnames | Unset |
| `PI_WEB_PASSWORD` | HTTP Basic Auth (user `pi`) | Off |
| `PI_CODING_AGENT_DIR` | Pi data directory | `~/.pi/agent` |

## Data and safety

- Same local data as pi. Model changes apply to both UIs.
- File access is limited to known project and session roots, not the whole disk.
- Project-local extensions stay restricted until the project is trusted.
- Worktrees: [docs/worktrees.md](./docs/worktrees.md).

## Tech stack

React 19 + Vite + [TanStack Start](https://tanstack.com/start) (Router). The UI originally ran on Next.js App Router; routing, SSR, and the release pipeline now run on TanStack — see [docs/release.md](./docs/release.md) for the `pack:tanstack` gate.

## Development

```bash
npm install
npm run dev    # http://127.0.0.1:30141
npm test && npx tsc --noEmit && npm run lint
```

Release gate: `npm run pack:tanstack`. Notes: [docs/i18n.md](./docs/i18n.md), [docs/release.md](./docs/release.md), [AGENTS.md](./AGENTS.md).

## License

[MIT](./LICENSE)
