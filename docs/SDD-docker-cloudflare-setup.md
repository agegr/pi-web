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

---

## 3. Known Limitations

- Basic Auth in `pi-web` does not enforce rate-limiting or MFA.
- HTTPS encryption must be terminated at Cloudflare / Edge proxy before forwarding to localhost HTTP port `30141`.
