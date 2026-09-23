#!/usr/bin/env bash
# Regenerate public/.well-known/assetlinks.json from the certificate that
# ACTUALLY signed the artifact, so an APK/website mismatch cannot ship
# silently.
#
# Usage:
#   scripts/assetlinks.sh <apk>                # from a built APK (preferred)
#   scripts/assetlinks.sh --keystore [file]    # from the release keystore
#
# Env / flags:
#   PIWEB_TWA_SITE   target site origin (default: https://gcp-dev.stevenforai.top)
#   PIWEB_TWA_PACKAGE  target package (default: app.piweb.twa)
#   -o <file>        output path (default: <repo-root>/public/.well-known/assetlinks.json)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"

site="${PIWEB_TWA_SITE:-https://gcp-dev.stevenforai.top}"
package="${PIWEB_TWA_PACKAGE:-app.piweb.twa}"
output="$repo_root/public/.well-known/assetlinks.json"

usage() { echo "usage: $0 <apk> | --keystore [keystore-file] [-o output]" >&2; exit 2; }

mode=""
source_file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --keystore) mode="keystore"; [ "${2:-}" != "" ] && [ "${2#-}" = "${2}" ] && { source_file="$2"; shift; } ;;
    -o) output="$2"; shift ;;
    -*) usage ;;
    *) mode="apk"; source_file="$1" ;;
  esac
  shift
done
[ "$mode" = "" ] && usage

# Extract the SHA-256 certificate fingerprint, strip colons, lowercase —
# the format Digital Asset Links expects.
fingerprint=""
case "$mode" in
  apk)
    [ -f "$source_file" ] || { echo "apk not found: $source_file" >&2; exit 1; }
    fingerprint="$(keytool -printcert -jarfile "$source_file" \
      | grep -m1 'SHA256:' \
      | sed -E 's/.*SHA256:[[:space:]]*//' | tr -d ' :' | tr 'A-F' 'a-f')"
    ;;
  keystore)
    keystore="${source_file:-$here/../keystore/piweb-twa-release.keystore}"
    [ -f "$keystore" ] || { echo "keystore not found: $keystore" >&2; exit 1; }
    storepass="${PIWEB_STOREPASS:-piweb-twa-release}"
    fingerprint="$(keytool -list -v -keystore "$keystore" -storepass "$storepass" \
      | grep -m1 'SHA256:' \
      | sed -E 's/.*SHA256:[[:space:]]*//' | tr -d ' :' | tr 'A-F' 'a-f')"
    ;;
esac

[ -n "$fingerprint" ] || { echo "could not extract a SHA-256 fingerprint" >&2; exit 1; }
[ "${#fingerprint}" = 64 ] || { echo "unexpected fingerprint: $fingerprint" >&2; exit 1; }

mkdir -p "$(dirname "$output")"
cat > "$output" <<EOF
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "$package",
      "sha256_cert_fingerprints": ["$fingerprint"]
    }
  }
]
EOF

echo "wrote $output"
echo "  site:     $site"
echo "  package:  $package"
echo "  sha256:   $fingerprint"
echo "note: the target site is served by the deployment (reverse proxy / manifest);"
echo "      if the site origin changed, update it in the deployment config and docs."
