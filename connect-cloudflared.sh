#!/bin/bash
# connect-cloudflared.sh — Ensure cloudflared can reach pi-web via Docker DNS
#
# Cloudflare Tunnel (beautiful_ardinghelli) runs on the default "bridge"
# network and cannot reach host-published ports via hairpin NAT on this
# machine. This script connects cloudflared to pi-web's compose network
# so it can resolve http://pi-web:30141 via Docker embedded DNS.
#
# Cloudflare Dashboard origin URL for pi06.n8n.tw must be: http://pi-web:30141
#
# This script is idempotent — safe to run multiple times.

set -e

CLOUDFLARED_CONTAINER="beautiful_ardinghelli"
PIWEB_NETWORK="pi-web_default"

# Check if already connected
if docker inspect "$CLOUDFLARED_CONTAINER" \
    --format '{{range $k, $_ := .NetworkSettings.Networks}}{{$k}} {{end}}' \
    | grep -q "$PIWEB_NETWORK"; then
  echo "✅ $CLOUDFLARED_CONTAINER is already connected to $PIWEB_NETWORK"
else
  echo "Connecting $CLOUDFLARED_CONTAINER to $PIWEB_NETWORK ..."
  docker network connect "$PIWEB_NETWORK" "$CLOUDFLARED_CONTAINER"
  echo "✅ Connected"
fi

# Verify connectivity
echo "Testing: cloudflared → pi-web:30141 ..."
docker run --rm --network "$PIWEB_NETWORK" alpine/curl \
  -s -o /dev/null -w "HTTP %{http_code}\n" --connect-timeout 3 \
  -H "Host: pi06.n8n.tw" http://pi-web:30141/
echo "Done."
