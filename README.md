# Pi Web

[中文文档](./README.zh-CN.md) | [日本語](./README.ja.md)

Local web UI for the [pi coding agent](https://github.com/badlogic/pi-mono). Pi Web reads your local pi session files and gives you a browser workspace for session browsing, real-time chat, model configuration, skill management, and project file preview.

![Pi Web shows the same pi session with structured Markdown, tool calls, and project navigation beside the CLI](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

The same pi session in CLI and Pi Web: structured tool calls, readable Markdown, session browsing, and cleaner results.

## Quick Start

Pi Web requires Node.js 22.19.0 or newer. Check your version with `node --version`.

**Run without installing:**

```bash
npx @agegr/pi-web@latest
```

**Or install the npm package globally:**

```bash
npm install -g @agegr/pi-web
pi-web
```

For a local project install instead, run `npm install @agegr/pi-web` and invoke `npx pi-web`.

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
PI_WEB_NO_OPEN=1 pi-web         # useful when running as a background service
```

API requests accept loopback names, IP literals, the selected bind hostname, and exact comma-separated names in `PI_WEB_ALLOWED_HOSTS`. Configure that variable when a trusted reverse proxy uses a different external hostname.

## Public Deployment and Authentication

Pi Web requires authentication by default. On first launch, a one-time initialization token is printed to the server terminal. Enter it on the setup page and choose a password. The token is not the password and is not recoverable from the browser or config file.

Login rate limiting uses one fixed anonymous source bucket by default and does not trust client-supplied proxy headers. If Pi Web is deployed behind a trusted reverse proxy that overwrites these headers, set `PI_WEB_TRUSTED_PROXY=true` to use its `X-Forwarded-For`/`X-Real-IP` source. Do not enable this unless every direct client is prevented from reaching Pi Web and the proxy sanitizes those headers.

- Authentication is stored at `~/.pi/agent/pi-web-auth.json` by default; set `PI_WEB_AUTH_CONFIG_PATH` to choose another path.
- Pi Agent sessions, models, and related settings remain under `~/.pi/agent/` by default. Set `PI_CODING_AGENT_DIR` to use another Pi Agent directory.
- If the initialization token is lost, stop Pi Web locally, remove the auth config, and restart it to receive a new token in the terminal. Only the local operator should do this; it resets authentication and requires a new password.
- If Pi Web reports that the auth config is damaged, it will not treat the installation as uninitialized and will not reset the file. Stop the service, back up the path printed on server stderr, and repair or remove it only as an intentional local recovery action.
- Login sessions expire after 24 hours. Changing the password revokes existing sessions, so sign in again with the new password.
- An expired auth session, a disconnected browser, or a password change does not stop, destroy, or abort a background AgentSession. Running work continues and its result is available after signing in again.

### HTTPS and Reverse Proxy

For public access, put Pi Web behind an HTTPS reverse proxy and bind Pi Web to loopback. If `PI_WEB_TRUSTED_PROXY=true` is enabled, direct client access must be blocked and the trusted proxy must overwrite, not append, the client-supplied `X-Forwarded-For` header. The following Nginx example assumes that your certificate manager has configured the TLS certificate:

```nginx
server {
    listen 443 ssl;
    server_name pi.example.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:30141;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;
    }
}
```

Start Pi Web with `--hostname 127.0.0.1`, allow the proxy's external hostname, and enable trusted proxy source detection instead of exposing its HTTP port directly:

```bash
PI_WEB_ALLOWED_HOSTS=pi.example.com PI_WEB_TRUSTED_PROXY=true pi-web --hostname 127.0.0.1 --port 30141 --no-open
```

Pi Web uses SSE for live Agent status, so the proxy must allow long-lived connections and disable response buffering. Restrict firewall access, use a valid TLS certificate, and keep `pi-web-auth.json`, Pi session files, and model API keys inaccessible to other users. The setup token is printed only once to the server terminal/stderr (or the service's server-side log); it is never returned in an HTTP response, browser UI, cookie, or config file.

This repository does not include a built-in `Dockerfile`. If you build a container image, mount the Pi Agent config directory into the container and set `PI_CODING_AGENT_DIR` to that mount. Put the auth config on a persistent volume or set `PI_WEB_AUTH_CONFIG_PATH`; otherwise recreating the container loses authentication state. Never put passwords, initialization tokens, session cookies, or API keys in images, Dockerfiles, compose files, or logs.

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
node_modules/.bin/tsc --noEmit
npm run lint
```

Avoid running `next build` / `npm run build` during local development. It writes to `.next/` and can interfere with the dev server; leave builds for release work.

## Project Structure

```text
app/
  api/
    agent/          # creates/drives AgentSession and exposes SSE events
    auth/           # OAuth and API key management
    cwd/browse/     # browsable server directory listing
    cwd/validate/   # custom working directory validation
    default-cwd/    # pi default working directory lookup
    files/          # file listing, reading, preview, and watching
    home/           # current user home directory
    models/         # available models, default model, thinking levels
    models-config/  # read/write models.json and test models
    sessions/       # session reads, rename, delete, context, HTML export
    skills/         # skill listing, search, install, enable/disable
components/
  AppShell.tsx        # main layout, URL state, top panels, file tabs
  SessionSidebar.tsx  # project selector, session tree, Explorer
  DirectoryPicker.tsx # browsable and editable working-directory picker
  ChatWindow.tsx      # messages, SSE, image drag/drop, minimap
  ChatInput.tsx       # input bar, model/tools/thinking/compact/slash controls
  MessageView.tsx     # message, thinking, tool call/result rendering
  ModelsConfig.tsx    # model and auth configuration panel
  SkillsConfig.tsx    # skill management panel
  FileExplorer.tsx    # file tree
  FileViewer.tsx      # source, diff, image, audio, PDF, DOCX preview
lib/
  directory-browser.ts # directory normalization and safe listing helpers
  http-dispatcher.ts  # HTTP(S) proxy setup for server-side fetch
  rpc-manager.ts      # AgentSessionWrapper lifecycle and global registry
  session-reader.ts   # parses .jsonl session files and branch contexts
  normalize.ts        # normalizes toolCall field names
  file-access.ts      # file read safety boundary
  file-paths.ts       # path encoding and relative path helpers
  markdown.ts         # Markdown/Mermaid/KaTeX plugin configuration
  pi-types.ts         # pi-related types
hooks/
  useAgentSession.ts  # session loading, command sending, SSE state machine
  useAudio.ts         # completion sound
  useDragDrop.ts      # image drag/drop
  useTheme.ts         # theme switching
bin/
  pi-web.js           # npm CLI entrypoint
instrumentation.ts    # initializes the server HTTP dispatcher
```
