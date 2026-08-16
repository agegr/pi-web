# Software Design Decision: Docker & Cloudflare Setup for pi-web

## 1. Problem Statement

`pi-web` is a local browser UI for the `pi` coding agent. Running `pi-web` inside a Docker container behind Cloudflare Tunnel (or reverse proxies) introduces specific network binding, authentication, host header validation, and environment variable parsing challenges.

---

## 2. Decision & Trade-offs

### Decision 1: Binding `0.0.0.0` inside Container vs `127.0.0.1`
- **Choice**: Set `PI_WEB_HOSTNAME: "0.0.0.0"` in `docker-compose.yml`.
- **Trade-off**: Inside containerized network bridges, binding only to loopback `127.0.0.1` prevents Docker's proxy bridge from forwarding port `30141`. The container must bind `0.0.0.0`, while host-level port binding (`127.0.0.1:30141:30141`) limits access to localhost and tunnel proxies.

### Decision 2: Hardcoded Username (`pi`) in Upstream Web Auth
- **Choice**: Enforce Basic Auth username `pi`.
- **Rationale**: `pi-web` implements authentication in `lib/web-auth.ts` with `export const PI_WEB_AUTH_USERNAME = "pi";`. The password is configured dynamically via `PI_WEB_PASSWORD`. Attempting to log in with other usernames (e.g. `admin`) fails validation by design.

### Decision 3: Host Header Allow-list (`PI_WEB_ALLOWED_HOSTS`)
- **Choice**: Explicitly set `PI_WEB_ALLOWED_HOSTS: "pi01.xxx.com"`.
- **Rationale**: When Cloudflare Tunnel forwards HTTPS requests for `https://pi01.xxx.com`, Next.js middleware verifies incoming `Host` headers. If `pi01.xxx.com` is not in `PI_WEB_ALLOWED_HOSTS`, requests are rejected with HTTP 403 Forbidden.

### Decision 4: Escaping `$` in `docker-compose.yml` (`$$`)
- **Choice**: Write `PI_WEB_PASSWORD: "your_complex_password_here"`.
- **Rationale**: Docker Compose treats single `$` in environment strings as variable interpolation (e.g. `$kX2`). Escaping to `$$` instructs Compose to output a literal `$` into container environment variables.

### Decision 5: Cloudflare Tunnel Origin URL — Container DNS vs Host IP
- **Choice**: Set Cloudflare Dashboard origin URL to `http://pi-web:30141` (Docker container DNS) instead of `http://<host-LAN-IP>:30141`.
- **Rationale**: When `cloudflared` runs inside a Docker container, it cannot reliably reach host-published ports via the host's LAN IP or Docker bridge gateway (`172.17.0.1`) due to **hairpin NAT** failures. This is host-specific — some machines allow it, others silently drop the packets (`i/o timeout`). Using Docker's embedded DNS on a shared user-defined network (`pi-web_default`) provides direct container-to-container routing with no hairpin NAT dependency.
- **Trade-off**: Requires `cloudflared` to be connected to the same Docker network as `pi-web`. Since `cloudflared` is typically a standalone container (not in the same compose file), the network connection must be re-applied after container restarts (see `connect-cloudflared.sh` and `@reboot` cron job).

---

## 3. Known Limitations

- Basic Auth in `pi-web` does not enforce rate-limiting or MFA.
- HTTPS encryption must be terminated at Cloudflare / Edge proxy before forwarding to localhost HTTP port `30141`.
- Docker hairpin NAT behavior varies across hosts. Always verify container-to-host connectivity before assuming `http://<host-IP>:<port>` works from inside a container.
- The `docker network connect` linking `cloudflared` to `pi-web_default` is a runtime operation that does not persist across container restarts. An automated reconnection mechanism (cron job or startup script) is required.
