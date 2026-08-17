# Lessons Learned Matrix

This matrix documents technical pitfalls, root causes, fixes, and universal guidelines applicable across projects.

---

## 1. Docker Compose Variable Expansion in YAML

- **Symptom**: Warning `The "XYZ" variable is not set` when running `docker compose up`, resulting in truncated environment variable values inside the container.
- **Root Cause**: Docker Compose parses `$VAR` syntax inside `environment:` entries in `.yml` files as Compose environment variable interpolation.
- **Fix**: Escape every `$` as `$$` in `docker-compose.yml` (e.g. `your_complex_password_here`).
- **Lesson / Rule**: Always double `$` characters (`$$`) when setting passwords or secret tokens in `docker-compose.yml` environment blocks.

---

## 2. Hardcoded Credentials in Third-Party Web Frameworks

- **Symptom**: HTTP 401 Unauthorized errors despite using the correct password.
- **Root Cause**: Upstream implementation hardcodes the Basic Auth username (e.g. `PI_WEB_AUTH_USERNAME = "pi"` in `lib/web-auth.ts`).
- **Fix**: Verify username constraints in application source code before assuming arbitrary usernames (`admin`, `user`, etc.) are permitted.
- **Lesson / Rule**: Always inspect the application's authentication middleware to determine whether the username is configurable or fixed.

---

## 3. Reverse Proxy Host Header Rejection

- **Symptom**: Web application returns `403 Forbidden` when accessed via Cloudflare Tunnel or reverse proxy domain.
- **Root Cause**: Middleware validates incoming `Host` headers against an explicit whitelist to prevent Host Header Injection attacks.
- **Fix**: Pass the public domain name (e.g. `pi01.xxx.com`) to `PI_WEB_ALLOWED_HOSTS`.
- **Lesson / Rule**: When deploying containerized web services behind Cloudflare Tunnel, Nginx, or Caddy, always explicitly configure the application's allowed host list.

---

## 4. Docker Hairpin NAT — Container Cannot Reach Host-Published Ports

- **Symptom**: `cloudflared` container logs show `dial tcp 192.168.1.61:30141: i/o timeout` or `dial tcp 172.17.0.1:30141: i/o timeout`. The target service is confirmed reachable from the host itself (`curl http://192.168.1.61:30141` returns 200).
- **Root Cause**: Docker hairpin NAT. When a container on the default `bridge` network tries to reach a host-published port via the host's LAN IP (`192.168.1.61`) or the Docker bridge gateway (`172.17.0.1`), the packet must exit the bridge, hit host iptables PREROUTING/FORWARD chains, and loop back. On many Linux hosts the default netfilter rules **drop** or **do not DNAT** such hairpinned packets, causing a silent timeout.
- **Key Insight**: This behavior is **host-specific**. One machine (e.g. `pi08` at `192.168.1.62`) may allow hairpin NAT fine, while another (e.g. `pi06` at `192.168.1.61`) does not — even with identical Docker versions. The difference lies in iptables/nftables configuration.
- **Fix**: Do **not** route through host IPs from inside containers. Use Docker container DNS instead (see Lesson 5).
- **Lesson / Rule**: Never assume a containerized service (like `cloudflared`) can reach another container's published port via the host's IP address. Always test container-to-container connectivity explicitly.

---

## 5. Cloudflare Tunnel Origin URL — Use Container DNS, Not Host IP

- **Symptom**: Cloudflare Tunnel dashboard is configured with `http://192.168.1.61:30141` or `http://172.17.0.1:30141` as the origin URL, but all requests time out.
- **Root Cause**: `cloudflared` runs inside a Docker container. It cannot reach port-published services via host IPs due to hairpin NAT (Lesson 4).
- **Fix**: 
  1. Connect `cloudflared` to pi-web's Docker compose network: `docker network connect pi-web_default <cloudflared_container>`
  2. Set the Cloudflare Dashboard origin URL to `http://pi-web:30141` — Docker embedded DNS resolves `pi-web` to the container's internal IP on the shared network.
- **Verification**: `docker run --rm --network pi-web_default alpine/curl -s -o /dev/null -w "%{http_code}" -H "Host: pi06.n8n.tw" http://pi-web:30141/` must return `401` (auth prompt) or `200` (with credentials).
- **Lesson / Rule**: When `cloudflared` is containerized and needs to reach another container, always use Docker service DNS names (`http://<container_name>:<port>`) on a shared user-defined network. Never use host LAN IPs or bridge gateway IPs as origin URLs.

