# Pi Web

[简体中文](./README.zh-CN.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

A local browser workspace for the [pi coding agent](https://github.com/earendil-works/pi). Pi Web keeps projects, sessions, agent activity, worktrees, and files in one interface while using the same local configuration and JSONL session files as pi.

```bash
npx @agegr/pi-web@latest
```

Requires Node.js 22.19.0 or newer. Pi Web opens the browser when the server is ready and listens only on `127.0.0.1` by default.

![Pi Web desktop workspace with project navigation, structured tool activity, a Markdown response, and a project file preview](./docs/pi-web-workspace.png)

## One Workspace For Pi

- **Projects and sessions**: keep repositories directly visible, search and reorder projects, archive inactive work, and browse, resume, rename, export, or delete sessions while continuing to use pi-compatible directories and JSONL storage.
- **Live agent activity**: see which projects are running, follow streamed thinking and tool calls, and receive completion feedback even when work finishes outside the active project.
- **Session relationships**: keep primary, forked, and subagent sessions understandable; create an independent session from an earlier message or branch inside the current session.
- **Files beside the conversation**: open linked files from messages and inspect Git diffs, with previews for source, Markdown, images, audio, PDFs, and DOCX files that refresh automatically.
- **Git worktrees**: create, switch, and remove linked checkouts from the sidebar while sessions from the same repository stay grouped together.
- **Focused controls**: inspect context and cost, choose models and reasoning levels, switch tool presets, compact context, navigate branches, and open local file links directly from Markdown.

![Pi Web project sidebar with related sessions and linked Git worktrees](./docs/pi-web-projects.png)

## Configuration In The Browser

Pi Web shares pi's local settings and credential storage. Saved model and provider changes also refresh active sessions, so new configuration takes effect without restarting the workspace. The Settings center brings together:

- model providers, OAuth login, API keys, custom endpoints, model discovery, and model tests;
- global and project skills, including search, installation, and updates;
- plugin packages and project extension reloads;
- appearance, language, completion sound, project trust, and archived projects.

Credentials remain in pi's local storage. The screenshots in this README use synthetic provider data and contain no credential material.

![Pi Web Settings with model providers, models, skills, and plugins in one workspace](./docs/pi-web-settings.png)

## Current Technical Foundation

The current repository runs on **TanStack Start**, **TanStack Router**, **Vite**, and **Nitro** with a Node server output. The migration keeps the application behavior while replacing the former Next.js runtime.

```text
Browser / PWA
    ↓ TanStack Router + streamed SSE
TanStack Start routes and global middleware
    ↓ thin adapters
Framework-neutral app/api handlers (Request / Response)
    ↓
Pi sessions, models, tools, files, Git, and worktrees
```

- **Framework-neutral API core**: 41 API handlers use standard Web `Request` and `Response` objects. TanStack server routes stay thin, and a shared method guard preserves explicit `405` behavior.
- **Streaming-first runtime**: agent turns use SSE with heartbeat and reconnect behavior. Dispatcher setup happens before the server handles requests.
- **Installable PWA**: the manifest, service worker, offline page, responsive layout, and browser notifications keep the workspace useful across desktop and narrow screens.
- **Request security**: exact-host validation, optional HTTP Basic Auth, project trust checks, CSRF protection for server functions, and scoped filesystem roots protect local agent capabilities.
- **Reproducible package path**: production output is built outside the repository, staged into an npm tarball, installed into a fresh temporary project, and probed through the real `pi-web` CLI before publishing.
- **Windows verification**: a dedicated Windows workflow exercises checkout line endings, build output, packaging, installation, startup, and route smoke tests; the regular project checks cover tests, lint, and typecheck.

## Install And Run

Run without installing globally:

```bash
npx @agegr/pi-web@latest
```

If the browser does not open, visit [http://127.0.0.1:30141](http://127.0.0.1:30141). If no model provider is configured, open **Settings → Models** to sign in or add an API key.

For a global `pi-web` command:

```bash
npm install -g @agegr/pi-web@latest
pi-web
```

To update, stop the running process with `Ctrl+C` and run the install command again. To uninstall, run `npm uninstall -g @agegr/pi-web`.

## Configuration

Command-line options override the corresponding environment variables. Either `--no-open` or `PI_WEB_NO_OPEN=1` disables automatic browser opening.

| Option or environment variable | Purpose | Default |
| --- | --- | --- |
| `--port <port>`, `-p <port>`, or `PORT` | Server port | `30141` |
| `--hostname <host>`, `-H <host>`, or `PI_WEB_HOSTNAME` | Bind hostname | `127.0.0.1` |
| `--no-open` or `PI_WEB_NO_OPEN=1` | Do not open a browser automatically | Browser opens |
| `PI_WEB_ALLOWED_HOSTS` | Additional exact proxy or custom hostnames, comma-separated | Unset |
| `PI_WEB_PASSWORD` | Enable HTTP Basic Auth; the username is always `pi` | Authentication disabled |
| `PI_CODING_AGENT_DIR` | Use a different pi agent data directory | `~/.pi/agent` |

Example:

```bash
pi-web -p 8080 -H 0.0.0.0 --no-open
```

### Remote Access

Binding to a non-loopback address exposes an agent that can execute high-privilege actions. On a trusted LAN, require a long random password:

```bash
PI_WEB_PASSWORD='a-long-random-password' pi-web --hostname 0.0.0.0
```

Basic Auth does not encrypt the password in transit. Do not expose Pi Web over plain HTTP to the internet; use HTTPS through a trusted reverse proxy or a trusted VPN. If a reverse proxy sends an external hostname, add that exact name to `PI_WEB_ALLOWED_HOSTS`. This allow-list does not change the address Pi Web binds to.

### HTTP Proxy

Server-side model and API requests honor `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`.

macOS or Linux:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

Windows PowerShell:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## Data And Safety Notes

- **Shared local data**: Pi Web reads pi configuration and sessions from `~/.pi/agent` by default. Changes made in the Models panel are visible to both interfaces.
- **Same filesystem**: Pi Web must be able to read the agent data directory and the working directories recorded by its sessions. Run it in the same filesystem environment as pi when sharing existing sessions.
- **File boundary**: the file browser is limited to working directories selected in Pi Web and project or session roots it already knows about; it is not a general filesystem browser.
- **Project trust**: project-local extensions and skills that require trust stay restricted until the project is explicitly trusted.
- **Worktrees**: see [Worktrees in Pi Web](./docs/worktrees.md) for switcher visibility, creation, removal, and dirty-checkout behavior.

### Downstream Session Menus

Desktop wrappers can replace a session row's native context menu without patching `CodexSidebar`. Listen for the cancelable `pi-web:session-row-contextmenu` browser event and call `preventDefault()` synchronously when the integration will handle it:

```js
window.addEventListener("pi-web:session-row-contextmenu", (event) => {
  event.preventDefault();
  const { id, path, cwd, name, clientX, clientY, refresh } = event.detail;

  void openSessionMenu({ id, path, cwd, name, clientX, clientY }).then((changed) => {
    if (changed) refresh();
  });
});
```

The detail object includes the session identifiers, pointer coordinates, and a `refresh()` callback. If no listener cancels the event, Pi Web preserves the browser's native context menu.

## Development

```bash
npm install
npm run dev
```

The development server runs at [http://127.0.0.1:30141](http://127.0.0.1:30141). Common checks:

```bash
npm test
npx tsc --noEmit
npm run lint
```

Normal development does not write a production `.output` directory into the repository. The full release gate is explicit:

```bash
npm run pack:tanstack
```

It builds into external temporary directories, verifies the Nitro output, stages and packs the npm artifact, installs the exact tarball, starts its CLI, and runs the installed-package smoke. Publishing remains a separate `npm publish` action.

Contributor guides: [Internationalization](./docs/i18n.md), [Release process](./docs/release.md), and [architecture notes](./AGENTS.md).

## Repository Layout

```text
app/api/         Framework-neutral API handlers using standard Web APIs
src/routes/      TanStack Start pages and thin API route adapters
src/start.ts     Global request security, CSRF, and method middleware
src/server.ts    Server entry and HTTP dispatcher initialization
components/      React workspace, conversation, settings, and file UI
hooks/           Client state and interaction hooks
lib/             Session, agent, model, file, Git, and security logic
scripts/         External build, package, verification, and smoke tools
public/          PWA assets, service worker, offline page, and icons
bin/             npm CLI entrypoint and launch option parsing
docs/            User, contributor, migration, and release documentation
```

## License

[MIT](./LICENSE)
