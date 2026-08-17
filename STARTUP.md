# pi-web Quick Startup & Maintenance Guide

## Quick Operational Commands

### Start Service
```bash
cd /home/wrt/AG/SystemRepair/pi-web
docker compose up -d
```

### Build & Re-deploy
```bash
docker compose up -d --build
```

### View Live Logs
```bash
docker compose logs -f
```

### Stop Service
```bash
docker compose down
```

### Check Container Health
```bash
docker compose ps
```

### Verify Container Environment
```bash
docker compose exec pi-web printenv PI_WEB_PASSWORD
```
