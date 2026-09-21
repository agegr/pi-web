#!/usr/bin/env bash
# deploy-piweb.sh — update and restart the @silgrid/pi-web service in this container.
#
# This container has no systemd; pi-web runs inside a detached tmux session
# ("piweb" by default) with a restart loop. PI_WEB_IDLE_TIMEOUT_MS=0 disables
# the 10-minute idle auto-exit so the server does not appear to "self-exit"
# while running unattended as a service.
#
# The server binds 0.0.0.0 (override with PIWEB_HOST) so it is reachable from
# outside the container, and PI_WEB_PASSWORD set in the calling environment is
# passed through so the deployed service keeps its existing auth behavior.
#
# Two invocation modes:
#   1. From the repository root:            ./deploy-piweb.sh
#   2. After a global npm install:          pi-web-deploy
#      (the bin/pi/pi-web-deploy shim runs this same script from inside the
#       installed package directory; arguments and env are passed through)
#
# Usage: ./deploy-piweb.sh   (or: pi-web-deploy after `npm i -g @silgrid/pi-web`)
# Env:
#   PIWEB_TMUX_SESSION  tmux session name (default: piweb)
#   PIWEB_PORT          optional port override passed to pi-web
#   PIWEB_HOST          bind address (default: 0.0.0.0)
#   PI_WEB_PASSWORD     optional web-auth password passed through to pi-web
set -euo pipefail

SESSION="${PIWEB_TMUX_SESSION:-piweb}"
PKG="@silgrid/pi-web"
HOST="${PIWEB_HOST:-0.0.0.0}"

# The upstream @agegr/pi-web package owns the same global bin name (pi-web);
# uninstall it first so installing ours does not fail with EEXIST. Harmless
# when it is already gone.
if npm ls -g @agegr/pi-web >/dev/null 2>&1; then
  echo "==> Removing superseded @agegr/pi-web global install (same pi-web bin)"
  npm uninstall -g @agegr/pi-web
fi

echo "==> Installing ${PKG}@latest"
npm install -g "${PKG}@latest"

echo "==> Restarting tmux session '${SESSION}'"
tmux kill-session -t "${SESSION}" 2>/dev/null || true
tmux new-session -d -s "${SESSION}" "
  while true; do
    PI_WEB_IDLE_TIMEOUT_MS=0 ${PI_WEB_PASSWORD:+PI_WEB_PASSWORD='${PI_WEB_PASSWORD}'} pi-web -H ${HOST} ${PIWEB_PORT:+--port ${PIWEB_PORT}}
    echo '[piweb] pi-web exited; restarting in 5s' >&2
    sleep 5
  done
"

echo "==> pi-web running in tmux session '${SESSION}'"
tmux ls
