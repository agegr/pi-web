# Development Log

This document records the installation process, issues encountered, and resolution steps in reverse chronological order.

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
