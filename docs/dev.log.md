# Development Log

This document records the installation process, issues encountered, and resolution steps in reverse chronological order.

---

## [2026-08-16 14:28] - pi06: Cloudflare Tunnel Fixed via Container DNS
- **Symptom**: `https://pi06.n8n.tw/` timed out. `cloudflared` logs showed `dial tcp 192.168.1.61:30141: i/o timeout` and `dial tcp 172.17.0.1:30141: i/o timeout`.
- **Root Cause**: Docker hairpin NAT failure — `cloudflared` container on `bridge` network cannot reach host-published ports via host LAN IP or docker0 gateway on this specific host.
- **Fix**: Connected `cloudflared` to `pi-web_default` network (`docker network connect pi-web_default beautiful_ardinghelli`), then changed Cloudflare Dashboard origin URL to `http://pi-web:30141` (Docker embedded DNS).
- **Persistence**: Created `connect-cloudflared.sh` (idempotent reconnection script) + `@reboot` cron job.
- **Result**: `https://pi06.n8n.tw/` now returns HTTP 401 (Basic Auth prompt) correctly.

## [2026-08-16 14:00] - pi06: Hairpin NAT Diagnosis
- Tested from bridge-network container: `http://192.168.1.61:30141` → timeout, `http://172.17.0.1:30141` → timeout, `http://172.17.0.5:30141` (pi-web bridge IP) → 401 OK, `http://pi-web:30141` (on shared network) → 200 OK.
- Confirmed this is host-specific: pi08 (`192.168.1.62`) works fine with host LAN IP; pi06 does not.

---

## [2026-08-16 12:40] - Successful Verification
- Tested HTTP Basic Auth with domain `pi01.xxx.com` using username `pi` and password `your_complex_password_here`.
- Verified HTTP 200 OK response.
- Verified Host Header security: Requests with invalid Host headers (e.g. `evil.com`) correctly return `403 Forbidden`.

## [2026-08-16 12:23] - Dead End: Basic Auth Failure with Username `admin`
- **Symptom**: `curl` with Basic Auth using `admin:password` returned `401 Unauthorized`.
- **Investigation**: Inspected `lib/web-auth.ts` source code and discovered `export const PI_WEB_AUTH_USERNAME = "pi";`.
- **Fix**: Changed authentication username to `pi`.

## [2026-08-16 12:03] - Dead End: Docker Compose Environment Variable Warning
- **Symptom**: `docker compose up` produced `WARN[0000] The "kX2" variable is not set. Defaulting to a blank string.`
- **Investigation**: Password string contained `$`, which Docker Compose treated as an unassigned environment variable reference.
- **Fix**: Replaced `$` with `$$` in `docker-compose.yml` (`your_complex_password_here`).

## [2026-08-16 11:55] - Initial Setup Request
- Initialized Docker deployment of `pi-web` with `PI_WEB_NO_OPEN=1`, `PI_WEB_ALLOWED_HOSTS=pi01.xxx.com`, and high-entropy password requirement.
