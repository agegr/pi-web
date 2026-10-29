# Running Pi Web in Docker

This project ships a production image and a Compose example. The image runs as the unprivileged `node` user, listens on port `30141` inside the container, and includes `bash` and `git` for Pi Web's terminal, shell, and Git features. The application itself does not require a Docker-specific environment variable to start; the image supplies its container bind address and port. The Compose example requires a password so the high-privilege UI is not accidentally exposed without authentication.

## Start with Compose

```sh
cp .env.example .env
# Edit .env and set PI_WEB_PASSWORD to a long, unique secret.
mkdir -p workspace
docker compose up --build -d
```

Open <http://localhost:30141>. The published port is bound to host loopback only. To use another local port, set `PI_WEB_PORT` in `.env`; the application still listens on `30141` inside the container.

The equivalent Podman command is `podman compose up --build -d` when the Compose provider is installed. To build without Compose, run `podman build -t pi-web .`.

## Persistent and injected volumes

`compose.yaml` deliberately shows two different kinds of mount:

| Container path | Compose example | Why it is used |
| --- | --- | --- |
| `/home/node/.pi/agent` | Named volume `pi-agent-data` | **The primary persistent data mount.** This is Pi's default agent directory because the image sets `HOME=/home/node`. It holds sessions/transcripts, model and provider configuration/credentials, extensions and packages, MCP settings/auth, and Pi Web's own agent-scoped state. It must be writable. |
| `/home/node/pi-cwd` | Named volume `pi-cwd-data` | Persists the default new-session directories (`~/pi-cwd/YYYYMMDD`) and files created there. |
| `/workspace` | Bind mount from `WORKSPACE_DIR` | Project files the agent should browse, edit, and run commands in. It must be writable for normal coding use. |

The named agent volume is initialized automatically and persists across container recreation. To use an existing host Pi agent directory instead, replace the `pi-agent-data` entry with a bind mount, for example:

```yaml
      - ${HOME}/.pi/agent:/home/node/.pi/agent
```

That bind mount is read/write because Pi Web updates settings, credentials, session data, and other files there. Ensure the container's `node` user can write to the host directory. Do not mount the host agent directory read-only. It contains sensitive provider credentials and grants Pi Web access to them.

Other useful optional mounts, depending on your setup:

- `~/.agents/skills` to `/home/node/.agents/skills` (read-only if skills are only consumed; read/write if you install/manage global skills in the container).
- A host project folder to the same absolute path inside the container.
- Additional project directories to their corresponding container paths if sessions/worktrees use them.

Project-local configuration such as `.pi/` and `.agents/` is already included when its project directory is bind-mounted. If you use the default new-session folder (`/home/node/pi-cwd/YYYYMMDD`), mount a separate persistent volume there too, or select a mounted workspace as the session cwd.

### Reopening existing sessions

Session records contain the absolute working-directory path used when they were created. Mounting a host project at `/workspace` does **not** make an old session recorded as `/home/alice/src/project` resolve to `/workspace`. To resume old sessions with their working directories intact, mount each needed host directory at that same absolute path inside the container and retain the same path between runs. Set both `WORKSPACE_DIR` and `WORKSPACE_CONTAINER_DIR` in `.env` to identical absolute paths for a single workspace, for example:

```dotenv
WORKSPACE_DIR=/home/alice/src/project
WORKSPACE_CONTAINER_DIR=/home/alice/src/project
```

The paths that existed on the host when the sessions were created must be mounted into the container. Paths are not rewritten when sessions are imported.

For Podman on SELinux hosts, bind mounts may need a `:Z` label suffix. Rootless Podman/Docker bind mounts also need permissions that let UID 1000 (the image's `node` user) access the files; adjust host ownership or use your engine's user-namespace mapping as appropriate.

## Environment variables

The Compose file explicitly sets the following:

| Variable | Container value / requirement | Purpose |
| --- | --- | --- |
| `PORT` | `30141` | Internal HTTP port. Keep the Compose container port and healthcheck in sync if you change it. |
| `PI_WEB_HOSTNAME` | `0.0.0.0` | Required for access through the container network; Pi Web's normal non-container default is loopback-only. |
| `PI_WEB_NO_OPEN` | `1` | Prevents attempts to open a browser in the container. |
| `PI_CODING_AGENT_DIR` | `/home/node/.pi/agent` | Explicitly points Pi and Pi Web at the persistent agent mount; normally this defaults to `$HOME/.pi/agent`. |
| `PI_WEB_PASSWORD` | Required by the Compose interpolation | Enables browser password login. Use a strong secret. |
| `PI_WEB_ALLOWED_HOSTS` | Optional, empty by default | Comma-separated, exact proxy/custom hostnames. Set this when a reverse proxy forwards a hostname not otherwise accepted by Pi Web. |
| `PI_WEB_SKIP_VERSION_CHECK` | `1` | Disables the Pi Web update check in this deployment. |

There are no model API keys required to start the web server. Configure provider credentials in the Models panel or persist an existing Pi agent directory. Provider API requests still require network access unless using a local provider.

Other supported/consumed variables can be supplied through the `environment:` section or `.env` as needed:

- `PI_WEB_APP_NAME`: PWA manifest name.
- `PI_WEB_IDLE_TIMEOUT_MS`, `PI_WEB_SHUTDOWN_DEADLINE_MS`, `PI_WEB_MCP_IDLE_MS`: session/MCP lifecycle timings.
- `PI_CODEMODE_MAX_WORKERS`: Pi code-mode worker limit.
- `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`: outbound proxy configuration.
- `PI_OFFLINE`: disable online model-catalog/plugin checks.
- `PI_WEB_DISABLE_MCP`: disable MCP integration.
- `PI_WEB_PUSH_SUBJECT`: optional Web Push VAPID subject.
- `GITHUB_TOKEN` or `GH_TOKEN`: optional GitHub API token used by skill update checks; `SKILLS_API_URL` overrides the skills service base URL.
- `PI_WEB_PERF`, `PI_WEB_SSE_BACKLOG_LIMIT_BYTES`: performance diagnostics / SSE backpressure tuning.

Refer to the Configuration section of the main README for option defaults and validation details. Never bake passwords or provider tokens into the image.

## Security notes

Pi Web can invoke tools, run shell commands, edit project files, and access the agent credentials in its mounted agent directory. Treat the service as a trusted local application, not a public website. Compose binds the published port to `127.0.0.1`; for remote access, use a trusted HTTPS reverse proxy or VPN, keep password authentication enabled, and configure `PI_WEB_ALLOWED_HOSTS` for the forwarded hostname. Do not expose plain HTTP to the public internet.

The mounted workspace is writable by the agent. Only mount directories you intend Pi Web to access. Keep the writable agent directory and provider credentials private.

## GHCR publishing

`.github/workflows/container.yml` builds multi-platform (`linux/amd64` and `linux/arm64`) images and pushes to `ghcr.io/<owner>/<repository>` on pushes to `main`, version tags (`v*.*.*`), and manual dispatch. It uses the built-in `GITHUB_TOKEN`; no registry password secret is needed. Ensure Actions has permission to write packages. A newly published package may be private by default; change its GHCR package visibility in GitHub if public pulls are desired.
