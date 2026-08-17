# pi-web Docker & Cloudflare Tunnel Installation Guide

This guide provides step-by-step instructions for deploying `pi-web` using Docker Compose behind a Cloudflare Tunnel or reverse proxy.

---

## 1. Prerequisites

- Docker and Docker Compose installed.
- Access to host agent directory `~/.pi/agent`.
- Domain routed through Cloudflare Tunnel (e.g., `pi01.xxx.com`).

---

## 2. Configuration (`docker-compose.yml`)

Create or update `/home/wrt/AG/SystemRepair/pi-web/docker-compose.yml`:

```yaml
services:
  pi-web:
    build: .
    image: tigerai/pi-web:local
    container_name: pi-web
    ports:
      - "30141:30141"
    environment:
      # Required: container must bind 0.0.0.0 inside container network
      PI_WEB_HOSTNAME: "0.0.0.0"
      # Disable auto-opening browser on container start
      PI_WEB_NO_OPEN: "1"
      # Allowed public hostname(s) forwarded by Cloudflare/Proxy
      PI_WEB_ALLOWED_HOSTS: "pi01.xxx.com"
      # HTTP Basic Auth Password ($ MUST be escaped as $$ for Compose)
      PI_WEB_PASSWORD: "your_complex_password_here"
    volumes:
      - '${HOME}/.pi/agent:/home/node/.pi/agent'
      - '/home/wrt/AG/SystemRepair:/workspace'
    working_dir: /workspace
    restart: unless-stopped
```

---

## 3. Environment Parameters Reference

| Parameter | Recommended Value | Purpose |
|---|---|---|
| `PI_WEB_HOSTNAME` | `"0.0.0.0"` | Binds listening server to all interfaces inside container |
| `PI_WEB_NO_OPEN` | `"1"` | Prevents headless container from opening browser |
| `PI_WEB_ALLOWED_HOSTS` | `"pi01.xxx.com"` | Whitelists external domain host header to prevent 403 Forbidden |
| `PI_WEB_PASSWORD` | `"your_complex_password_here"` | Password for Basic Auth (Username is fixed to `pi`) |
| `${HOME}/.pi/agent` | `/home/node/.pi/agent` | Mounts pi sessions, models, and credentials from host |
| `/home/wrt/...` | `/workspace` | Mounts target project workspace into container |

---

## 4. Deployment Commands

```bash
# Ensure agent directory exists on host
mkdir -p ~/.pi/agent

# Build image and start container in detached mode
docker compose up -d --build

# Inspect container status
docker compose ps

# Inspect logs
docker compose logs -f
```

---

## 5. Login Credentials

- **URL**: `https://pi01.xxx.com`
- **Username**: `pi` *(Hardcoded in pi-web)*
- **Password**: `your_complex_password_here`
