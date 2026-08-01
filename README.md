# omp-web

[中文文档](./README.zh-CN.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

The web view for [omp (oh-my-pi)](https://github.com/can1357/oh-my-pi). omp-web reads the sessions the `omp` CLI already writes and gives you a browser workspace for session browsing, real-time chat, model roles, provider configuration, skill management, and project file preview.

It is not a separate agent: omp-web runs omp's own SDK in-process, against the same `~/.omp/agent` directory, so a session started in the terminal continues in the browser and back again.

<img width="1912" height="1242" alt="image" src="https://github.com/user-attachments/assets/6a3932c0-5ed2-4682-b4a7-db7837c764ad" />


## Quick Start

omp-web serves its API on **Bun**, because that is what the omp SDK requires (it is published as TypeScript sources and imports `bun:` builtins). Install Bun 1.2 or newer:

```bash
curl -fsSL https://bun.sh/install | bash        # macOS / Linux
powershell -c "irm bun.sh/install.ps1 | iex"    # Windows
```

**Run without installing:**

```bash
bunx omp-web@latest
```

**Or install globally:**

```bash
bun add -g omp-web    # or: npm install -g omp-web
omp-web
```

Then open [http://127.0.0.1:30141](http://127.0.0.1:30141). The CLI opens the browser automatically once the server is ready, and listens on `127.0.0.1` by default.

The `omp-web` entrypoint itself runs under Node or Bun; it locates Bun and re-executes the server there. Point it at a specific build with `OMP_WEB_BUN=/path/to/bun`.

**Options:**

```bash
omp-web --port 8080              # custom port
omp-web --hostname 0.0.0.0       # expose on a trusted network
omp-web -p 8080 -H 0.0.0.0       # combine options
omp-web --no-open                # do not open the browser automatically

PORT=8080 omp-web                 # environment variable is also supported
OMP_WEB_HOSTNAME=0.0.0.0 omp-web  # explicit network exposure
OMP_WEB_ALLOWED_HOSTS=omp.internal omp-web  # allow an exact proxy/custom hostname
OMP_WEB_PASSWORD='a-long-random-password' omp-web  # require Basic Auth (username: omp)
OMP_WEB_NO_OPEN=1 omp-web         # useful when running as a background service
```

Set `OMP_WEB_PASSWORD` to protect the web interface and every API endpoint with HTTP Basic Auth. The username is always `omp`. Leaving the variable unset or empty disables authentication.

omp-web can invoke a high-privilege agent. Basic Auth does not encrypt the password in transit, so do not expose plain HTTP to the internet. Use HTTPS through a trusted reverse proxy or a trusted VPN for remote access.
API requests accept loopback names, IP literals, the selected bind hostname, and exact comma-separated names in `OMP_WEB_ALLOWED_HOSTS`. Configure that variable when a trusted reverse proxy uses a different external hostname.

## Model roles

omp does not have "the" model — it has a model per **scope of work**, and omp-web exposes the same roles the TUI's `/model` selector and `Ctrl+P` cycle use:

| Role | What it runs |
| --- | --- |
| `default` | ordinary turns |
| `smol` | cheap, fast subagent and background work |
| `slow` | deep reasoning on hard problems |
| `plan` | plan mode |
| `commit` | commit messages and changelogs |
| `task` | the model subagents spawn with |
| `advisor` | the second model that reviews every turn |
| `vision`, `designer`, `tiny` | image turns, design work, classification |

Two places surface them:

- **The model picker in the chat bar** lists the configured roles above the flat model list. Picking one switches the session onto that role's model *and records the role*, exactly like `/model` does, so the transcript and omp's retry fallbacks agree on which role is driving.
- **Models → Model roles** assigns a model to each role. Writes go to `modelRoles` in `~/.omp/agent/config.yml` (or `.omp/config.yml` when you pick **This project**), which is the same record the CLI reads — an assignment made in the browser is what your next terminal session starts with.

Session titles follow the same routing: omp-web asks omp to name a session, and omp resolves that through the `tiny` → `commit` → `smol` chain rather than the session's primary model.

## HTTP Proxy

omp-web reads the standard `HTTP_PROXY` and `HTTPS_PROXY` environment variables for server-side model and API requests. Bun reads them once at process start, so set them before launching:

On macOS or Linux:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
bunx omp-web@latest
```

On Windows PowerShell:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
bunx omp-web@latest
```

Requests to loopback addresses are never proxied, so a local provider (Ollama, LM Studio, llama.cpp) keeps working with a proxy configured. Note that Bun does **not** currently honour `NO_PROXY` for other hosts.

## Features

- **Pick work back up**: browse previous omp conversations by project without digging through terminal history or session paths.
- **Route by role**: assign and switch models per scope of work — the roles omp already uses for subagents, plan mode, and commits.
- **Try different directions safely**: continue from an earlier message or fork a session into a separate route.
- **Work across branches**: switch Git worktrees from the sidebar so new sessions and the Explorer follow the checkout you choose.
- **Chat beside the project**: browse files on the left and preview source, docs, images, audio, and PDFs on the right while the agent works.
- **See session state clearly**: context usage, cost, compaction state, and system prompt details are visible from the top bar.
- **Configure less from the terminal**: manage providers, logins/API keys, model tests, plugins, and skill switches from the web UI.
- **Use the interface in your language**: switch between the supported UI languages from the top bar.

## Notes

- **Data directory**: omp-web reads `~/.omp/agent/sessions` by default. Set `PI_CODING_AGENT_DIR` to point at another omp agent directory (omp kept the variable name).
- **Session files**: files are stored as `~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`.
- **Provider config**: the Models panel reads and writes `models.yml` in the omp agent directory. Credentials live in omp's `agent.db`, shared with the CLI. A header value that names an environment variable (bare name, no `$`) is substituted at request time.
- **Project trust**: opening a repository in a browser tab must not run its code, so omp-web gates a project's `.omp/extensions`, `.omp/hooks`, `.omp/tools` and `.mcp.json` behind an explicit trust decision. Skills and rules are data and load either way. See [Project trust](./docs/project-trust.md).
- **File access**: file browsing and preview are scoped to the selected project directory and working directories that appear in sessions.
- **Git worktrees**: see [Worktrees in omp-web](./docs/worktrees.md) for when the switcher appears, how new worktrees are created, and what removal does.
- **Forks vs in-session branches**: Fork creates a new `.jsonl` file. "Edit from here" creates another branch inside the same session file.
- **Skills**: the skill installer shells out to `npx skills add --agent claude-code`, which writes the `.claude/skills` layout omp discovers by default.
- **Internationalization**: see [Internationalization](./docs/i18n.md) for using translations and adding languages or UI text.

## Development

```bash
bun install
bun run dev
```

The local dev server runs at [http://127.0.0.1:30141](http://127.0.0.1:30141).

Common checks:

```bash
bun run typecheck
bun run lint
bun test
```

Avoid running `bun run build` during local development. It writes to `.next/` and can interfere with the dev server; leave builds for release work.

## Project Structure

```text
app/
  api/
    agent/          # creates/drives AgentSession and exposes SSE events
    auth/           # OAuth and API key management through omp's AuthStorage
    cwd/browse/     # browsable server directory listing
    cwd/validate/   # custom working directory validation
    default-cwd/    # omp default working directory lookup
    files/          # file listing, reading, preview, and watching
    home/           # current user home directory
    model-roles/    # read/write omp's modelRoles (default/smol/slow/plan/…)
    models/         # available models, default model, thinking levels, roles
    models-config/  # read/write models.yml and test models
    plugins/        # omp plugin install/remove/enable/disable
    sessions/       # session reads, rename, delete, context, HTML export
    skills/         # skill listing, search, install, enable/disable
components/
  AppShell.tsx        # main layout, URL state, top panels, file tabs
  SessionSidebar.tsx  # project selector, session tree, Explorer
  DirectoryPicker.tsx # browsable and editable working-directory picker
  ChatWindow.tsx      # messages, SSE, image drag/drop, minimap
  ChatInput.tsx       # input bar, model/role/tools/thinking/compact/slash controls
  MessageView.tsx     # message, thinking, tool call/result rendering
  ModelsConfig.tsx    # provider and auth configuration panel
  ModelRolesPanel.tsx # per-role model assignment
  SkillsConfig.tsx    # skill management panel
  FileExplorer.tsx    # file tree
  FileViewer.tsx      # source, diff, image, audio, PDF, DOCX preview
lib/
  directory-browser.ts # directory normalization and safe listing helpers
  http-dispatcher.ts  # HTTP(S) proxy setup for server-side fetch
  model-roles.ts      # omp's model roles, read and written for the browser
  model-scope.ts      # enabledModels resolution shared by UI and startup
  omp-runtime.ts      # shared Settings + AuthStorage + ModelRegistry
  omp-types.ts        # structural view of omp's AgentSession
  project-trust.ts    # gates a project's executable resources
  rpc-manager.ts      # AgentSessionWrapper lifecycle and global registry
  session-reader.ts   # parses .jsonl session files and branch contexts
  normalize.ts        # normalizes toolCall field names
  file-access.ts      # file read safety boundary
  file-paths.ts       # path encoding and relative path helpers
  markdown.ts         # Markdown/Mermaid/KaTeX plugin configuration
hooks/
  useAgentSession.ts  # session loading, command sending, SSE state machine
  useAudio.ts         # completion sound
  useDragDrop.ts      # image drag/drop
  useTheme.ts         # theme switching
bin/
  omp-web.js          # CLI entrypoint; re-executes the server under Bun
  runtime.js          # Node/Bun version checks and Bun discovery
instrumentation.ts    # initializes the server HTTP dispatcher
```
