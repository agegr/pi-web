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
