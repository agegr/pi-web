#!/usr/bin/env bash
# Restart the pi-web dev server on 127.0.0.1:30141 without port conflicts.
# Thin Git-Bash wrapper over restart-dev.ps1 (same flags).
# Usage:  ./restart-dev.sh [-Log] [-Clean] [-IfDown] [-CheckOnly] [-Lan] [-Port N]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -W 2>/dev/null || cygpath -w "$(pwd)")"
powershell -NoProfile -ExecutionPolicy Bypass -File "$SCRIPT_DIR/restart-dev.ps1" "$@"