---

## 6. Cloudflared Network Connection Does Not Persist Across Restarts

- **Symptom**: After `docker compose down && docker compose up -d` or a host reboot, `cloudflared` loses connectivity to `pi-web:30141` and the Cloudflare Tunnel starts timing out again.
- **Root Cause**: `docker network connect` is a runtime operation. When either container is recreated, the cross-network link is lost. `cloudflared` (managed as a standalone `docker run` container, not in the same compose file) is not automatically reconnected.
- **Fix**: 
  1. Create an idempotent reconnection script (`connect-cloudflared.sh`) that runs `docker network connect pi-web_default <cloudflared_container>`.
  2. Register a `@reboot` cron job: `@reboot sleep 30 && /path/to/connect-cloudflared.sh`
  3. Always run `./connect-cloudflared.sh` after `docker compose up -d`.
- **Lesson / Rule**: Any `docker network connect` between containers managed by different lifecycle systems (standalone container vs. compose project) must be re-applied after every restart. Automate it.

---

## 7. Fresh Container Working Directory Access Gating (`Access denied` on `/api/models`)

- **Symptom**: `GET /api/models?cwd=/workspace` returns `403 Access denied` on fresh Docker deployments when no session files exist yet.
- **Root Cause**: `getAllowedFileRoots()` in `lib/file-access.ts` derived allowed roots strictly from existing session `.jsonl` files and explicit user selections. On a fresh container start without pre-existing session files, `process.cwd()` (`/workspace`) was missing from the allowed roots set.
- **Fix**: Included `process.cwd()` in `getAllowedFileRoots()` by default so the process working directory is automatically authorized.
- **Lesson / Rule**: Always authorize the application's runtime working directory (`process.cwd()`) in security file-access boundaries to ensure fresh deployments without pre-existing sessions can query models and load project metadata immediately.

---

## 8. Custom OpenAI-Compatible Provider Setup (`n8n-qwen` / `Qwen3.8-27B`)

- **Symptom**: Custom OpenAI API gateway models (`openai-completions` API type) not showing up or failing during inference.
- **Root Cause**: Models missing from `~/.pi/agent/models.json` or misconfigured max tokens/reasoning parameters.
- **Fix**: Registered `n8n-qwen` provider with `api: "openai-completions"`, `baseUrl: "http://192.168.1.86:30003/gw/v1"`, and `reasoning: true` under `~/.pi/agent/models.json`.
- **Lesson / Rule**: Ensure custom OpenAI-compatible gateways match Pi's `models.json` schema and account for reasoning tokens emitted during inference.

---

## 9. Docker Bridge Gateway IP Is Not Fixed Across Networks

- **Symptom**: An in-container SSH bridge to the host using a previously working gateway IP (e.g. `172.21.0.1`) fails after redeployment onto a different docker network.
- **Root Cause**: Each user-defined docker bridge network gets its own subnet. The host's address as seen from inside a container is always the network gateway (`.1` of the container's subnet), but that address changes per network.
- **Fix**: Discover the gateway at setup time: decode the `gw` field of the default route in `cat /proc/net/route` (little-endian hex, e.g. `01001CAC` → `172.28.0.1`), or take the container's own IP and set the host part to `.1`.
- **Lesson / Rule**: Never hardcode the bridge gateway as the only source of truth. Make it a parameter (env var / CLI flag) and document the discovery method next to it.

---

## 10. Secrets Typed in Chat Are Persisted in Pi Session Files

- **Symptom**: Host SSH passwords, sudo passwords, or API keys typed into a pi session appear in the session JSONL file and are therefore readable by anyone with filesystem access to `~/.pi/agent/sessions/`.
- **Root Cause**: Pi sessions are plain JSONL files (typically mode 644) mounted into the container. The agent records every user message verbatim, including secrets.
- **Fix**:
  1. Never type secrets in chat. Use environment variables or a local `.env` file (mode 600) loaded by a pi skill (see `docs/docker-host-bridge.md` Solution B+).
  2. If a secret was already typed, rotate it immediately and treat the affected session file as compromised.
  3. Consider restricting filesystem permissions on `~/.pi/agent/sessions/` (e.g., 700) and limiting who can access the host volume.
