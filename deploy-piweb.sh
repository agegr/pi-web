#!/usr/bin/env bash
# deploy-piweb.sh — update and restart the @silgrid/pi-web service in this container.
#
# This container has no systemd; pi-web runs inside a detached tmux session
# ("piweb" by default) with a restart loop. PI_WEB_IDLE_TIMEOUT_MS=0 disables
# the 10-minute idle auto-exit so the server does not appear to "self-exit"
# while running unattended as a service.
#
# Usage: ./deploy-piweb.sh
# Env:
#   PIWEB_TMUX_SESSION  tmux session name (default: piweb)
#   PIWEB_PORT          optional port override passed to pi-web
set -euo pipefail

SESSION="${PIWEB_TMUX_SESSION:-piweb}"
PKG="@silgrid/pi-web"

echo "==> Installing ${PKG}@latest"
npm install -g "${PKG}@latest"

echo "==> Restarting tmux session '${SESSION}'"
tmux kill-session -t "${SESSION}" 2>/dev/null || true
tmux new-session -d -s "${SESSION}" "
  while true; do
    PI_WEB_IDLE_TIMEOUT_MS=0 pi-web ${PIWEB_PORT:+--port ${PIWEB_PORT}}
    echo '[piweb] pi-web exited; restarting in 5s' >&2
    sleep 5
  done
"

echo "==> pi-web running in tmux session '${SESSION}'"
tmux ls
