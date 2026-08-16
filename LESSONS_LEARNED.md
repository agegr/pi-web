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