- **Lesson / Rule**: Treat pi session files as sensitive data. Secrets must never be entered via chat; always load them from protected environment sources.

---

## 11. Container root ≠ Host root, and Running as root Has Ownership Costs

- **Symptom**: After setting `user: "0"` in `docker-compose.yml`, the agent can write to mounted volumes, but newly created files are owned by `root:root`. Switching back to `user: node` later results in "Permission denied" on those files. Some tasks that seem like "fix host" cannot be done from inside the container at all.
- **Root Cause**: Container root is namespaced to the container. It only has full privileges over the container's filesystem and the volumes explicitly mounted from the host. It does **not** grant host-wide root access. Running as root inside the container changes ownership of files inside mounted volumes to root, which breaks the default node user.
- **Fix**:
  1. Understand the boundary: container can only touch its own filesystem + mounted volumes (`~/.pi/agent`, `/workspace` → `/home/wrt/TigerAI/AG/SystemRepair`). Anything outside those mounts requires an SSH bridge back to the host.
  2. Avoid long-term `user: "0"`. Use it only temporarily for specific writes, then revert to node.
  3. For host-wide operations (e.g., fixing the wrt host itself, managing Docker, editing files outside the mounts), use the SSH bridge skill to execute commands as the host user (with sudo when explicitly approved).
- **Lesson / Rule**: Container root is not host root. Never assume container privileges extend to the host. Prefer SSH bridge for host operations and keep the container running as an unprivileged user to avoid ownership drift.

---

## 12. Docker API Version Mismatch with `docker compose`

- **Symptom**: Running `docker compose up -d --build` fails immediately with `unable to get image '...': Error response from daemon: client version 1.53 is too new. Maximum supported API version is 1.43`.
- **Root Cause**: The installed `docker compose` CLI version negotiates an API version higher than what the Docker daemon on the host supports (common when CLI is updated independently of the daemon).
- **Fix**: Prefix all `docker compose` commands with `DOCKER_API_VERSION=1.43` to pin the API version to the daemon's maximum supported level.
  ```bash
  DOCKER_API_VERSION=1.43 docker compose up -d --build
  ```
- **Lesson / Rule**: On servers where the Docker CLI and daemon versions diverge, always export `DOCKER_API_VERSION` matching the daemon's maximum. Add it to wrapper scripts and cron jobs to avoid silent failures.

---

## 13. Wildcard `*` in `PI_WEB_ALLOWED_HOSTS` Is Not Natively Supported

- **Symptom**: Setting `PI_WEB_ALLOWED_HOSTS: "*"` in `docker-compose.yml` to allow any hostname still results in `403 Forbidden` for any non-loopback, non-IP host header.
- **Root Cause**: The `isApiRequestHostAllowed()` function in `lib/request-security.ts` calls `normalizeConfiguredHostname("*")` which returns `null` (wildcard is not a valid hostname or IP), so no match is made.
- **Fix**: Add an explicit wildcard check before the normalization step in `lib/request-security.ts`:
  ```ts
  return configuredHostnames.some(
    (configured) => configured === "*" || normalizeConfiguredHostname(configured) === hostname,
  );
  ```
  Or — preferably — list every intended hostname explicitly (e.g. `"pi02.n8n.tw,192.168.1.66"`) instead of relying on `*`.
- **Lesson / Rule**: Inspect the source code logic of any `ALLOWED_HOSTS`-style security feature before assuming wildcards work. Explicit host lists are safer and avoid unintended security bypasses.

---

## 14. LAN IP Must Be in `PI_WEB_ALLOWED_HOSTS` for Local Access

- **Symptom**: Accessing pi-web via `http://192.168.1.66:30141` directly (bypassing Cloudflare) returns `403 Forbidden`, even though the container is bound to `0.0.0.0`.
- **Root Cause**: The application's host-validation middleware checks the `Host` header. When a browser connects to `http://192.168.1.66:30141`, the `Host` header is `192.168.1.66:30141`. The IP is not in the allowed list, so the request is rejected.
- **Fix**: Add the LAN IP to `PI_WEB_ALLOWED_HOSTS`:
  ```yaml
  PI_WEB_ALLOWED_HOSTS: "pi02.n8n.tw,192.168.1.66"
  ```
  IP literals are always accepted by `isIP()` in `lib/request-security.ts`, so this works correctly.
- **Lesson / Rule**: When offering both direct LAN access (`http://<ip>:<port>`) and Cloudflare Tunnel access (`https://<domain>`), both the IP and the domain must be in the allowed hosts list.

---

## 15. Passwords with `$` Characters Require `$$` Escaping in `docker-compose.yml`

- **Symptom**: A password like `pW9$kX2#mV7` is silently truncated or substituted inside the container — the application receives only `pW9` or an empty string.
- **Root Cause**: Docker Compose treats `$VAR` and `${VAR}` inside `environment:` values as shell variable interpolation. A `$` followed by any word character is consumed as a variable reference.
- **Fix (Option A)**: Escape every `$` as `$$` in the compose file:
  ```yaml
  PI_WEB_PASSWORD: "pW9$$kX2"
  ```
- **Fix (Option B — recommended)**: Generate passwords that contain only alphanumeric characters and avoid `$`, `&`, `!`, `%`, `^` entirely:
  ```bash
  openssl rand -base64 32 | tr -d '=$+/'
  ```
  This eliminates the escaping issue entirely and is safe to paste directly into `docker-compose.yml`.
- **Lesson / Rule**: Prefer passwords without shell-special characters when storing them in `docker-compose.yml`. If special characters are required, always escape `$` → `$$` and verify the value inside the container with `docker exec <container> env | grep PASSWORD`.

---

## 16. Pi Models Config File Is `models.json`, Not `models-store.json`

- **Symptom**: Custom providers and models written to `~/.pi/agent/models-store.json` do not appear in the pi-web model selector.
- **Root Cause**: `lib/models-config-store.ts` calls `join(getAgentDir(), "models.json")` — the filename is hardcoded as `models.json`. The UI may display or generate a file called `models-store.json` for internal state, but the provider/model configuration is read exclusively from `models.json`.
- **Fix**: Write all provider configuration to `~/.pi/agent/models.json`:
  ```bash
  # Wrong
  ~/.pi/agent/models-store.json

  # Correct
  ~/.pi/agent/models.json
  ```
  Verify the container sees it: `docker exec pi-web cat /home/node/.pi/agent/models.json`
- **Lesson / Rule**: Always verify the exact filename expected by the application source code (`getModelsConfigPath()` in `lib/models-config-store.ts`) rather than assuming from UI filenames or documentation. For pi-web, the authoritative models config file is always `~/.pi/agent/models.json`.

---

## 17. Pushing to GitHub When No SSH Key or Git Credentials Are Configured

- **Symptom**: `git push origin main` fails with `fatal: could not read Username for 'https://github.com': No such device or address`. No SSH keys exist under `~/.ssh/` and `~/.gitconfig` has no credential helper.
- **Root Cause**: A fresh server (or user account) has no GitHub authentication configured. The remote URL uses HTTPS, which requires interactive username/password or a PAT; SSH push requires a keypair registered with GitHub.
- **Fix (Option A — PAT, quickest)**:
  ```bash
  git remote set-url origin https://YOUR_GITHUB_PAT@github.com/ORG/REPO.git
  git push origin main
  # After push, restore the clean URL to avoid storing the token in .git/config:
  git remote set-url origin https://github.com/ORG/REPO.git
  ```
- **Fix (Option B — SSH key, persistent)**:
  ```bash
  ssh-keygen -t ed25519 -C "user@hostname" -f ~/.ssh/id_ed25519 -N ""
  cat ~/.ssh/id_ed25519.pub   # paste into GitHub → Settings → SSH and GPG keys
  git remote set-url origin git@github.com:ORG/REPO.git
  git push origin main
  ```
- **Fix (Option C — manual upload, no credentials needed)**:
  Open `https://github.com/ORG/REPO/edit/main/PATH/TO/FILE` in a browser, paste the updated file content, and commit directly via the GitHub web editor.
- **Lesson / Rule**: On production servers with no interactive login, pre-configure SSH key authentication or use a short-lived PAT embedded in the remote URL (remove after push). Option C (GitHub web editor) is the fastest fallback when editing a single file.
